import * as THREE from 'three'
import gsap from 'gsap'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { paintCanvas, roughnessCanvas, woodCanvas, sideCanvas, doorCanvas, toTexture } from './textures.js'

// ISO 20ft dry container, in metres. Length runs along Z, doors face +Z.
export const SIZE = { length: 6.058, width: 2.438, height: 2.591 }
const { length: L, width: W, height: H } = SIZE

const CAST = { x: 0.178, y: 0.118, z: 0.162 }
const DOOR = { width: W / 2 - 0.085, height: 2.3, bottom: 0.12 }
const HINGES = [0.08, 0.36, 0.64, 0.92]
const RIBS = [0.12, 0.36, 0.58, 0.8]
const BARS = [0.4, 0.82]
const HANDLE_V = 0.47

const OPEN_ANGLE = 1.62
const UNLOCK_ANGLE = 1.35

// Collects transformed geometries per material and merges them, so a whole
// container body renders in a handful of draw calls.
class Parts {
  constructor() {
    this.buckets = new Map()
    this.dummy = new THREE.Object3D()
  }

  add(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], order = 'XYZ') {
    this.dummy.position.set(...position)
    this.dummy.rotation.set(...rotation, order)
    this.dummy.updateMatrix()
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    g.applyMatrix4(this.dummy.matrix)
    if (!this.buckets.has(material)) this.buckets.set(material, [])
    this.buckets.get(material).push(g)
  }

  box(size, material, position, rotation) {
    this.add(new THREE.BoxGeometry(...size), material, position, rotation)
  }

  build(target = new THREE.Group()) {
    for (const [material, geometries] of this.buckets) {
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material)
      mesh.castShadow = mesh.receiveShadow = true
      target.add(mesh)
    }
    return target
  }
}

