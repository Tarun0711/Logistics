import * as THREE from 'three'
import { loadModel } from './loaders.js'

export const PARCEL = { width: 0.44, height: 0.32, depth: 0.34 }

// Metres covered by one full walk cycle — keeps the feet planted when the
// cycle is driven by distance instead of time.
export const STRIDE = 1.45
const CROUCH_DROP = 0.5
const LEAN = 0.55

const UP = new THREE.Vector3(0, 1, 0)

const _p = new THREE.Vector3()
const _d1 = new THREE.Vector3()
const _d2 = new THREE.Vector3()
const _s = new THREE.Vector3()
const _e = new THREE.Vector3()
const _h = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _elbow = new THREE.Vector3()
const _target = new THREE.Vector3()
const _q0 = new THREE.Quaternion()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()

// Rotate a bone about its own pivot so world point `from` swings onto `to`
function aim(bone, from, to) {
  bone.getWorldPosition(_p)
  _d1.subVectors(from, _p).normalize()
  _d2.subVectors(to, _p).normalize()
  _q0.setFromUnitVectors(_d1, _d2)
  bone.getWorldQuaternion(_q1).premultiply(_q0)
  bone.parent.getWorldQuaternion(_q2).invert()
  bone.quaternion.copy(_q2.multiply(_q1))
  bone.updateMatrixWorld(true)
}

function rotateWorld(bone, axis, angle) {
  _q0.setFromAxisAngle(axis, angle)
  bone.getWorldQuaternion(_q1).premultiply(_q0)
  bone.parent.getWorldQuaternion(_q2).invert()
  bone.quaternion.copy(_q2.multiply(_q1))
  bone.updateMatrixWorld(true)
}

// Analytic two-bone IK (shoulder-elbow-hand / hip-knee-foot)
function solveTwoBone(upper, lower, end, target, pole) {
  upper.getWorldPosition(_s)
  lower.getWorldPosition(_e)
  end.getWorldPosition(_h)
  const a = _s.distanceTo(_e)
  const b = _e.distanceTo(_h)
  _dir.subVectors(target, _s)
  const d = THREE.MathUtils.clamp(_dir.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3)
  _dir.normalize()
  _pole.subVectors(pole, _s)
  _pole.addScaledVector(_dir, -_pole.dot(_dir)).normalize()
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1)
  _elbow
    .copy(_s)
    .addScaledVector(_dir, a * cosA)
    .addScaledVector(_pole, a * Math.sqrt(1 - cosA * cosA))
  aim(upper, _e, _elbow)
  end.getWorldPosition(_h)
  aim(lower, _h.clone(), target)
}

export default class Worker {
  async load(url) {
    const gltf = await loadModel(url)
    this.root = new THREE.Group()
    this.model = gltf.scene
    // The rig faces -Z; turn it so the root's +Z is the walking direction
    this.model.rotation.y = Math.PI
    this.root.add(this.model)
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true
        o.frustumCulled = false
      }
    })

    this.mixer = new THREE.AnimationMixer(this.model)
    const action = (name) => this.mixer.clipAction(gltf.animations.find((a) => a.name === name)).play()
    this.walk = action('Walk')
    this.walk.timeScale = 0
    this.idle = action('Idle')

    const bone = (name) => this.model.getObjectByName(`mixamorig${name}`)
    this.spine = bone('Spine1')
    this.arms = ['Left', 'Right'].map((side) => ({
      side: side === 'Left' ? 1 : -1,
      upper: bone(`${side}Arm`),
      lower: bone(`${side}ForeArm`),
      end: bone(`${side}Hand`),
    }))
    this.legs = ['Left', 'Right'].map((side) => ({
      upper: bone(`${side}UpLeg`),
      lower: bone(`${side}Leg`),
      end: bone(`${side}Foot`),
      planted: new THREE.Vector3(),
    }))

    this.forward = new THREE.Vector3()
    this.left = new THREE.Vector3()
    return this
  }

  // state: { position, heading, walkPhase (s), walkWeight, crouch, carry, parcel (world Vector3) }
  update(state, delta) {
    this.walk.time = state.walkPhase % this.walk.getClip().duration
    this.walk.setEffectiveWeight(state.walkWeight)
    this.idle.setEffectiveWeight(1 - state.walkWeight)
    this.mixer.update(delta)

    this.root.position.copy(state.position)
    this.root.rotation.y = state.heading
    this.root.updateMatrixWorld(true)

    this.forward.set(Math.sin(state.heading), 0, Math.cos(state.heading))
    this.left.crossVectors(UP, this.forward)

    if (state.crouch > 0.001) {
      for (const leg of this.legs) leg.end.getWorldPosition(leg.planted)
      this.root.position.y -= state.crouch * CROUCH_DROP
      this.root.updateMatrixWorld(true)
      rotateWorld(this.spine, this.left, state.crouch * LEAN)
      for (const leg of this.legs) {
        leg.lower.getWorldPosition(_target)
        _target.addScaledVector(this.forward, 1).addScaledVector(UP, 0.2)
        solveTwoBone(leg.upper, leg.lower, leg.end, leg.planted, _target.clone())
      }
    }

    if (state.carry > 0.001) {
      for (const arm of this.arms) {
        const grip = new THREE.Vector3()
          .copy(state.parcel)
          .addScaledVector(this.left, arm.side * (PARCEL.width / 2 + 0.02))
          .addScaledVector(UP, -0.03)
          .addScaledVector(this.forward, -0.02)
        arm.end.getWorldPosition(_target)
        grip.lerpVectors(_target, grip, state.carry)
        const pole = arm.upper
          .getWorldPosition(new THREE.Vector3())
          .addScaledVector(UP, -0.8)
          .addScaledVector(this.left, arm.side * 0.45)
          .addScaledVector(this.forward, -0.4)
        solveTwoBone(arm.upper, arm.lower, arm.end, grip, pole)
      }
    }
  }
}
