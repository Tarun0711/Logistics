import * as THREE from 'three'
import { asphaltCanvas, rng } from './textures.js'

// The drive from the yard to the port: a 3D centreline with hills, banked
// curves, a ribbon road mesh, terrain shaped around it, and trees.

export const QUAY_X = 250 // seaward edge of the port
export const TRUCK_LANE_X = QUAY_X - 6 // quay-edge lane where the truck stops, ship alongside
export const BERTH_Z = 20 // trailer centre (and crane centre) along the quay
export const PORT_START_X = 195
export const BERTH_X = QUAY_X + 16.5 // ship centreline alongside the quay
// Crane span centre: between the truck lane and the ship's centreline
export const CRANE_POS = new THREE.Vector3(QUAY_X + 6, 0, BERTH_Z)
// Same carriageway as the yard lane (yellow edges at z 9 and 22, centre 15.5):
// 13 m wide, centred 2 m to the left of the truck, which keeps to the right lane
const ROAD_WIDTH = 13
const LANE_OFFSET = 2
const ROAD_TILE = 12 // metres of road per texture repeat
const SAMPLE = 0.5

// Trailer middle-axle centreline, starting where the truck is parked
// (x 4.6, facing +Z) and ending with the trailer centred under the crane.
const TRAILER_HALF = 4.05
const CONTROL = [
  [4.6, 0, -4.05],
  [4.6, 0, 4.65],
  [4.6, 0, 8.7],
  [5.4, 0, 13],
  [9, 0, 16.6],
  [16, 0, 17.5],
  [40, 0, 17.5],
  [64, 0, 17.5],
  [84, 0, 18.5],
  [104, 1.8, 29],
  [126, 4.5, 34],
  [146, 5.5, 19],
  [161, 3.8, -6],
  [179, 1.5, -28],
  [204, 0.2, -40],
  [228, 0, -38],
  [240, 0, -26],
  [TRUCK_LANE_X, 0, -8],
  [TRUCK_LANE_X, 0, BERTH_Z - TRAILER_HALF],
]

const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// Arc-length sampled path with banking. pointAt/bankAt extrapolate straight
// past either end.
class RoadPath {
  constructor(points) {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
      false,
      'centripetal',
    )
    this.length = curve.getLength()
    const n = Math.ceil(this.length / SAMPLE)
    this.points = curve.getSpacedPoints(n)
    this.step = this.length / n

    // Signed curvature from heading change, smoothed, scaled into a bank
    // angle (lower on the inside of the turn); none in the yard or port.
    const heading = this.points.map((p, i) => {
      const a = this.points[Math.max(i - 1, 0)]
      const b = this.points[Math.min(i + 1, n)]
      return Math.atan2(b.x - a.x, b.z - a.z)
    })
    const raw = heading.map((h, i) => {
      if (i === 0 || i === n) return 0
      let d = heading[i + 1] - heading[i - 1]
      d = Math.atan2(Math.sin(d), Math.cos(d))
      return d / (2 * this.step)
    })
    const window = Math.round(12 / this.step)
    this.banks = raw.map((_, i) => {
      let sum = 0
      let count = 0
      for (let k = i - window; k <= i + window; k++) {
        if (k < 0 || k > n) continue
        sum += raw[k]
        count++
      }
      const x = this.points[i].x
      const rural = smooth(75, 95, x) * (1 - smooth(PORT_START_X - 15, PORT_START_X, x))
      return THREE.MathUtils.clamp(-(sum / count) * 18, -0.09, 0.09) * rural
    })
  }

  sample(array, s) {
    const f = THREE.MathUtils.clamp(s / this.step, 0, this.points.length - 1)
    const i = Math.min(Math.floor(f), this.points.length - 2)
    return [array[i], array[i + 1], f - i]
  }

  pointAt(s) {
    const last = this.points.length - 1
    if (s < 0) return this.points[0].clone().addScaledVector(this.points[1].clone().sub(this.points[0]).normalize(), s)
    if (s > this.length)
      return this.points[last].clone().addScaledVector(this.points[last].clone().sub(this.points[last - 1]).normalize(), s - this.length)
    const [a, b, t] = this.sample(this.points, s)
    return a.clone().lerp(b, t)
  }

  bankAt(s) {
    const [a, b, t] = this.sample(this.banks, s)
    return a + (b - a) * t
  }
}

export const route = new RoadPath(CONTROL)

function canvasTexture(w, h, draw, { srgb = true } = {}) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