// Trapezoidal corrugated sheet in the XY plane, facing +Z, centred on the origin.
export function corrugated(length, height, pitch, depth) {
  const flat = pitch * 0.26
  const slope = pitch * 0.24
  const d = depth / 2
  const pts = []
  for (let x0 = 0; x0 < length; x0 += pitch) {
    pts.push([x0, d], [x0 + flat, d], [x0 + flat + slope, -d], [x0 + 2 * flat + slope, -d])
  }
  const profile = pts.filter(([x]) => x < length)
  profile.push([length, profile[profile.length - 1][1]])

  const position = []
  const normal = []
  const uv = []
  for (let i = 0; i < profile.length - 1; i++) {
    const [x0, z0] = profile[i]
    const [x1, z1] = profile[i + 1]
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 1e-6) continue
    const nx = -(z1 - z0) / len
    const nz = (x1 - x0) / len
    const quad = [
      [x0, 0, z0],
      [x1, 0, z1],
      [x1, height, z1],
      [x0, 0, z0],
      [x1, height, z1],
      [x0, height, z0],
    ]
    for (const [x, y, z] of quad) {
      position.push(x - length / 2, y - height / 2, z)
      normal.push(nx, 0, nz)
      uv.push(x / length, y / height)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return geometry
}

let shared
function sharedMaterials() {
  if (shared) return shared
  const roughnessMap = toTexture(roughnessCanvas(), { srgb: false })
  const interiorMap = toTexture(paintCanvas(512, 512, '#b7babb', 41, { rustAmount: 0.6 }))
  shared = {
    roughnessMap,
    interior: new THREE.MeshStandardMaterial({ map: interiorMap, roughnessMap, roughness: 1, metalness: 0.2, side: THREE.BackSide }),
    floor: new THREE.MeshStandardMaterial({ map: toTexture(woodCanvas()), roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: '#8f9498', roughnessMap, roughness: 0.75, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#1b1a19', roughness: 0.95 }),
    orange: new THREE.MeshStandardMaterial({ color: '#d4631c', roughness: 0.6, metalness: 0.3 }),
  }
  return shared
}

const painted = (map, roughnessMap) =>
  new THREE.MeshStandardMaterial({ map, roughnessMap, roughness: 1.15, metalness: 0.35 })

function buildDoor(s, front, m) {
  const { width: dw, height: dh, bottom: y0 } = DOOR
  const cy = y0 + dh / 2
  const fz = -0.005 // front face, relative to the hinge pin
  const lip = 0.045

  const door = new THREE.Group()
  door.name = s === 1 ? 'doorLeft' : 'doorRight'
  door.position.set(-s * (W / 2 - 0.06), 0, L / 2 + 0.02)

  const panel = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.05), [m.paint, m.paint, m.paint, m.paint, front, m.paint])
  panel.position.set(s * (0.02 + dw / 2), cy, -0.03)
  panel.castShadow = panel.receiveShadow = true
  door.add(panel)

  const parts = new Parts()
  const cx = s * (0.02 + dw / 2)
  const lz = fz + 0.008

  // Pressed border and horizontal stiffeners
  parts.box([dw, lip, 0.016], m.paint, [cx, y0 + dh - lip / 2, lz])
  parts.box([dw, lip, 0.016], m.paint, [cx, y0 + lip / 2, lz])
  parts.box([lip, dh - 2 * lip, 0.016], m.paint, [s * (0.02 + lip / 2), cy, lz])
  parts.box([lip, dh - 2 * lip, 0.016], m.paint, [s * (0.02 + dw - lip / 2), cy, lz])
  for (const v of RIBS) parts.box([dw - 2 * lip, 0.13, 0.03], m.paint, [cx, y0 + v * dh, fz + 0.015])

  // Seals
  parts.box([0.012, dh, 0.03], m.rubber, [s * (0.02 + dw + 0.004), cy, -0.03])
  parts.box([0.012, dh, 0.03], m.rubber, [s * 0.016, cy, -0.03])

  for (const v of HINGES) parts.box([0.17, 0.05, 0.014], m.paint, [s * 0.085, y0 + v * dh, fz + 0.007])

  const hy = y0 + HANDLE_V * dh
  for (const f of BARS) {
    const bx = s * (0.02 + f * dw)
    const bz = fz + 0.03

    // Guides on the door leaf
    for (const gy of [y0 + 0.25, y0 + dh - 0.25, hy + 0.07]) parts.box([0.07, 0.045, 0.04], m.steel, [bx, gy, bz - 0.01])
    // Handle retainer
    parts.box([0.05, 0.08, 0.07], m.orange, [bx - s * 0.29, hy, fz + 0.04])

    // Lock rod with cams and handle — rotates about its own axis
    const bar = new THREE.Group()
    bar.name = 'lockBar'
    bar.position.set(bx, cy, bz)
    const rod = new Parts()
    rod.add(new THREE.CylinderGeometry(0.017, 0.017, dh + 0.16, 12), m.steel)
    rod.box([0.05, 0.05, 0.07], m.steel, [0, dh / 2 + 0.06, 0])
    rod.box([0.05, 0.05, 0.07], m.steel, [0, -(dh / 2 + 0.06), 0])
    rod.box([0.05, 0.06, 0.05], m.steel, [0, hy - cy, 0.02])
    rod.box([0.32, 0.025, 0.018], m.steel, [-s * 0.17, hy - cy, 0.04])
    rod.box([0.06, 0.03, 0.03], m.steel, [-s * 0.32, hy - cy, 0.045])
    rod.build(bar)
    door.add(bar)
  }

  if (s === -1) parts.box([0.1, 0.09, 0.05], m.paint, [s * (0.02 + dw - 0.07), hy, fz + 0.025])
  else parts.box([0.04, 0.06, 0.04], m.steel, [s * (0.02 + dw - 0.04), hy, fz + 0.02])

  parts.build(door)
  return door
}

// Builds one fully detailed container. Clone the result for more instances
// (geometry and materials are shared between clones).
export function createContainer({ color, logo, seed = 1 }) {
  const base = sharedMaterials()
  const m = {
    ...base,
    paint: painted(toTexture(paintCanvas(1024, 1024, color, seed)), base.roughnessMap),
    side: painted(toTexture(sideCanvas(logo, color, seed + 1)), base.roughnessMap),
  }
  const doorLeftMat = painted(toTexture(doorCanvas(logo, color, seed + 2, 'left')), base.roughnessMap)
  const doorRightMat = painted(toTexture(doorCanvas(logo, color, seed + 3, 'right')), base.roughnessMap)

  const container = new THREE.Group()
  const body = new Parts()

  // Corrugated walls and roof (outer paint + inner lining from the back faces)
  const wallH = H - 0.2
  const wallY = H / 2 + 0.02
  const side = corrugated(L - 0.24, wallH, 0.278, 0.036)
  for (const sx of [-1, 1]) {
    const pos = [sx * (W / 2 - 0.04), wallY, 0]
    const rot = [0, (sx * Math.PI) / 2, 0]
    body.add(side, m.side, pos, rot)
    body.add(side, m.interior, pos, rot)
  }
  const end = corrugated(W - 0.24, wallH, 0.278, 0.036)
  body.add(end, m.paint, [0, wallY, -L / 2 + 0.04], [0, Math.PI, 0])
  body.add(end, m.interior, [0, wallY, -L / 2 + 0.04], [0, Math.PI, 0])
  const roof = corrugated(L - 0.3, W - 0.1, 0.2, 0.022)
  body.add(roof, m.paint, [0, H - 0.035, 0], [-Math.PI / 2, Math.PI / 2, 0], 'YXZ')
  body.add(roof, m.interior, [0, H - 0.035, 0], [-Math.PI / 2, Math.PI / 2, 0], 'YXZ')

  // Corner castings with their twist-lock apertures
  for (const sx of [-1, 1])
    for (const top of [0, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (W / 2 - CAST.x / 2)
        const y = top ? H - CAST.y / 2 : CAST.y / 2
        const z = sz * (L / 2 - CAST.z / 2)
        body.box([CAST.x, CAST.y, CAST.z], m.paint, [x, y, z])
        body.box([0.01, 0.05, 0.09], m.dark, [sx * (W / 2 + 0.002), y, z])
        body.box([0.09, 0.05, 0.01], m.dark, [x, y, sz * (L / 2 + 0.002)])
        body.box([0.1, 0.01, 0.06], m.dark, [x, top ? H + 0.002 : -0.002, z])
      }

  // Frame: corner posts, side rails, end rails, door header and sill
  for (const sx of [-1, 1]) {
    body.box([0.12, H - 2 * CAST.y, 0.12], m.paint, [sx * (W / 2 - 0.06), H / 2, L / 2 - 0.1])
    body.box([0.12, H - 2 * CAST.y, 0.1], m.paint, [sx * (W / 2 - 0.06), H / 2, -(L / 2 - 0.07)])
    body.box([0.07, 0.1, L - 2 * CAST.z], m.paint, [sx * (W / 2 - 0.035), H - 0.05, 0])
    body.box([0.08, 0.16, L - 2 * CAST.z], m.paint, [sx * (W / 2 - 0.04), 0.08, 0])
    for (const z of [-0.9, 0.9]) body.box([0.02, 0.1, 0.36], m.dark, [sx * (W / 2 + 0.001), 0.07, z])
  }
  body.box([W - 2 * CAST.x, 0.12, 0.1], m.paint, [0, H - 0.06, -(L / 2 - 0.05)])
  body.box([W - 2 * CAST.x, 0.16, 0.1], m.paint, [0, 0.08, -(L / 2 - 0.05)])
  body.box([W - 2 * CAST.x, 0.21, 0.12], m.paint, [0, H - 0.105, L / 2 - 0.1])
  body.box([W - 2 * CAST.x, 0.17, 0.12], m.paint, [0, 0.085, L / 2 - 0.1])
  body.box([W - 0.16, 0.02, L - 0.33], m.dark, [0, 0.02, 0])

  // Timber floor
  body.add(new THREE.PlaneGeometry(W - 0.16, L - 0.2), m.floor, [0, 0.171, 0.02], [-Math.PI / 2, 0, 0])

  // Lashing rings on the rear corner posts
  const ring = new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI)
  for (const sx of [-1, 1])
    for (const y of [0.35, 0.95, 1.55, 2.15]) body.add(ring, m.paint, [sx * (W / 2 - 0.01), y, L / 2 - 0.03], [0, 0, (-sx * Math.PI) / 2])

  // Hinge pins, lock-rod keepers
  for (const s of [1, -1]) {
    const px = -s * (W / 2 - 0.06)
    for (const v of HINGES) {
      const y = DOOR.bottom + v * DOOR.height
      body.add(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 10), m.steel, [px, y, L / 2 + 0.02])
      body.box([0.05, 0.1, 0.07], m.paint, [px, y, L / 2 - 0.01])
    }
    for (const f of BARS) {
      const x = px + s * (0.02 + f * DOOR.width)
      const z = L / 2 + 0.015
      body.box([0.07, 0.06, 0.11], m.steel, [x, DOOR.bottom + DOOR.height + 0.08, z])
      body.box([0.07, 0.06, 0.11], m.steel, [x, DOOR.bottom - 0.08, z])
    }
  }

  body.build(container)
  container.add(buildDoor(1, doorLeftMat, m), buildDoor(-1, doorRightMat, m))
  container.userData.materials = { ...m, doorLeft: doorLeftMat, doorRight: doorRightMat }
  return container
}

