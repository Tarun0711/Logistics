import * as THREE from 'three'
import { rng } from './textures.js'

// Cab-over tractor + 40ft skeletal container trailer, in metres.
// Each unit's origin is its (rear/middle) axle on the ground, facing +Z.
const WHEEL_R = 0.535
const TRACTOR = { wheelbase: 3.8, kingpin: 0.25 }
const TRAILER = { kingpin: 8.7, rear: -2.2, front: 10.3, deck: 1.5, axles: [-1.31, 0, 1.31] }
export const TRAILER_CENTER = (TRAILER.rear + TRAILER.front) / 2

const BLUE = '#173f9e'

function canvas(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function materials(logo) {
  const rand = rng(17)
  const tread = canvas(512, 64, (ctx, w, h) => {
    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#0a0a0a'
    for (let x = 0; x < w; x += 16) ctx.fillRect(x, h * 0.3, 6, h * 0.4)
    for (const y of [0.22, 0.5, 0.76]) ctx.fillRect(0, h * y - 2, w, 4)
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(90,85,80,${rand() * 0.2})`
      ctx.fillRect(rand() * w, rand() * h, 2, 2)
    }
  })
  const rail = canvas(1024, 64, (ctx, w, h) => {
    ctx.fillStyle = BLUE
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#f2f2ee'
    ctx.font = 'bold 40px Arial, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText('ELIV LOGISTICS', 40, h / 2)
    ctx.fillText('ELIV LOGISTICS', w / 2 + 40, h / 2)
  })
  const f = logo.parts?.emblem ?? logo.full
  const badge = new THREE.CanvasTexture(logo.stencil(f, [235, 238, 242]))
  badge.colorSpace = THREE.SRGBColorSpace

  return {
    paint: new THREE.MeshPhysicalMaterial({ color: BLUE, metalness: 0.3, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 }),
    trim: new THREE.MeshStandardMaterial({ color: '#2b2e33', metalness: 0.5, roughness: 0.5 }),
    black: new THREE.MeshStandardMaterial({ color: '#17181a', metalness: 0.3, roughness: 0.7 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#eceef0', metalness: 1, roughness: 0.12 }),
    alu: new THREE.MeshStandardMaterial({ color: '#c3c7cb', metalness: 0.9, roughness: 0.32 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#7f97ab', metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.32, depthWrite: false, clearcoat: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.95, map: tread }),
    tyreSide: new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 }),
    head: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff7e6', emissiveIntensity: 1.2 }),
    amber: new THREE.MeshStandardMaterial({ color: '#ff9a1f', emissive: '#ff8a00', emissiveIntensity: 0.9 }),
    red: new THREE.MeshStandardMaterial({ color: '#c2121a', emissive: '#ff1a1a', emissiveIntensity: 0.7 }),
    reverse: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0 }),
    rail: new THREE.MeshPhysicalMaterial({ map: rail, metalness: 0.5, roughness: 0.35, clearcoat: 1 }),
    badge: new THREE.MeshStandardMaterial({ map: badge, transparent: true, metalness: 0.8, roughness: 0.3 }),
  }
}

class Builder {
  constructor(group) {
    this.group = group
  }

  mesh(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], parent = this.group) {
    const m = new THREE.Mesh(geometry, material)
    m.position.set(...position)
    m.rotation.set(...rotation)
    m.castShadow = !material.transparent
    m.receiveShadow = true
    parent.add(m)
    return m
  }

  box(size, material, position, rotation, parent) {
    return this.mesh(new THREE.BoxGeometry(...size), material, position, rotation, parent)
  }

  cylinder(r, length, material, position, rotation, parent, segments = 20) {
    return this.mesh(new THREE.CylinderGeometry(r, r, length, segments), material, position, rotation, parent)
  }
}

// Truck wheel: treaded tyre (lathe profile), steel disc rim, hub and lug nuts.
// `spin` rotates about X; the outer face points +X.
export function createWheel(m, width = 0.3) {
  const wheel = new THREE.Group()
  const spin = new THREE.Group()
  wheel.add(spin)
  const w = width / 2
  const toAxisX = (g) => g.rotateZ(-Math.PI / 2)

  const tyre = toAxisX(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.29, -w),
        new THREE.Vector2(0.47, -w),
        new THREE.Vector2(WHEEL_R - 0.01, -w * 0.75),
        new THREE.Vector2(WHEEL_R, -w * 0.4),
        new THREE.Vector2(WHEEL_R, w * 0.4),
        new THREE.Vector2(WHEEL_R - 0.01, w * 0.75),
        new THREE.Vector2(0.47, w),
        new THREE.Vector2(0.29, w),
      ],
      48,
    ),
  )
  const mesh = new THREE.Mesh(tyre, m.rubber)
  mesh.castShadow = mesh.receiveShadow = true
  spin.add(mesh)

  const rim = toAxisX(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, w * 0.55),
        new THREE.Vector2(0.12, w * 0.55),
        new THREE.Vector2(0.2, w * 0.35),
        new THREE.Vector2(0.27, w * 0.4),
        new THREE.Vector2(0.295, w * 0.9),
        new THREE.Vector2(0.295, -w * 0.9),
      ],
      32,
    ),
  )
  const rimMesh = new THREE.Mesh(rim, m.alu)
  rimMesh.castShadow = true
  spin.add(rimMesh)

  const hub = new THREE.Mesh(toAxisX(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 20)), m.chrome)
  hub.position.x = w * 0.6
  spin.add(hub)
  const nut = toAxisX(new THREE.CylinderGeometry(0.016, 0.016, 0.04, 6))
  const hole = toAxisX(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12))
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const n = new THREE.Mesh(nut, m.chrome)
    n.position.set(w * 0.58, Math.sin(a) * 0.14, Math.cos(a) * 0.14)
    spin.add(n)
  }
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2
    const h = new THREE.Mesh(hole, m.black)
    h.position.set(w * 0.45, Math.sin(a) * 0.23, Math.cos(a) * 0.23)
    spin.add(h)
  }
  wheel.userData.spin = spin
  return wheel
}

function buildTractor(m, logo) {
  const group = new THREE.Group()
  const b = new Builder(group)
  const steer = []
  const wheels = []

  // Cab: lower body and roof are bevelled side profiles extruded across the
  // width; the window band between them is open, framed by pillars, so the
  // tinted glass shows the cab interior.
  const depth = 2.33
  const extrude = (points, curve) => {
    const shape = new THREE.Shape()
    shape.moveTo(...points[0])
    for (const pt of points.slice(1)) shape.lineTo(...pt)
    curve?.(shape)
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelOffset: -0.06,
      bevelSegments: 4,
      curveSegments: 12,
    })
    return b.mesh(geo, m.paint, [depth / 2, 0, 0], [0, -Math.PI / 2, 0])
  }
  extrude([
    [3.4, 1.35],
    [5.8, 1.35],
    [5.8, 2.55],
    [3.4, 2.55],
  ]).name = 'cab'
  extrude(
    [
      [3.4, 3.48],
      [5.74, 3.48],
    ],
    (shape) => {
      shape.quadraticCurveTo(5.7, 3.78, 5.42, 3.8)
      shape.lineTo(3.48, 3.8)
      shape.quadraticCurveTo(3.4, 3.8, 3.4, 3.7)
    },
  )
  const bandY = 3.015
  const bandH = 0.95
  b.box([2.45, bandH, 0.1], m.paint, [0, bandY, 3.45])
  for (const sx of [-1, 1]) {
    b.box([0.1, bandH, 0.1], m.paint, [sx * 1.17, bandY, 5.73], [-0.063, 0, 0])
    b.box([0.07, bandH, 0.12], m.paint, [sx * 1.19, bandY, 4.44])
    b.box([0.07, bandH, 0.98], m.paint, [sx * 1.19, bandY, 3.93])
  }

  // Interior: trim floor, dashboard, steering wheel, seats
  const trimInside = new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.85 })
  b.box([2.3, 0.02, 2.25], trimInside, [0, 2.56, 4.6])
  b.box([2.3, 0.94, 0.02], trimInside, [0, bandY, 3.51])
  b.box([2.25, 0.2, 0.42], trimInside, [0, 2.66, 5.5])
  b.box([0.5, 0.06, 0.22], m.black, [0.55, 2.79, 5.45])
  b.mesh(new THREE.TorusGeometry(0.21, 0.025, 8, 28), m.black, [0.55, 2.8, 5.12], [-1.05, 0, 0])
  b.cylinder(0.03, 0.35, m.black, [0.55, 2.68, 5.28], [-1.05, 0, 0])
  for (const sx of [-1, 1]) {
    b.box([0.55, 0.75, 0.12], trimInside, [sx * 0.55, 2.95, 4.12], [-0.12, 0, 0])
    b.box([0.32, 0.22, 0.1], trimInside, [sx * 0.55, 3.43, 4.08])
  }

  // Glazing
  b.box([2.2, 0.93, 0.03], m.glass, [0, bandY, 5.785], [-0.063, 0, 0])
  for (const sx of [-1, 1]) {
    b.box([0.02, 0.9, 1.22], m.glass, [sx * 1.2, bandY, 5.08])
    // Door shut lines and handle
    b.box([0.012, 2.05, 0.015], m.black, [sx * 1.228, 2.5, 4.42])
    b.box([0.012, 0.015, 1.3], m.black, [sx * 1.228, 1.48, 5.07])
    b.box([0.03, 0.04, 0.22], m.chrome, [sx * 1.235, 2.45, 4.62])
    // Mirrors
    b.box([0.28, 0.04, 0.04], m.black, [sx * 1.36, 3.45, 5.58])
    b.box([0.28, 0.04, 0.04], m.black, [sx * 1.36, 2.7, 5.58])
    b.box([0.09, 0.48, 0.24], m.black, [sx * 1.5, 3.07, 5.58])
    b.box([0.07, 0.24, 0.2], m.black, [sx * 1.42, 2.55, 5.62])
    // Steps under the door
    b.box([0.04, 0.75, 0.62], m.paint, [sx * 1.2, 0.95, 5.0])
    for (const y of [0.62, 1.0]) b.box([0.34, 0.04, 0.55], m.alu, [sx * 1.04, y, 5.0])
    // Lights
    b.box([0.52, 0.24, 0.06], m.black, [sx * 0.82, 1.5, 5.79])
    b.box([0.46, 0.17, 0.02], m.head, [sx * 0.82, 1.5, 5.825])
    b.box([0.12, 0.17, 0.02], m.amber, [sx * 1.14, 1.5, 5.825])
    b.box([0.16, 0.08, 0.02], m.head, [sx * 0.95, 0.83, 5.9])
  }
  // Grille, badge, bumper, visor
  b.box([1.85, 0.75, 0.03], m.black, [0, 1.98, 5.805])
  for (let i = 0; i < 5; i++) b.box([1.8, 0.035, 0.02], m.chrome, [0, 1.68 + i * 0.13, 5.825])
  const badge = b.mesh(new THREE.PlaneGeometry(0.62, 0.38), m.badge, [0, 2.43, 5.83])
  badge.castShadow = false
  b.box([2.5, 0.42, 0.32], m.trim, [0, 1.08, 5.72])
  b.box([2.3, 0.18, 0.22], m.black, [0, 0.8, 5.72])
  b.box([2.32, 0.1, 0.36], m.paint, [0, 3.6, 5.74], [0.18, 0, 0])
  for (let i = -2; i <= 2; i++) b.box([0.12, 0.05, 0.06], m.amber, [i * 0.3, 3.85, 5.45])
  b.cylinder(0.09, 0.14, m.amber, [-0.75, 3.88, 3.9])

  // Chassis
  for (const sx of [-1, 1]) b.box([0.1, 0.3, 6.3], m.black, [sx * 0.43, 0.95, 1.75])
  for (const z of [-1.2, 0.8, 2.6, 4.6]) b.box([0.86, 0.12, 0.1], m.black, [0, 0.95, z])
  b.box([1.0, 0.12, 0.9], m.trim, [0, 1.18, TRACTOR.kingpin])
  b.box([0.6, 0.1, 0.5], m.black, [0, 1.08, TRACTOR.kingpin])

  // Fuel tank (left), battery box + air tanks (right)
  b.cylinder(0.3, 1.4, m.alu, [1.0, 0.78, 2.0], [Math.PI / 2, 0, 0], undefined, 28)
  for (const z of [1.5, 2.5]) b.box([0.62, 0.62, 0.04], m.black, [1.0, 0.78, z])
  b.box([0.5, 0.48, 0.8], m.black, [-1.0, 0.78, 2.3])
  b.cylinder(0.14, 0.9, m.alu, [-0.85, 0.6, 1.2], [Math.PI / 2, 0, 0])

  // Exhaust stack with heat shield, air lines on the cab back
  b.cylinder(0.085, 2.7, m.chrome, [-1.0, 2.55, 3.25])
  b.cylinder(0.11, 0.9, m.alu, [-1.0, 2.9, 3.25])
  b.cylinder(0.085, 0.25, m.chrome, [-1.0, 3.95, 3.35], [0.8, 0, 0])
  const coil = new THREE.TorusGeometry(0.12, 0.012, 6, 24)
  b.mesh(coil, m.red, [0.25, 2.0, 3.32])
  b.mesh(coil, new THREE.MeshStandardMaterial({ color: '#1844c8', roughness: 0.5 }), [0.55, 2.0, 3.32])

  // Mudguards and flaps
  const arch = new THREE.CylinderGeometry(0.64, 0.64, 0.42, 24, 1, true, 0, Math.PI)
  arch.rotateZ(Math.PI / 2)
  const fenderMat = m.black.clone()
  fenderMat.side = THREE.DoubleSide
  for (const sx of [-1, 1]) {
    b.mesh(arch, fenderMat, [sx * 1.04, WHEEL_R, TRACTOR.wheelbase])
    b.box([0.72, 0.05, 1.3], m.black, [sx * 0.92, 1.2, 0])
    b.box([0.6, 0.55, 0.02], m.black, [sx * 0.92, 0.55, -0.68])
    b.box([0.1, 0.08, 0.04], m.red, [sx * 0.6, 0.95, -1.42])
  }

  // Wheels: steered singles at the front, duals at the rear
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(sx * 1.04, WHEEL_R, TRACTOR.wheelbase)
    const w = createWheel(m)
    if (sx < 0) w.rotation.y = Math.PI
    pivot.add(w)
    group.add(pivot)
    steer.push(pivot)
    wheels.push(w)
    for (const x of [0.76, 1.08]) {
      const r = createWheel(m)
      r.position.set(sx * x, WHEEL_R, 0)
      if (sx < 0) r.rotation.y = Math.PI
      group.add(r)
      wheels.push(r)
    }
  }
  b.cylinder(0.07, 2.0, m.black, [0, WHEEL_R, 0], [0, 0, Math.PI / 2])

  return { group, steer, wheels }
}

function buildTrailer(m) {
  const group = new THREE.Group()
  const b = new Builder(group)
  const wheels = []
  const length = TRAILER.front - TRAILER.rear
  const mid = TRAILER_CENTER
  const top = TRAILER.deck

  // Frame: main beams, outer rails, cross members, bolsters
  for (const sx of [-1, 1]) {
    b.box([0.14, 0.3, length - 0.1], m.paint, [sx * 0.5, top - 0.15, mid])
    b.box([0.16, 0.24, length], [m.rail, m.rail, m.paint, m.paint, m.paint, m.paint], [sx * 1.19, top - 0.12, mid])
    for (let z = TRAILER.rear + 1; z < TRAILER.front - 0.5; z += 2.5) b.box([0.04, 0.06, 0.1], m.amber, [sx * 1.28, top - 0.15, z])
  }
  for (let z = TRAILER.rear + 0.4; z < TRAILER.front - 0.2; z += 0.75) b.box([2.24, 0.12, 0.1], m.black, [0, top - 0.2, z])
  b.box([2.5, 0.26, 0.22], m.paint, [0, top - 0.13, TRAILER.front - 0.11])
  b.box([2.5, 0.26, 0.22], m.paint, [0, top - 0.13, TRAILER.rear + 0.11])
  b.box([1.4, 0.05, 1.2], m.trim, [0, 1.22, TRAILER.kingpin])

  // Twist-locks for 40ft and 20ft positions
  const lockZ = [TRAILER.rear + 0.15, TRAILER.front - 0.15, mid - 3.03, mid + 3.03]
  for (const z of lockZ) for (const sx of [-1, 1]) b.box([0.12, 0.07, 0.14], m.alu, [sx * 1.13, top + 0.035, z])

  // Landing gear
  for (const sx of [-1, 1]) {
    b.box([0.12, 1.15, 0.14], m.black, [sx * 0.85, 0.73, 7.4])
    b.box([0.3, 0.05, 0.32], m.black, [sx * 0.85, 0.12, 7.4])
  }
  b.box([1.7, 0.06, 0.06], m.black, [0, 0.9, 7.4])
  b.box([0.04, 0.04, 0.35], m.alu, [0.98, 0.95, 7.55])

  // Axles, air suspension, wheels
  for (const z of TRAILER.axles) {
    b.cylinder(0.07, 2.0, m.black, [0, WHEEL_R, z], [0, 0, Math.PI / 2])
    for (const sx of [-1, 1]) {
      b.cylinder(0.14, 0.28, m.black, [sx * 0.55, 1.0, z])
      const w = createWheel(m, 0.38)
      w.position.set(sx * 1.0, WHEEL_R, z)
      if (sx < 0) w.rotation.y = Math.PI
      group.add(w)
      wheels.push(w)
    }
  }
  for (const sx of [-1, 1]) {
    b.box([0.48, 0.04, 4.1], m.black, [sx * 1.0, 1.15, 0])
    b.box([0.5, 0.55, 0.02], m.black, [sx * 1.0, 0.62, -2.0])
  }
  // Spare wheel cradle
  const spare = createWheel(m, 0.38)
  spare.rotation.z = Math.PI / 2
  spare.position.set(0, 0.85, 4.8)
  group.add(spare)

  // Rear: under-run bar, light bar, plate
  b.box([2.3, 0.12, 0.12], m.alu, [0, 0.52, TRAILER.rear - 0.02])
  for (const sx of [-1, 1]) {
    b.box([0.08, 0.6, 0.08], m.black, [sx * 0.8, 0.82, TRAILER.rear + 0.05])
    b.box([0.22, 0.12, 0.03], m.red, [sx * 0.95, 1.12, TRAILER.rear - 0.05])
    b.box([0.1, 0.12, 0.03], m.amber, [sx * 1.15, 1.12, TRAILER.rear - 0.05])
    b.box([0.12, 0.12, 0.03], m.reverse, [sx * 0.7, 1.12, TRAILER.rear - 0.05])
  }
  b.box([2.42, 0.18, 0.06], m.black, [0, 1.12, TRAILER.rear - 0.01])
  b.box([0.52, 0.12, 0.02], new THREE.MeshStandardMaterial({ color: '#f1d22a', roughness: 0.5 }), [0, 0.8, TRAILER.rear - 0.04])

  return { group, wheels }
}

export default class Truck {
  constructor(logo) {
    this.m = materials(logo)
    this.group = new THREE.Group()
    this.tractor = buildTractor(this.m, logo)
    this.trailer = buildTrailer(this.m)
    this.group.add(this.tractor.group, this.trailer.group)
    this.center = new THREE.Vector3()
  }

  // Places the rig so the trailer's middle axle sits at arc length `s` on
  // `path`. `dir` is the direction of increasing s relative to the cab:
  // -1 when the path is driven in reverse (trailer leading), +1 forwards.
  // `travelled` is the signed distance driven, for wheel rotation. Paths may
  // supply bankAt(s) for road camber; slopes come from the points' heights.
  follow(path, s, { dir = -1, travelled = -s, reversing = false } = {}) {
    const bank = (at) => path.bankAt?.(at) ?? 0
    const rear = path.pointAt(s)
    const fTrailer = path.pointAt(s + dir * TRAILER.kingpin).sub(rear).normalize()
    const trailer = this.trailer.group
    trailer.position.copy(rear)
    trailer.lookAt(rear.clone().add(fTrailer))
    trailer.rotateZ(bank(s + (dir * TRAILER.kingpin) / 2))

    const kingpin = rear.clone().addScaledVector(fTrailer, TRAILER.kingpin)
    const reach = TRAILER.kingpin + TRACTOR.wheelbase + TRACTOR.kingpin
    const sFront = s + dir * reach
    const front = path.pointAt(sFront)
    const fTractor = front.clone().sub(kingpin).normalize()
    const tractor = this.tractor.group
    tractor.position.copy(kingpin).addScaledVector(fTractor, -TRACTOR.kingpin)
    tractor.lookAt(tractor.position.clone().add(fTractor))
    tractor.rotateZ(bank(s + dir * (reach - TRACTOR.wheelbase / 2)))

    // Front wheels point along the path their axle is travelling
    const lead = path.pointAt(sFront + dir * 0.5).sub(front)
    lead.y = 0
    lead.normalize()
    const flat = fTractor.clone().setY(0).normalize()
    const steer = Math.atan2(flat.z * lead.x - flat.x * lead.z, flat.dot(lead))
    for (const pivot of this.tractor.steer) pivot.rotation.y = THREE.MathUtils.clamp(steer, -0.6, 0.6)

    const roll = travelled / WHEEL_R
    for (const w of [...this.tractor.wheels, ...this.trailer.wheels]) w.userData.spin.rotation.x = w.rotation.y ? -roll : roll

    this.m.reverse.emissiveIntensity = reversing ? 2 : 0
    this.center.copy(rear).addScaledVector(fTrailer, TRAILER_CENTER)
    this.group.updateMatrixWorld(true)
  }
}