// Yard asphalt (same canvas, same metres per tile as the yard ground) with
// the yard's markings: yellow edge lines and a 3 m on / 3 m off white centre
function roadTexture() {
  const asphalt = asphaltCanvas()
  const yardTile = 140 / 18 // yard ground: 140 m wide, texture repeated 18 times
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const pxU = w / ROAD_WIDTH
    const pxV = h / ROAD_TILE
    const tw = yardTile * pxU
    const th = yardTile * pxV
    for (let y = 0; y < h; y += th) for (let x = 0; x < w; x += tw) ctx.drawImage(asphalt, x, y, tw, th)
    ctx.fillStyle = '#d8b21c'
    const edge = 0.15 * pxU
    ctx.fillRect(0, 0, edge, h)
    ctx.fillRect(w - edge, 0, edge, h)
    ctx.fillStyle = '#e6e6e1'
    const centre = 0.12 * pxU
    for (let m = 0; m < ROAD_TILE; m += 6) ctx.fillRect(w / 2 - centre / 2, m * pxV, centre, 3 * pxV)
  })
}

function grassTexture() {
  const rand = rng(311)
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6f7c45'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 160; i++) {
      const x = rand() * w
      const y = rand() * h
      const r = 20 + rand() * 90
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, rand() < 0.5 ? 'rgba(140,130,80,0.25)' : 'rgba(60,80,35,0.3)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    for (let i = 0; i < 40000; i++) {
      ctx.fillStyle = `rgba(${60 + rand() * 80},${80 + rand() * 70},${30 + rand() * 30},0.5)`
      ctx.fillRect(rand() * w, rand() * h, 1, 1 + rand() * 3)
    }
  })
}

// Natural terrain height before the road and flat zones are cut in
const hills = (x, z) =>
  6 * Math.sin(x * 0.012 + 0.7) * Math.cos(z * 0.01) + 3.2 * Math.sin(x * 0.031 + 1.3) * Math.sin(z * 0.027 + 0.4) + 1.4 * Math.sin(x * 0.07 + z * 0.05)

// Centreline samples with their horizontal left vector and bank, so the
// ground can follow the road's real (offset, cambered) surface
const coarse = []
for (let s = 0; s <= route.length; s += 2) {
  const t = route.pointAt(s + 1).sub(route.pointAt(s - 1))
  coarse.push({ p: route.pointAt(s), left: new THREE.Vector3(t.z, 0, -t.x).normalize(), bank: route.bankAt(s) })
}
const nearestRoad = (x, z) => {
  let best = Infinity
  let near = coarse[0]
  for (const c of coarse) {
    const d = (c.p.x - x) ** 2 + (c.p.z - z) ** 2
    if (d < best) {
      best = d
      near = c
    }
  }
  return [Math.sqrt(best), near]
}
// Road surface height under (x, z), and how far outside the verge it is
const roadSurface = (x, z) => {
  const [, { p, left, bank }] = nearestRoad(x, z)
  const lateral = (x - p.x) * left.x + (z - p.z) * left.z
  const outside = Math.abs(lateral - LANE_OFFSET) - (ROAD_WIDTH / 2 + 2.2)
  return [p.y + Math.tan(bank) * lateral, outside]
}

export const TERRAIN = { x0: -420, x1: QUAY_X + 40, z0: -520, z1: 520, segX: 250, segZ: 290 }

// Ground height: hills, flattened under the yard and port, graded to sit
// just under the road's cambered surface, sloping into the sea past the port
export function terrainHeight(x, z) {
  const [surface, outside] = roadSurface(x, z)
  const yard = smooth(85, 70, Math.abs(x)) * smooth(-90, -75, z) * smooth(70, 55, z)
  const port = smooth(PORT_START_X - 20, PORT_START_X - 5, x) * smooth(175, 150, Math.abs(z)) * smooth(QUAY_X + 0.5, QUAY_X - 0.5, x)
  let h = hills(x, z) * (1 - Math.max(yard, port))
  h = THREE.MathUtils.lerp(surface - 0.35, h, smooth(0.5, 30, outside))
  h = Math.min(h, THREE.MathUtils.lerp(h, -0.05, Math.max(yard, port)))
  h = THREE.MathUtils.lerp(h, -8, smooth(QUAY_X - 45, QUAY_X + 5, x) * (1 - port))
  return h - 0.04
}