// Real-world door sequence as a paused timeline: lift the handles, swing the
// right leaf, then the left, and stow the handles. Scrub its progress
// (0 = closed and locked, 1 = fully open); reversing it closes the doors
// left leaf first, then locks them.
export function doorSequence(container) {
  const left = container.getObjectByName('doorLeft')
  const right = container.getObjectByName('doorRight')
  const bars = (door) => door.children.filter((c) => c.name === 'lockBar').map((c) => c.rotation)
  const ease = 'power2.inOut'
  const unlock = (s) => ({ y: s * UNLOCK_ANGLE, duration: 0.7, ease, stagger: 0.15 })
  const stow = { y: 0, duration: 0.6, ease, stagger: 0.1 }

  return gsap
    .timeline({ paused: true })
    .to(bars(right), unlock(-1))
    .to(right.rotation, { y: OPEN_ANGLE, duration: 2.4, ease })
    .to(bars(right), stow, '<0.4')
    .to(bars(left), unlock(1), '-=1.2')
    .to(left.rotation, { y: -OPEN_ANGLE, duration: 2.4, ease })
    .to(bars(left), stow, '<0.4')
}

// Packs the container with cartons from the front wall up to `frontZ`,
// with a ragged, partly-loaded front face. One instanced mesh.
export function fillWithCargo(container, material, frontZ, { size = [0.44, 0.32, 0.34], seed = 7 } = {}) {
  let s = seed
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  const [bw, bh, bd] = size
  const gap = 0.012
  const cols = Math.floor((W - 0.12) / (bw + gap))
  const rows = Math.floor((frontZ - (-L / 2 + 0.1)) / (bd + gap))
  const layers = 6
  const floor = 0.171
  const x0 = -((cols - 1) * (bw + gap)) / 2
  const z0 = frontZ - bd / 2 - (rows - 1) * (bd + gap)

  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(bw, bh, bd), material, cols * rows * layers)
  const dummy = new THREE.Object3D()
  let n = 0
  for (let r = 0; r < rows; r++) {
    const fromFront = rows - 1 - r
    for (let c = 0; c < cols; c++) {
      // Front two rows are only partly built up
      const height = fromFront === 0 ? 2 + Math.floor(rand() * 4) : fromFront === 1 ? 4 + Math.floor(rand() * 3) : layers
      for (let l = 0; l < Math.min(height, layers); l++) {
        if (l === layers - 1 && rand() < 0.15) continue
        dummy.position.set(x0 + c * (bw + gap) + (rand() - 0.5) * 0.02, floor + bh / 2 + l * (bh + 0.004), z0 + r * (bd + gap) + (rand() - 0.5) * 0.02)
        dummy.rotation.set(0, (rand() - 0.5) * 0.05 + (rand() < 0.5 ? Math.PI : 0), 0)
        dummy.scale.set(0.93 + rand() * 0.07, 1, 0.93 + rand() * 0.07)
        dummy.updateMatrix()
        mesh.setMatrixAt(n++, dummy.matrix)
      }
    }
  }
  mesh.count = n
  mesh.castShadow = mesh.receiveShadow = true
  container.add(mesh)
  return mesh
}

