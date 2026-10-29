import * as THREE from 'three'
import { createWheel } from './Truck.js'

// Heavy-duty container forklift. Origin: front (drive) axle on the ground,
// facing +Z. Forks are spaced to match a 20ft container's forklift pockets.
export const FORK_SPACING = 1.8
const FRONT_R = 0.62
const REAR_R = 0.5
const WHEELBASE = 3.2
const MAST_Z = 0.85
const CARRIAGE_Z = 0.3
export const FORK_FACE_Z = MAST_Z + CARRIAGE_Z + 0.13 // where the fork shanks meet the load
const FREE_LIFT = 0.8

const YELLOW = '#ffb000'

function stripes() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const ctx = c.getContext('2d')
  ctx.fillStyle = YELLOW
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#151515'
  for (let x = -256; x < 512; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 256)
    ctx.lineTo(x + 32, 256)
    ctx.lineTo(x + 32 + 256, 0)
    ctx.lineTo(x + 256, 0)
    ctx.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function brand(logo) {
  const word = logo.parts?.word ?? logo.full
  const t = new THREE.CanvasTexture(logo.stencil(word, [22, 22, 24]))
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export default class Forklift {
  constructor(logo) {
    const m = {
      body: new THREE.MeshPhysicalMaterial({ color: YELLOW, roughness: 0.45, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
      black: new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.6, metalness: 0.4 }),
      mast: new THREE.MeshStandardMaterial({ color: '#222326', roughness: 0.45, metalness: 0.6 }),
      steel: new THREE.MeshStandardMaterial({ color: '#5d6166', roughness: 0.4, metalness: 0.9 }),
      chrome: new THREE.MeshStandardMaterial({ color: '#e9ebee', roughness: 0.1, metalness: 1 }),
      alu: new THREE.MeshStandardMaterial({ color: '#d6d9dc', roughness: 0.35, metalness: 0.8 }),
      seat: new THREE.MeshStandardMaterial({ color: '#1e2226', roughness: 0.7 }),
      rubber: new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.95 }),
      amber: new THREE.MeshStandardMaterial({ color: '#ff9a1f', emissive: '#ff8a00', emissiveIntensity: 1 }),
      red: new THREE.MeshStandardMaterial({ color: '#c2121a', emissive: '#ff1a1a', emissiveIntensity: 0.6 }),
      lamp: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4d6', emissiveIntensity: 1.2 }),
      stripes: new THREE.MeshStandardMaterial({ map: stripes(), roughness: 0.4 }),
      brand: new THREE.MeshStandardMaterial({ map: brand(logo), transparent: true, roughness: 0.4 }),
    }
    this.m = m
    this.group = new THREE.Group()
    this.wheels = []
    this.steer = []

    const add = (geometry, material, position, rotation = [0, 0, 0], parent = this.group) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(...position)
      mesh.rotation.set(...rotation)
      mesh.castShadow = mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }
    const box = (size, material, position, rotation, parent) => add(new THREE.BoxGeometry(...size), material, position, rotation, parent)
    const rod = (r, length, material, position, rotation, parent) =>
      add(new THREE.CylinderGeometry(r, r, length, 16), material, position, rotation, parent)

    // Lower chassis and the yellow counterbalance body above it
    box([1.1, 0.7, 4.4], m.black, [0, 0.65, -1.75])
    const profile = new THREE.Shape()
    profile.moveTo(0.55, 1.28)
    profile.lineTo(0.55, 1.42)
    profile.lineTo(-2.25, 1.42)
    profile.quadraticCurveTo(-2.35, 2.12, -2.7, 2.12)
    profile.lineTo(-3.75, 2.12)
    profile.quadraticCurveTo(-4.25, 2.1, -4.25, 1.55)
    profile.lineTo(-4.2, 1.05)
    profile.lineTo(-0.85, 1.05)
    profile.lineTo(-0.85, 1.28)
    profile.closePath()
    const width = 2.3
    const bodyGeo = new THREE.ExtrudeGeometry(profile, {
      depth: width,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.07,
      bevelOffset: -0.07,
      bevelSegments: 4,
      curveSegments: 12,
    })
    add(bodyGeo, m.body, [width / 2, 0, 0], [0, -Math.PI / 2, 0])
    box([2.36, 0.34, 0.25], m.black, [0, 0.95, -4.15])
    add(new THREE.PlaneGeometry(1.9, 0.6), m.stripes, [0, 1.65, -4.261], [0, Math.PI, 0])
    for (const sx of [-1, 1]) {
      const decal = add(new THREE.PlaneGeometry(1.3, 0.2), m.brand, [sx * 1.151, 1.75, -3.2], [0, (sx * Math.PI) / 2, 0])
      decal.castShadow = false
      box([0.35, 0.04, 0.5], m.alu, [sx * 1.0, 0.75, -1.1])
      box([0.12, 0.12, 0.04], m.red, [sx * 0.95, 1.85, -4.25])
    }

    // Operator station
    box([1.5, 0.45, 0.45], m.body, [0, 1.64, -0.45])
    box([0.62, 0.14, 0.58], m.seat, [0, 1.52, -1.85])
    box([0.62, 0.7, 0.14], m.seat, [0, 1.95, -2.15], [-0.15, 0, 0])
    rod(0.035, 0.75, m.black, [0, 2.05, -0.75], [-0.6, 0, 0])
    add(new THREE.TorusGeometry(0.2, 0.025, 8, 28), m.black, [0, 2.36, -0.95], [-1.0, 0, 0])
    for (let i = 0; i < 3; i++) {
      rod(0.015, 0.4, m.black, [0.35 + i * 0.09, 2.02, -0.55], [-0.3, 0, 0])
      add(new THREE.SphereGeometry(0.035, 12, 8), m.red, [0.35 + i * 0.09, 2.21, -0.61])
    }

    // Overhead guard
    for (const sx of [-1, 1]) {
      rod(0.06, 1.9, m.black, [sx * 0.9, 2.33, -0.3], [0.08, 0, 0])
      rod(0.06, 1.2, m.black, [sx * 0.9, 2.7, -2.75])
      box([0.1, 0.08, 2.6], m.black, [sx * 0.9, 3.3, -1.5])
    }
    for (let i = 0; i < 6; i++) box([1.9, 0.05, 0.08], m.black, [0, 3.3, -0.25 - i * 0.5])
    rod(0.09, 0.14, m.amber, [-0.6, 3.42, -2.6])
    for (const sx of [-1, 1]) box([0.2, 0.14, 0.1], m.lamp, [sx * 0.75, 3.22, -0.18])
    box([0.05, 0.2, 0.14], m.black, [-0.98, 3.0, -0.2])

    // Wheels: driven front pair, steered rear pair
    for (const sx of [-1, 1]) {
      const front = createWheel(m, 0.38)
      front.scale.setScalar(FRONT_R / 0.535)
      front.position.set(sx * 1.0, FRONT_R, 0)
      if (sx < 0) front.rotation.y = Math.PI
      this.group.add(front)
      this.wheels.push({ wheel: front, r: FRONT_R })

      const pivot = new THREE.Group()
      pivot.position.set(sx * 0.82, REAR_R, -WHEELBASE)
      const rear = createWheel(m, 0.32)
      rear.scale.setScalar(REAR_R / 0.535)
      if (sx < 0) rear.rotation.y = Math.PI
      pivot.add(rear)
      this.group.add(pivot)
      this.steer.push(pivot)
      this.wheels.push({ wheel: rear, r: REAR_R })
    }
    rod(0.09, 1.7, m.black, [0, FRONT_R, 0], [0, 0, Math.PI / 2])

    // Mast: tilts about its foot; inner channel and carriage slide up
    this.mast = new THREE.Group()
    this.mast.position.set(0, 0.45, MAST_Z)
    this.group.add(this.mast)
    for (const sx of [-1, 1]) box([0.14, 4.5, 0.22], m.mast, [sx * 0.62, 2.25, 0], undefined, this.mast)
    box([1.38, 0.16, 0.2], m.mast, [0, 4.42, 0], undefined, this.mast)
    box([1.38, 0.12, 0.2], m.mast, [0, 1.6, -0.02], undefined, this.mast)
    for (const sx of [-1, 1]) rod(0.07, 0.6, m.mast, [sx * 0.75, 0.6, -0.55], [1.1, 0, 0], this.mast)

    this.inner = new THREE.Group()
    this.mast.add(this.inner)
    for (const sx of [-1, 1]) {
      box([0.12, 4.3, 0.16], m.mast, [sx * 0.46, 2.2, 0.14], undefined, this.inner)
      box([0.04, 4.0, 0.03], m.steel, [sx * 0.28, 2.1, 0.2], undefined, this.inner)
    }
    box([1.04, 0.14, 0.16], m.mast, [0, 4.3, 0.14], undefined, this.inner)
    rod(0.08, 3.6, m.black, [0, 1.85, 0.02], undefined, this.mast)
    rod(0.05, 3.4, m.chrome, [0, 2.0, 0.02], undefined, this.inner)

    this.carriage = new THREE.Group()
    this.carriage.position.z = CARRIAGE_Z
    this.mast.add(this.carriage)
    box([2.3, 0.18, 0.12], m.mast, [0, 0.3, 0], undefined, this.carriage)
    box([2.3, 0.18, 0.12], m.mast, [0, 0.95, 0], undefined, this.carriage)
    for (let i = 0; i < 7; i++) box([0.05, 1.4, 0.05], m.mast, [-1.05 + i * 0.35, 1.2, -0.02], undefined, this.carriage)
    box([2.3, 0.08, 0.06], m.mast, [0, 1.9, -0.02], undefined, this.carriage)
    for (const sx of [-1, 1]) {
      const x = (sx * FORK_SPACING) / 2
      box([0.2, 1.05, 0.08], m.steel, [x, 0.5, 0.09], undefined, this.carriage)
      box([0.2, 0.08, 2.4], m.steel, [x, -0.37, 0.09 + 1.2], undefined, this.carriage)
    }
  }

  // state: { position, heading, distance (signed, along heading), steer, lift, tilt }
  pose(state) {
    this.group.position.copy(state.position)
    this.group.rotation.y = state.heading
    this.mast.rotation.x = -state.tilt
    // At lift 0 the fork blades sit 0.08 above the ground, at pocket height
    this.carriage.position.y = state.lift
    this.inner.position.y = Math.max(0, state.lift - FREE_LIFT)
    for (const pivot of this.steer) pivot.rotation.y = state.steer
    for (const { wheel, r } of this.wheels) wheel.userData.spin.rotation.x = (wheel.rotation.y ? -1 : 1) * (state.distance / r)
    this.group.updateMatrixWorld(true)
  }
}