export function buildCountryside(scene) {
  const group = new THREE.Group()
  scene.add(group)

  // Road ribbon (outside the yard), with gravel shoulders
  const roadSamples = []
  for (let s = 0; s <= route.length; s += 2) {
    const p = route.pointAt(s)
    // From the end of the yard asphalt to the port apron
    if (p.x > 69.5 && p.x < PORT_START_X + 3) roadSamples.push({ s, p })
  }
  // Ribbon across the road at the given lateral offsets (left to right in
  // increasing offset). Extra columns keep banked, twisting stretches close to
  // planar so layered strips never cut through each other.
  const ribbon = (columns, lift, vScale, samples = roadSamples) => {
    const pos = []
    const uv = []
    const index = []
    const n = columns.length
    samples.forEach(({ s, p }, i) => {
      const t = route.pointAt(s + 1).sub(route.pointAt(s - 1)).normalize()
      const left = new THREE.Vector3(t.z, 0, -t.x).normalize()
      const bank = route.bankAt(s)
      const lateral = left.multiplyScalar(Math.cos(bank)).add(new THREE.Vector3(0, Math.sin(bank), 0))
      for (const [offset, u] of columns) {
        const v = p.clone().addScaledVector(lateral, offset + LANE_OFFSET)
        v.y += lift
        pos.push(v.x, v.y, v.z)
        uv.push(u, s / vScale)
      }
      if (i > 0)
        for (let c = 0; c < n - 1; c++) {
          const a = (i - 1) * n + c
          const b = a + 1
          index.push(a, a + n, b, b, a + n, b + n)
        }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
  }
  const hw = ROAD_WIDTH / 2
  const road = new THREE.Mesh(
    ribbon(
      [
        [-hw, 0],
        [-hw / 2, 0.25],
        [0, 0.5],
        [hw / 2, 0.75],
        [hw, 1],
      ],
      0.05,
      ROAD_TILE,
    ),
    new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.95 }),
  )
  road.receiveShadow = true
  group.add(road)
  // Gravel verges only out in the countryside, not where the road meets the yard
  const ruralSamples = roadSamples.filter(({ p }) => p.x > 80 && p.x < PORT_START_X - 8)
  const gravel = new THREE.MeshStandardMaterial({ color: '#8a8273', roughness: 1 })
  for (const sign of [-1, 1]) {
    const inner = sign * (hw - 0.3)
    const outer = sign * (hw + 2.2)
    const shoulder = new THREE.Mesh(
      ribbon(
        sign < 0
          ? [
              [outer, 0],
              [inner, 1],
            ]
          : [
              [inner, 0],
              [outer, 1],
            ],
        0.03,
        6,
        ruralSamples,
      ),
      gravel,
    )
    shoulder.receiveShadow = true
    group.add(shoulder)
  }

  // Terrain: hills, flattened under the yard and port, graded to the road,
  // sloping into the sea beyond the port
  const { x0, x1, z0, z1, segX, segZ } = TERRAIN
  const terrainGeo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, segX, segZ)
  terrainGeo.rotateX(-Math.PI / 2)
  terrainGeo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2)
  const pos = terrainGeo.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)))
  terrainGeo.computeVertexNormals()
  const grassMap = grassTexture()
  grassMap.repeat.set(150, 180)
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1 }))
  terrain.receiveShadow = true
  group.add(terrain)

  // Trees, kept off the road, the yard and the port
  const rand = rng(401)
  const trunks = []
  for (let i = 0; i < 2500 && trunks.length < 650; i++) {
    const x = x0 + rand() * (QUAY_X - 60 - x0)
    const z = z0 + rand() * (z1 - z0)
    if (Math.abs(x) < 95 && z > -100 && z < 75) continue
    if (x > PORT_START_X - 25 && Math.abs(z) < 190) continue
    if (roadSurface(x, z)[1] < 5) continue
    trunks.push([x, z, 0.7 + rand() * 0.8])
  }
  const heightAt = (x, z) => {
    // Nearest terrain vertex is close enough for planting
    const ix = Math.round(((x - x0) / (x1 - x0)) * segX)
    const iz = Math.round(((z - z0) / (z1 - z0)) * segZ)
    return pos.getY(iz * (segX + 1) + ix)
  }
  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.25, 0.35, 4, 6).translate(0, 2, 0),
    new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 1 }),
    trunks.length,
  )
  const crownMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(3, 3).scale(1, 1.25, 1).translate(0, 6.6, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    trunks.length,
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const color = new THREE.Color()
  trunks.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2)
    m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.2, z), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.4), s))
    trunkMesh.setMatrixAt(i, m)
    crownMesh.setMatrixAt(i, m)
    crownMesh.setColorAt(i, color.setHSL(0.24 + rand() * 0.07, 0.4 + rand() * 0.2, 0.11 + rand() * 0.08))
  })
  for (const mesh of [trunkMesh, crownMesh]) {
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }

  // Roadside reflector posts on the rural stretch
  const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0)
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 }), 400)
  let n = 0
  for (let s = 0; s < route.length && n < 400; s += 25) {
    const p = route.pointAt(s)
    if (p.x < 80 || p.x > PORT_START_X) continue
    const t = route.pointAt(s + 1).sub(route.pointAt(s - 1)).normalize()
    const left = new THREE.Vector3(t.z, 0, -t.x).normalize()
    for (const side of [-1, 1]) {
      const v = p.clone().addScaledVector(left, side * (ROAD_WIDTH / 2 + 1.6) + LANE_OFFSET)
      m.makeTranslation(v.x, v.y - 0.1, v.z)
      posts.setMatrixAt(n++, m)
    }
  }
  posts.count = n
  posts.castShadow = true
  group.add(posts)

  return group
}