// Lighter build of the same container (same textures and materials, closed
// doors, no interior) for drawing hundreds at once as an InstancedMesh.
export function createContainerInstances(prototype, count) {
  const m = prototype.userData.materials
  const parts = new Parts()
  const wallH = H - 0.2
  const wallY = H / 2 + 0.02
  const side = corrugated(L - 0.24, wallH, 0.278, 0.036)
  for (const sx of [-1, 1]) parts.add(side, m.side, [sx * (W / 2 - 0.04), wallY, 0], [0, (sx * Math.PI) / 2, 0])
  parts.add(corrugated(W - 0.24, wallH, 0.278, 0.036), m.paint, [0, wallY, -L / 2 + 0.04], [0, Math.PI, 0])
  parts.add(corrugated(L - 0.3, W - 0.1, 0.2, 0.022), m.paint, [0, H - 0.035, 0], [-Math.PI / 2, Math.PI / 2, 0], 'YXZ')

  for (const sx of [-1, 1])
    for (const top of [0, 1])
      for (const sz of [-1, 1])
        parts.box([CAST.x, CAST.y, CAST.z], m.paint, [sx * (W / 2 - CAST.x / 2), top ? H - CAST.y / 2 : CAST.y / 2, sz * (L / 2 - CAST.z / 2)])
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.box([0.12, H - 2 * CAST.y, 0.12], m.paint, [sx * (W / 2 - 0.06), H / 2, sz * (L / 2 - 0.07)])
    parts.box([0.07, 0.1, L - 2 * CAST.z], m.paint, [sx * (W / 2 - 0.035), H - 0.05, 0])
    parts.box([0.08, 0.16, L - 2 * CAST.z], m.paint, [sx * (W / 2 - 0.04), 0.08, 0])
    for (const z of [-0.9, 0.9]) parts.box([0.02, 0.1, 0.36], m.dark, [sx * (W / 2 + 0.001), 0.07, z])
  }
  for (const sz of [-1, 1]) {
    parts.box([W - 2 * CAST.x, 0.16, 0.1], m.paint, [0, 0.08, sz * (L / 2 - 0.05)])
    parts.box([W - 2 * CAST.x, 0.2, 0.1], m.paint, [0, H - 0.1, sz * (L / 2 - 0.05)])
  }

  // Door end: textured leaves, stiffener ribs, lock rods, handles
  const { width: dw, height: dh, bottom: y0 } = DOOR
  for (const s of [1, -1]) {
    const cx = -s * (W / 2 - 0.06) + s * (0.02 + dw / 2)
    parts.add(new THREE.PlaneGeometry(dw, dh), s === 1 ? m.doorLeft : m.doorRight, [cx, y0 + dh / 2, L / 2 - 0.005])
    for (const v of RIBS) parts.box([dw - 0.1, 0.13, 0.03], m.paint, [cx, y0 + v * dh, L / 2 + 0.01])
    for (const f of BARS) {
      const bx = -s * (W / 2 - 0.06) + s * (0.02 + f * dw)
      parts.box([0.035, dh + 0.16, 0.035], m.steel, [bx, y0 + dh / 2, L / 2 + 0.045])
      parts.box([0.32, 0.025, 0.018], m.steel, [bx - s * 0.17, y0 + HANDLE_V * dh, L / 2 + 0.065])
      parts.box([0.05, 0.08, 0.05], m.orange, [bx - s * 0.29, y0 + HANDLE_V * dh, L / 2 + 0.035])
    }
  }

  // One geometry with a group per material
  const materials = []
  const geometries = []
  for (const [material, geos] of parts.buckets) {
    materials.push(material)
    geometries.push(mergeGeometries(geos))
  }
  const mesh = new THREE.InstancedMesh(mergeGeometries(geometries, true), materials, count)
  mesh.castShadow = mesh.receiveShadow = true
  mesh.frustumCulled = false
  return mesh
}
