import * as THREE from 'three'
import { Water } from 'three/addons/objects/Water.js'
import { loadModel } from './loaders.js'
import { QUAY_X, CRANE_POS, PORT_START_X, TRUCK_LANE_X, BERTH_X } from './Route.js'
import { createContainerInstances, SIZE } from './Container.js'
import { foamMaterial } from './Foam.js'
import { concreteCanvas, rng, toTexture } from './textures.js'

const WATER_Y = -3
const SHIP = { x: BERTH_X, length: 174, beam: 28, keel: -11, deck: 9 }
const PIER = { x0: QUAY_X + 31.5, x1: QUAY_X + 39 } // jetty on the ship's seaward side
const CRANE_SPAN = (PIER.x0 + PIER.x1) / 2 - (TRUCK_LANE_X - 7) // land legs behind the truck lane to sea legs on the jetty
const BLUE = '#1f4fb5'

function canvasTexture(w, h, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

// Tileable wave normal map built from integer-frequency sine waves
function waterNormals() {
  const size = 256
  const rand = rng(501)
  const waves = Array.from({ length: 14 }, () => ({
    kx: Math.round((rand() - 0.5) * 16),
    ky: Math.round((rand() - 0.5) * 16),
    a: 0.3 + rand(),
    p: rand() * Math.PI * 2,
  }))
  const height = (x, y) => waves.reduce((h, w) => h + (w.a * Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.p)) / (1 + Math.hypot(w.kx, w.ky) * 0.15), 0)
  return canvasTexture(
    size,
    size,
    (ctx) => {
      const img = ctx.createImageData(size, size)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const dx = height(x + 1, y) - height(x - 1, y)
          const dy = height(x, y + 1) - height(x, y - 1)
          const n = new THREE.Vector3(-dx * 2.5, -dy * 2.5, 1).normalize()
          const o = (y * size + x) * 4
          img.data[o] = (n.x * 0.5 + 0.5) * 255
          img.data[o + 1] = (n.y * 0.5 + 0.5) * 255
          img.data[o + 2] = (n.z * 0.5 + 0.5) * 255
          img.data[o + 3] = 255
        }
      ctx.putImageData(img, 0, 0)
    },
    { srgb: false, repeat: true },
  )
}

function textTexture(text, { w = 2048, h = 160, color = '#f4f4f0', font = 'bold 120px Arial, sans-serif' } = {}) {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = color
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2 + 6)
  })
}

const smoothstep01 = (x) => {
  const t = THREE.MathUtils.clamp(x, 0, 1)
  return t * t * (3 - 2 * t)
}

const shadowed = (mesh) => {
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}

// Moving parts inside your crane model. Its meshes are merged per material
// across the whole crane, so the spreader, hoist ropes and trolley are cut out
// as every triangle lying fully inside their volumes (model units, from the
// model's mesh bounds; Y runs along the span, Z is up).
const REGIONS = {
  spreader: new THREE.Box3(new THREE.Vector3(2300, 9800, 14600), new THREE.Vector3(15100, 13100, 18950)), // incl. headblock
  ropes: new THREE.Box3(new THREE.Vector3(5900, 10600, 17150), new THREE.Vector3(11500, 12500, 23400)),
  trolley: new THREE.Box3(new THREE.Vector3(6000, 9800, 23350), new THREE.Vector3(11400, 13100, 25300)),
}
const TWISTLOCK_Z = 15840 // underside of the spreader's telescopic arms
const END_ZONE = 900 // end beams, twist-locks and flippers at each spreader end

// Moves triangles fully inside `box` out of every mesh under `root` into new
// meshes (same material, same parent). `copy` gives them their own vertices.
function extractRegion(root, box, copy = false) {
  const meshes = []
  root.traverse((o) => o.isMesh && !o.userData.extracted && meshes.push(o))
  const out = []
  const v = new THREE.Vector3()
  for (const mesh of meshes) {
    const g = mesh.geometry
    const pos = g.attributes.position
    const index = g.index ? g.index.array : Array.from({ length: pos.count }, (_, k) => k)
    const inside = (k) => box.containsPoint(v.fromBufferAttribute(pos, k))
    const keep = []
    const take = []
    for (let t = 0; t < index.length; t += 3) {
      const tri = [index[t], index[t + 1], index[t + 2]]
      ;(tri.every(inside) ? take : keep).push(...tri)
    }
    if (!take.length) continue
    g.setIndex(keep)
    let part = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(g.attributes)) part.setAttribute(name, attr)
    part.setIndex(take)
    if (copy) part = part.toNonIndexed()
    const m = new THREE.Mesh(part, mesh.material)
    m.castShadow = m.receiveShadow = true
    m.userData.extracted = true
    mesh.parent.add(m)
    out.push(m)
  }
  return out
}

const usedBounds = (geometry) => {
  const box = new THREE.Box3()
  const pos = geometry.attributes.position
  const index = geometry.index ? geometry.index.array : Array.from({ length: pos.count }, (_, k) => k)
  const v = new THREE.Vector3()
  for (const k of index) box.expandByPoint(v.fromBufferAttribute(pos, k))
  return box
}

class CraneRig {
  constructor(crane) {
    this.frame = crane.getObjectByName('Object_2')
    this.ok = Boolean(this.frame)
    if (!this.ok) return
    crane.updateMatrixWorld(true)
    const origin = this.frame.localToWorld(new THREE.Vector3())
    const metresPerUnit = this.frame.localToWorld(new THREE.Vector3(0, 1, 0)).distanceTo(origin)

    this.spreader = extractRegion(this.frame, REGIONS.spreader, true)
    this.ropes = extractRegion(this.frame, REGIONS.ropes)
    this.trolley = extractRegion(this.frame, REGIONS.trolley)
    this.ok = this.spreader.length > 0
    if (!this.ok) return

    // Telescope the spreader in to 20ft and narrow it to the container width,
    // so its twist-locks and flippers land on the container's corner castings
    const box = new THREE.Box3()
    for (const m of this.spreader) box.union(usedBounds(m.geometry))
    const cx = (box.min.x + box.max.x) / 2
    const cy = (box.min.y + box.max.y) / 2
    const half = (box.max.x - box.min.x) / 2
    const lockHalf = (SIZE.length / 2 - 0.12) / metresPerUnit
    const shift = Math.max(0, half - END_ZONE / 2 - lockHalf)
    const b = half - END_ZONE
    const a = Math.min(1200, b - shift - 100)
    const along = (d) => {
      const s = Math.sign(d)
      const ad = Math.abs(d)
      if (ad <= a) return d
      if (ad >= b) return s * (ad - shift)
      return s * (a + ((ad - a) * (b - shift - a)) / (b - a))
    }
    const across = Math.min(1, (SIZE.width / 2 - 0.08) / metresPerUnit / ((box.max.y - box.min.y) / 2 - 150))
    for (const m of this.spreader) {
      const pos = m.geometry.attributes.position
      for (let k = 0; k < pos.count; k++) {
        pos.setX(k, cx + along(pos.getX(k) - cx))
        pos.setY(k, cy + (pos.getY(k) - cy) * across)
      }
      pos.needsUpdate = true
      m.geometry.computeVertexNormals()
      m.geometry.computeBoundingSphere()
    }
    this.localBottom = new THREE.Vector3(cx, cy, TWISTLOCK_Z)
    for (const r of this.ropes) {
      const rb = usedBounds(r.geometry)
      r.userData.span = [rb.min.z, rb.max.z]
    }
    this.anchor = new THREE.Object3D()
    this.frame.add(this.anchor)
    this.measure()
    this.ok = Math.abs(this.uUp.y) > 0.5 * this.uUp.length() && Math.abs(this.uSpan.x) > 0.5 * this.uSpan.length()
  }

  // Rest pose and how one model unit of travel/hoist maps into the world
  measure() {
    this.pose(0, 0)
    this.rest = this.anchor.getWorldPosition(new THREE.Vector3())
    const origin = this.frame.localToWorld(new THREE.Vector3())
    this.uSpan = this.frame.localToWorld(new THREE.Vector3(0, 1, 0)).sub(origin)
    this.uUp = this.frame.localToWorld(new THREE.Vector3(0, 0, 1)).sub(origin)
  }

  // dy: trolley travel, dz: hoist, both in model units
  pose(dy, dz) {
    for (const m of this.spreader) m.position.set(0, dy, dz)
    for (const m of this.trolley) m.position.set(0, dy, 0)
    for (const r of this.ropes) {
      const [zb, zt] = r.userData.span
      const s = Math.max((zt - (zb + dz)) / (zt - zb), 0.02)
      r.scale.set(1, 1, s)
      r.position.set(0, dy, zt - zt * s)
    }
    this.anchor.position.set(this.localBottom.x, this.localBottom.y + dy, this.localBottom.z + dz)
    this.frame.updateMatrixWorld(true)
  }

  // Put the spreader's twist-lock plane centre at world x (along the span), height y
  place(x, y) {
    this.pose((x - this.rest.x) / this.uSpan.x, (y - this.rest.y) / this.uUp.y)
  }
}

export default class Port {
  constructor({ scene, logo, variants }) {
    this.logo = logo
    this.group = new THREE.Group()
    scene.add(this.group)
    this.rand = rng(521)
    // Same ELIV containers as the yard, instanced: [blue, navy]
    this.containers = variants.map((v) => createContainerInstances(v, 1400))
    this.containerCount = variants.map(() => 0)
    // Deck cargo is a separate set parented to the ship, so it floats and sails with her
    this.shipContainers = this.containers.map((m) => {
      const mesh = new THREE.InstancedMesh(m.geometry, m.material, 1000)
      mesh.castShadow = mesh.receiveShadow = true
      mesh.frustumCulled = false
      return mesh
    })
    this.shipContainerCount = variants.map(() => 0)
    this.time = 0
    this.m = {
      blue: new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.5, metalness: 0.4 }),
      white: new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.5, metalness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: '#1c1d20', roughness: 0.7, metalness: 0.4 }),
      steel: new THREE.MeshStandardMaterial({ color: '#7e8489', roughness: 0.45, metalness: 0.8 }),
      yellow: new THREE.MeshStandardMaterial({ color: '#e5b21b', roughness: 0.5, metalness: 0.3 }),
      cable: new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.6, metalness: 0.6 }),
    }

    this.setWater()
    this.setQuay()
    this.setShip()
    for (const z of [-52, -82]) this.setShipToShoreCrane(z)
    this.setStacks()
    this.containers.forEach((mesh, k) => {
      mesh.count = this.containerCount[k]
      mesh.instanceMatrix.needsUpdate = true
      this.group.add(mesh)
    })
    this.shipContainers.forEach((mesh, k) => {
      mesh.count = this.shipContainerCount[k]
      mesh.instanceMatrix.needsUpdate = true
      this.ship.add(mesh)
    })
    this.setMasts()
    this.loadCrane()
  }

  setWater() {
    this.water = new Water(new THREE.PlaneGeometry(3000, 3000), {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: waterNormals(),
      sunDirection: new THREE.Vector3(20, 26, 30).normalize(),
      sunColor: 0xfff1dc,
      waterColor: 0x0d3446,
      distortionScale: 3.6,
      fog: true,
    })
    this.water.material.uniforms.size.value = 6
    this.water.rotation.x = -Math.PI / 2
    this.water.position.set(QUAY_X - 60 + 1500, WATER_Y, 0)
    this.group.add(this.water)
  }

  setQuay() {
    const apronMap = toTexture(concreteCanvas(531), { repeat: 1 })
    apronMap.repeat.set(10, 28)
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(QUAY_X - PORT_START_X + 20, 300),
      new THREE.MeshStandardMaterial({ map: apronMap, color: '#b3b1ab', roughness: 0.92 }),
    )
    apron.rotation.x = -Math.PI / 2
    apron.position.set((PORT_START_X - 20 + QUAY_X) / 2, 0.01, 0)
    apron.receiveShadow = true
    this.group.add(apron)

    const concrete = new THREE.MeshStandardMaterial({ color: '#8d8b86', roughness: 0.95 })
    const wall = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2, 9, 300), concrete))
    wall.position.set(QUAY_X - 1, -4.5, 0)
    this.group.add(wall)
    const edge = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 300), this.m.yellow))
    edge.position.set(QUAY_X - 0.4, 0.15, 0)
    this.group.add(edge)

    // Jetty across the berth, carrying the crane's seaward legs
    const pierW = PIER.x1 - PIER.x0
    const pier = shadowed(new THREE.Mesh(new THREE.BoxGeometry(pierW, 9.2, 200), concrete))
    pier.position.set((PIER.x0 + PIER.x1) / 2, -4.4, 0)
    this.group.add(pier)
    const pierTop = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(pierW, 200), apron.material))
    pierTop.rotation.x = -Math.PI / 2
    pierTop.position.set((PIER.x0 + PIER.x1) / 2, 0.21, 0)
    this.group.add(pierTop)
    const pierEdge = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 200), this.m.yellow))
    pierEdge.position.set(PIER.x0 + 0.3, 0.35, 0)
    this.group.add(pierEdge)

    const fender = new THREE.BoxGeometry(0.8, 3.2, 2.2)
    const bollard = new THREE.CylinderGeometry(0.35, 0.45, 0.8, 14)
    const rubber = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.95 })
    for (let z = -140; z <= 140; z += 14) {
      const f = shadowed(new THREE.Mesh(fender, rubber))
      f.position.set(QUAY_X + 0.4, -1.8, z)
      this.group.add(f)
      const b = shadowed(new THREE.Mesh(bollard, this.m.dark))
      b.position.set(QUAY_X - 1.6, 0.4, z + 7)
      this.group.add(b)
      if (Math.abs(z) < 100) {
        const pf = shadowed(new THREE.Mesh(fender, rubber))
        pf.position.set(PIER.x0 - 0.4, -1.8, z)
        this.group.add(pf)
      }
    }
  }

  setShip() {
    const ship = new THREE.Group()
    ship.position.set(SHIP.x, 0, 0)
    this.ship = ship
    this.group.add(ship)
    const half = SHIP.beam / 2
    const hullH = SHIP.deck - SHIP.keel

    // Lofted hull: stations from stern (t=0, +Z) to bow (t=1, -Z). Lower
    // sections fine out faster than the deck towards the bow (flare), the
    // stem rakes forward, and the bottom rises at both ends.
    const N = 160
    const M = 28
    const bowOf = (t) => smoothstep01((t - 0.7) / 0.3)
    const sternOf = (t) => Math.max(0, 1 - t / 0.11)
    const bottomAt = (t) => SHIP.keel + 7 * sternOf(t) ** 2 + 2 * bowOf(t) ** 2
    const halfWidth = (t, y) => {
      const h = THREE.MathUtils.clamp((y - SHIP.keel) / hullH, 0, 1)
      const dy = y - bottomAt(t)
      const r = 3.2
      let w = dy < r ? half - r + Math.sqrt(Math.max(0, r * r - (r - dy) ** 2)) : half
      w *= 1 - bowOf(t) ** (1.45 + 2.4 * h)
      w *= 1 - 0.4 * sternOf(t) * (1 - h)
      return Math.max(w, 0)
    }
    const zAt = (t, y) => {
      const h = THREE.MathUtils.clamp((y - SHIP.keel) / hullH, 0, 1)
      return SHIP.length / 2 - t * SHIP.length - bowOf(t) ** 2 * h * 6 + sternOf(t) * h * 2.5
    }
    this.hullHalfWidth = (z) => halfWidth(THREE.MathUtils.clamp((SHIP.length / 2 - z) / SHIP.length, 0, 1), SHIP.deck)

    const side = { pos: [], uv: [], index: [] }
    const deck = { pos: [], index: [] }
    const transom = []
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const yb = bottomAt(t)
      for (const sx of [1, -1]) {
        // centreline bottom point, then up the side to the deck edge
        side.pos.push(0, yb, zAt(t, yb))
        side.uv.push(t, (yb - SHIP.keel) / hullH)
        for (let j = 0; j <= M; j++) {
          const y = yb + (SHIP.deck - yb) * (j / M) ** 0.85
          side.pos.push(sx * halfWidth(t, y), y, zAt(t, y))
          side.uv.push(t, (y - SHIP.keel) / hullH)
        }
      }
      const w = halfWidth(t, SHIP.deck)
      deck.pos.push(-w, SHIP.deck, zAt(t, SHIP.deck), w, SHIP.deck, zAt(t, SHIP.deck))
      if (i === 0) for (let j = 0; j <= M; j++) transom.push(new THREE.Vector2(halfWidth(0, yb + (SHIP.deck - yb) * (j / M) ** 0.85), yb + (SHIP.deck - yb) * (j / M) ** 0.85))
    }
    const ring = 2 * (M + 2)
    for (let i = 0; i < N; i++)
      for (let k = 0; k < 2; k++)
        for (let j = 0; j < M + 1; j++) {
          const a = i * ring + k * (M + 2) + j
          const b = a + 1
          const c = a + ring
          const d = b + ring
          if (k === 0) side.index.push(a, c, b, b, c, d)
          else side.index.push(a, b, c, b, d, c)
        }
    for (let i = 0; i < N; i++) {
      const l = i * 2
      deck.index.push(l, l + 1, l + 2, l + 1, l + 3, l + 2)
    }

    const hullGeo = new THREE.BufferGeometry()
    hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(side.pos, 3))
    hullGeo.setAttribute('uv', new THREE.Float32BufferAttribute(side.uv, 2))
    hullGeo.setIndex(side.index)
    hullGeo.computeVertexNormals()
    const waterline = (WATER_Y - SHIP.keel) / hullH
    const hullMap = canvasTexture(2048, 512, (ctx, w, h) => {
      const band = (from, to, color) => {
        ctx.fillStyle = color
        ctx.fillRect(0, h * (1 - to), w, h * (to - from) + 1)
      }
      band(0, waterline - 0.02, '#a3261d')
      band(waterline - 0.02, waterline + 0.02, '#ece9e2')
      band(waterline + 0.02, 0.985, '#141518')
      band(0.985, 1, '#a3261d')
      const rand = rng(541)
      // Rust weeping and scuffs on the topsides, fender marks near the waterline
      for (let i = 0; i < 600; i++) {
        const x = rand() * w
        const y = h * (1 - 0.98) + rand() * h * (0.98 - waterline) * 0.9
        const g = ctx.createLinearGradient(0, y, 0, y + 30 + rand() * 90)
        g.addColorStop(0, `rgba(120,55,30,${0.08 + rand() * 0.2})`)
        g.addColorStop(1, 'rgba(120,55,30,0)')
        ctx.fillStyle = g
        ctx.fillRect(x, y, 1 + rand() * 2, 120)
      }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(200,200,200,${0.04 + rand() * 0.05})`
        ctx.fillRect(rand() * w, h * (1 - waterline - 0.15), 8 + rand() * 30, h * 0.1)
      }
      // Draught marks
      ctx.fillStyle = '#ece9e2'
      for (const x of [0.02, 0.5, 0.97])
        for (let k = 0; k < 6; k++) ctx.fillRect(w * x, h * (1 - waterline - 0.06 * k) - 4, 14, 6)
    })
    const hullMat = new THREE.MeshStandardMaterial({ map: hullMap, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide })
    ship.add(shadowed(new THREE.Mesh(hullGeo, hullMat)))

    const deckGeo = new THREE.BufferGeometry()
    deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deck.pos, 3))
    deckGeo.setIndex(deck.index)
    deckGeo.computeVertexNormals()
    const deckMat = new THREE.MeshStandardMaterial({ color: '#7d2a22', roughness: 0.8, side: THREE.DoubleSide })
    ship.add(shadowed(new THREE.Mesh(deckGeo, deckMat)))

    const transomShape = new THREE.Shape([...transom.map((p) => new THREE.Vector2(p.x, p.y)), ...transom.slice().reverse().map((p) => new THREE.Vector2(-p.x, p.y))])
    const transomGeo = new THREE.ShapeGeometry(transomShape)
    const tp = transomGeo.attributes.position
    for (let k = 0; k < tp.count; k++) tp.setZ(k, zAt(0, tp.getY(k)) - 0.02) // follow the raked stern
    transomGeo.computeVertexNormals()
    ship.add(shadowed(new THREE.Mesh(transomGeo, new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.55, side: THREE.DoubleSide }))))

    // Bulbous bow, just below the waterline ahead of the stem
    const bowZ = zAt(1, WATER_Y)
    const bulb = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshStandardMaterial({ color: '#a3261d', roughness: 0.55, metalness: 0.3 })))
    bulb.scale.set(2.6, 3.0, 8)
    bulb.position.set(0, WATER_Y - 4.2, bowZ + 1.5)
    ship.add(bulb)

    // Bulwark rail along the deck edge, breakwater and foremast at the bow
    const red = new THREE.MeshStandardMaterial({ color: '#a3261d', roughness: 0.6, metalness: 0.3 })
    for (let i = 0; i < N; i += 2) {
      const t = (i + 1) / N
      const w = halfWidth(t, SHIP.deck)
      if (w < 1) continue
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, SHIP.length / N * 2), red)
        post.position.set(sx * (w - 0.1), SHIP.deck + 0.8, zAt(t, SHIP.deck))
        ship.add(post)
      }
    }
    const breakwaterZ = -SHIP.length / 2 + 21
    for (const sx of [-1, 1]) {
      const wall = shadowed(new THREE.Mesh(new THREE.BoxGeometry(half * 1.05, 4.5, 0.4), red))
      wall.position.set((sx * half) / 2.1, SHIP.deck + 2.25, breakwaterZ - 2.4)
      wall.rotation.y = sx * 0.32
      ship.add(wall)
    }
    const foremast = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 12, 12), this.m.white))
    foremast.position.set(0, SHIP.deck + 6, -SHIP.length / 2 + 9)
    ship.add(foremast)
    const crossTree = shadowed(new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 0.3), this.m.white))
    crossTree.position.set(0, SHIP.deck + 10, -SHIP.length / 2 + 9)
    ship.add(crossTree)
    for (const sx of [-1, 1]) {
      const winch = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2, 16), this.m.dark))
      winch.rotation.z = Math.PI / 2
      winch.position.set(sx * 4, SHIP.deck + 0.9, -SHIP.length / 2 + 16)
      ship.add(winch)
      // Anchor pockets in the flared bow
      const t = 0.93
      const y = SHIP.deck - 3
      const pocket = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), this.m.dark)
      pocket.scale.set(1, 0.8, 1)
      pocket.position.set(sx * (halfWidth(t, y) + 0.05), y, zAt(t, y))
      pocket.rotation.y = sx * (Math.PI / 2 - 0.45)
      ship.add(pocket)
    }

    // Lettering: large ELIV amidships on both sides, name on the stern
    const lettering = new THREE.MeshStandardMaterial({
      map: textTexture('E L I V', { w: 2048, h: 400, font: 'bold 360px Arial, sans-serif' }),
      transparent: true,
      roughness: 0.5,
    })
    for (const sx of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(44, 8.6), lettering)
      plane.position.set(sx * (half + 0.06), 2.8, 6)
      plane.rotation.y = (sx * Math.PI) / 2
      ship.add(plane)
    }
    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 2.2),
      new THREE.MeshStandardMaterial({ map: textTexture('ELIV PIONEER', { font: 'bold 110px Arial, sans-serif' }), transparent: true }),
    )
    name.position.set(0, SHIP.deck - 2.5, zAt(0, SHIP.deck - 2.5) + 0.08)
    ship.add(name)

    // Deck cargo: ELIV 20ft containers. Bays are spaced so one lands exactly
    // at the berth's crane position; rows follow the hull's width.
    const lashing = new THREE.BoxGeometry(SHIP.beam - 1, 3, 0.5)
    const bayPitch = SIZE.length + 0.25
    const targetBay = Math.round((CRANE_POS.z + 62) / bayPitch)
    const z0 = CRANE_POS.z - targetBay * bayPitch
    const rowPitch = SIZE.width + 0.06
    for (let b = 0; z0 + b * bayPitch < 50; b++) {
      const z = z0 + b * bayPitch
      const hw = Math.min(this.hullHalfWidth(z - SIZE.length / 2), this.hullHalfWidth(z + SIZE.length / 2))
      const bayRows = Math.min(11, Math.floor((2 * hw - 1.2) / rowPitch) | 1)
      if (bayRows < 3) continue
      for (let r = 0; r < bayRows; r++) {
        const x = (r - (bayRows - 1) / 2) * rowPitch
        const edge = Math.abs(r - (bayRows - 1) / 2) / ((bayRows - 1) / 2)
        let tiers = Math.max(2, 5 - Math.round(edge * 1.1 + this.rand() * 1.2))
        // Free slot on the quay side of the berth bay for the delivered container
        const target = b === targetBay && r === 3
        if (target) {
          tiers = 4
          this.shipSlot = new THREE.Vector3(SHIP.x + x, SHIP.deck + 0.4 + tiers * (SIZE.height + 0.02), z)
        }
        for (let t = 0; t < tiers; t++) this.placeContainer(x, SHIP.deck + 0.4 + t * (SIZE.height + 0.02), z, true)
        this.shipTop = Math.max(this.shipTop ?? 0, SHIP.deck + 0.4 + Math.max(tiers + (target ? 1 : 0), 0) * (SIZE.height + 0.02))
      }
      if (b % 2 === 1) {
        const l = shadowed(new THREE.Mesh(lashing, this.m.steel))
        l.scale.x = Math.min(1, (2 * hw) / SHIP.beam)
        l.position.set(0, SHIP.deck + 1.5, z + bayPitch / 2)
        ship.add(l)
      }
    }

    // Accommodation: stacked decks, full-width bridge with wings, funnel
    const windows = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#f1f1ee'
      ctx.fillRect(0, 0, w, h)
      for (let y = 18; y < h - 20; y += 64)
        for (let x = 20; x < w - 30; x += 40) {
          ctx.fillStyle = '#1e2a35'
          ctx.fillRect(x, y, 26, 26)
        }
    })
    windows.wrapS = windows.wrapT = THREE.RepeatWrapping
    const accommodation = new THREE.MeshStandardMaterial({ map: windows, roughness: 0.5 })
    const decks = 7
    for (let d = 0; d < decks; d++) {
      const width = 22 - d * 0.6
      const block = shadowed(new THREE.Mesh(new THREE.BoxGeometry(width, 2.8, 13 - d * 0.3), accommodation))
      block.position.set(0, SHIP.deck + 1.4 + d * 2.8, 63)
      ship.add(block)
    }
    const bridgeY = SHIP.deck + decks * 2.8 + 1.3
    const bridge = shadowed(new THREE.Mesh(new THREE.BoxGeometry(SHIP.beam + 3, 2.6, 8), this.m.white))
    bridge.position.set(0, bridgeY, 60.5)
    ship.add(bridge)
    const bridgeGlass = new THREE.Mesh(
      new THREE.BoxGeometry(SHIP.beam + 3.1, 1.1, 8.1),
      new THREE.MeshStandardMaterial({ color: '#16212b', metalness: 0.9, roughness: 0.05 }),
    )
    bridgeGlass.position.set(0, bridgeY + 0.3, 60.5)
    ship.add(bridgeGlass)
    for (const sx of [-1, 1]) {
      const brace = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), this.m.white))
      brace.position.set(sx * (half - 1), bridgeY - 3, 60.5)
      brace.rotation.z = sx * 0.6
      ship.add(brace)
    }
    const top = shadowed(new THREE.Mesh(new THREE.BoxGeometry(12, 2.4, 7), this.m.white))
    top.position.set(0, bridgeY + 2.5, 62)
    ship.add(top)
    const mast = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 8, 10), this.m.white))
    mast.position.set(0, bridgeY + 7.5, 62)
    ship.add(mast)
    const radar = shadowed(new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 0.6), this.m.dark))
    radar.position.set(0, bridgeY + 9, 62)
    ship.add(radar)
    const funnelMat = new THREE.MeshStandardMaterial({ color: '#14295c', roughness: 0.5 })
    const funnel = shadowed(new THREE.Mesh(new THREE.BoxGeometry(7, 14, 8), funnelMat))
    funnel.position.set(0, SHIP.deck + 7 + 10, 76)
    ship.add(funnel)
    const band = shadowed(new THREE.Mesh(new THREE.BoxGeometry(7.1, 3, 8.1), this.m.blue))
    band.position.set(0, SHIP.deck + 20, 76)
    ship.add(band)
    const cap = shadowed(new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.2, 8.2), this.m.dark))
    cap.position.set(0, SHIP.deck + 24.6, 76)
    ship.add(cap)
    const f = this.logo.parts?.emblem ?? this.logo.full
    const emblem = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(this.logo.stencil(f)), transparent: true })
    emblem.map.colorSpace = THREE.SRGBColorSpace
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3), emblem)
      e.position.set(sx * 3.62, SHIP.deck + 15, 76)
      e.rotation.y = (sx * Math.PI) / 2
      ship.add(e)
      const lifeboat = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 5, 4, 10), new THREE.MeshStandardMaterial({ color: '#f26a1b', roughness: 0.5 })))
      lifeboat.rotation.x = Math.PI / 2
      lifeboat.position.set(sx * (half - 1.8), SHIP.deck + 7, 70)
      ship.add(lifeboat)
    }

    // White water: bow wave and hull wash hugging the waterline, a Kelvin
    // wake with propeller wash astern, and churn at the stern when manoeuvring
    const wash = { pos: [], uv: [], index: [] }
    const stations = 90
    for (let i = 0; i <= stations; i++) {
      const t = 1 - (i / stations) * 0.96 // bow to near the stern
      const bow = smoothstep01((t - 0.86) / 0.14)
      const inner = halfWidth(t, WATER_Y) + 0.05
      // Spreads away from the hull: wide at the bow, and widening aft into a V
      const width = 5 + 14 * bow + 16 * (i / stations)
      const z = zAt(t, WATER_Y)
      const y = WATER_Y + 0.06 + 0.35 * bow
      for (const sx of [1, -1]) {
        wash.pos.push(sx * inner, y, z, sx * (inner + width), WATER_Y + 0.06, z - 3.5 * bow)
        wash.uv.push(0, i / stations, 1, i / stations)
      }
      if (i > 0)
        for (const k of [0, 2]) {
          const a = (i - 1) * 4 + k
          wash.index.push(a, a + 1, a + 4, a + 1, a + 5, a + 4)
        }
    }
    const washGeo = new THREE.BufferGeometry()
    washGeo.setAttribute('position', new THREE.Float32BufferAttribute(wash.pos, 3))
    washGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wash.uv, 2))
    washGeo.setIndex(wash.index)
    // Bow wave sheet: quarter-ellipse arcs round the stem for each side, from
    // ahead of the bulb sweeping out and aft. Columns run inner -> outer.
    const bowWave = { pos: [], uv: [], index: [] }
    const stemZ = zAt(1, WATER_Y)
    const arcSteps = 40
    const across = 10
    const arc = (phi, scale) => {
      const k = phi / (Math.PI / 2)
      return [20 * scale * Math.sin(phi), stemZ - 9 * scale * Math.cos(phi) + 46 * k * k * scale]
    }
    for (const sx of [1, -1]) {
      const start = bowWave.pos.length / 3
      for (let i = 0; i <= arcSteps; i++) {
        const phi = (i / arcSteps) * Math.PI * 0.55
        for (let j = 0; j <= across; j++) {
          const a = j / across
          const [x, z] = arc(phi, 0.3 + a * 0.95)
          bowWave.pos.push(sx * x, WATER_Y + 0.1 + 0.25 * (1 - a) * (1 - i / arcSteps), z)
          bowWave.uv.push(a, i / arcSteps)
        }
        if (i > 0)
          for (let j = 0; j < across; j++) {
            const a = start + (i - 1) * (across + 1) + j
            const c = a + across + 1
            bowWave.index.push(a, c, a + 1, a + 1, c, c + 1)
          }
      }
    }
    const bowGeo = new THREE.BufferGeometry()
    bowGeo.setAttribute('position', new THREE.Float32BufferAttribute(bowWave.pos, 3))
    bowGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bowWave.uv, 2))
    bowGeo.setIndex(bowWave.index)
    const wakeGeo = new THREE.PlaneGeometry(130, 340)
    const churnGeo = new THREE.PlaneGeometry(42, 42)
    this.foam = {
      wash: new THREE.Mesh(washGeo, foamMaterial('wash', [4, 60])),
      bow: new THREE.Mesh(bowGeo, foamMaterial('bow', [5, 12])),
      wake: new THREE.Mesh(wakeGeo, foamMaterial('wake', [9, 42])),
      churn: new THREE.Mesh(churnGeo, foamMaterial('churn', [7, 7])),
    }
    // Wake plane: -Y edge (uv.y 0) at the stern, running out astern (+Z)
    this.foam.wake.rotation.x = Math.PI / 2
    this.foam.wake.position.set(0, WATER_Y + 0.05, SHIP.length / 2 + 168)
    this.foam.churn.rotation.x = Math.PI / 2
    this.foam.churn.position.set(0, WATER_Y + 0.07, SHIP.length / 2 + 10)
    for (const mesh of Object.values(this.foam)) {
      mesh.material.side = THREE.DoubleSide
      mesh.frustumCulled = false
      mesh.visible = false
      ship.add(mesh)
    }

    // Mooring lines to the quay bollards
    this.mooring = [-70, -58, 70, 82].map((z) => this.strut(new THREE.Vector3(QUAY_X - 1.6, 0.6, z + (z < 0 ? -7 : 7)), new THREE.Vector3(SHIP.x - this.hullHalfWidth(z) + 1, SHIP.deck - 1, z), 0.08, this.m.cable))
  }

  // Adds one ELIV container instance (base centre at x, y, z), doors either
  // way: in port coordinates, or in the ship's own frame when onShip
  placeContainer(x, y, z, onShip = false) {
    const k = this.rand() < 0.65 ? 0 : 1
    const counts = onShip ? this.shipContainerCount : this.containerCount
    const i = counts[k]++
    const m = new THREE.Matrix4().makeRotationY(this.rand() < 0.5 ? 0 : Math.PI).setPosition(x, y, z)
    ;(onShip ? this.shipContainers : this.containers)[k].setMatrixAt(i, m)
  }

  strut(a, b, r, material) {
    const len = a.distanceTo(b)
    const mesh = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), material))
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    this.group.add(mesh)
    return mesh
  }

  // Ship-to-shore gantry crane straddling the quay edge, boom over the ship
  setShipToShoreCrane(z) {
    const g = this.group
    const box = (size, material, position) => {
      const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(...size), material))
      mesh.position.set(...position)
      g.add(mesh)
    }
    const land = QUAY_X - 27
    const sea = QUAY_X - 3
    const legH = 32
    const boomY = 41
    for (const x of [land, sea]) {
      for (const dz of [-8, 8]) {
        box([1.4, legH, 1.4], this.m.blue, [x, legH / 2, z + dz])
        box([2.6, 1.4, 4], this.m.dark, [x, 0.7, z + dz])
      }
      box([1.4, 1.6, 17.4], this.m.blue, [x, legH, z])
      box([1.4, 1.2, 17.4], this.m.blue, [x, 11, z])
      for (const dz of [-2.2, 2.2]) box([1.1, boomY - legH, 1.1], this.m.blue, [x, (legH + boomY) / 2, z + dz])
    }
    for (const dz of [-8, 8]) {
      box([sea - land + 1.4, 1.4, 1.4], this.m.blue, [(land + sea) / 2, legH, z + dz])
      this.strut(new THREE.Vector3(land, 12, z + dz), new THREE.Vector3(sea, legH - 1, z + dz), 0.35, this.m.blue)
    }
    // Boom and back-reach girders
    const back = QUAY_X - 48
    const tip = QUAY_X + 56
    for (const dz of [-2.2, 2.2]) box([tip - back, 2.4, 1.2], this.m.white, [(tip + back) / 2, boomY, z + dz])
    for (let x = back + 4; x < tip; x += 6) box([0.4, 0.4, 4.4], this.m.white, [x, boomY - 1, z])
    // A-frame apex and stays
    const apex = new THREE.Vector3((land + sea) / 2, 64, z)
    for (const dz of [-2.2, 2.2]) {
      const a = apex.clone().setZ(z + dz)
      this.strut(new THREE.Vector3(land, boomY + 1, z + dz), a, 0.6, this.m.blue)
      this.strut(new THREE.Vector3(sea, boomY + 1, z + dz), a, 0.6, this.m.blue)
      this.strut(a, new THREE.Vector3(tip - 2, boomY + 1, z + dz), 0.22, this.m.cable)
      this.strut(a, new THREE.Vector3(QUAY_X + 22, boomY + 1, z + dz), 0.22, this.m.cable)
      this.strut(a, new THREE.Vector3(back + 2, boomY + 1, z + dz), 0.25, this.m.cable)
    }
    box([12, 5, 7], this.m.white, [back + 8, boomY + 3.7, z])
    // Trolley, operator cab, spreader on hoist ropes
    const tx = QUAY_X + 24
    box([5, 2, 6], this.m.yellow, [tx, boomY - 2.2, z])
    box([3, 3, 3], this.m.white, [tx - 1, boomY - 4.6, z + 2])
    const spreaderY = 31
    box([12.2, 0.8, 2.6], this.m.yellow, [tx, spreaderY, z])
    for (const dx of [-4, 4]) for (const dz of [-1, 1]) this.strut(new THREE.Vector3(tx + dx * 0.4, boomY - 3, z + dz), new THREE.Vector3(tx + dx, spreaderY + 0.4, z + dz), 0.05, this.m.cable)
  }

  // Yard blocks of ELIV containers behind the quay, clear of the truck route
  setStacks() {
    const blocks = [
      { x0: PORT_START_X + 10, rows: 6, z0: -18, bays: 20 },
      { x0: TRUCK_LANE_X - 18, rows: 4, z0: 44, bays: 14 },
    ]
    const pitch = SIZE.length + 0.3
    for (const b of blocks)
      for (let bay = 0; bay < b.bays; bay++)
        for (let r = 0; r < b.rows; r++) {
          const tiers = 1 + Math.floor(this.rand() * 4)
          for (let t = 0; t < tiers; t++) this.placeContainer(b.x0 + r * (SIZE.width + 0.15), t * (SIZE.height + 0.01), b.z0 + bay * pitch)
        }
  }

  setMasts() {
    const lamp = new THREE.MeshStandardMaterial({ color: '#f4f1e8', emissive: '#fff2cc', emissiveIntensity: 0.6 })
    for (const [x, z] of [
      [PORT_START_X + 3, -100],
      [PORT_START_X + 3, 70],
      [QUAY_X - 20, -120],
      [QUAY_X - 20, 140],
    ]) {
      const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 34, 12), this.m.steel))
      pole.position.set(x, 17, z)
      this.group.add(pole)
      const head = shadowed(new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 2), lamp))
      head.position.set(x, 34, z)
      this.group.add(head)
    }
  }

  // Your ASC crane model, turned so its span runs along X and scaled so it
  // straddles the truck lane (land legs) and the ship (sea legs on the jetty)
  async loadCrane() {
    try {
      const gltf = await loadModel('/models/kone_crane_system_asc_1.glb')
      const crane = gltf.scene
      let bounds = new THREE.Box3().setFromObject(crane)
      let size = bounds.getSize(new THREE.Vector3())
      if (size.z > size.x) {
        crane.rotation.y = Math.PI / 2
        crane.updateMatrixWorld(true)
        bounds = new THREE.Box3().setFromObject(crane)
        size = bounds.getSize(new THREE.Vector3())
      }
      const scale = CRANE_SPAN / size.x
      crane.scale.multiplyScalar(scale)
      crane.updateMatrixWorld(true)
      bounds = new THREE.Box3().setFromObject(crane)
      const center = bounds.getCenter(new THREE.Vector3())
      crane.position.x += (TRUCK_LANE_X - 7 + (PIER.x0 + PIER.x1) / 2) / 2 - center.x
      crane.position.z += CRANE_POS.z - center.z
      crane.position.y -= bounds.min.y - 0.2
      crane.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true
      })
      this.group.add(crane)
      this.crane = crane
      crane.updateMatrixWorld(true)
      const rig = new CraneRig(crane)
      if (rig.ok) {
        // Slide the crane along the quay so its spreader is over the berth line
        crane.position.z += CRANE_POS.z - rig.rest.z
        crane.updateMatrixWorld(true)
        rig.measure()
        this.rig = rig
      }
    } catch (error) {
      console.warn('Crane model failed to load', error)
    }
  }

  // Ship afloat: gentle heave, roll and pitch on top of the voyage pose
  // (see shipPose). Mooring lines are let go once she moves; the wake
  // builds with speed ahead.
  updateShip(pose) {
    const t = this.time
    const swell = 1 + pose.ahead
    this.ship.position.set(pose.x, 0.14 * Math.sin(t * 0.55) + 0.06 * Math.sin(t * 1.3), pose.z)
    this.ship.rotation.set(
      pose.pitch + 0.0025 * swell * Math.sin(t * 0.37),
      pose.yaw,
      pose.roll + 0.006 * swell * Math.sin(t * 0.45 + 1),
      'YXZ',
    )
    this.ship.updateMatrixWorld(true)
    for (const line of this.mooring) line.visible = !pose.moving
    const speeds = {
      wash: Math.max(pose.ahead, 0.55 * pose.astern),
      bow: pose.ahead,
      wake: pose.ahead,
      churn: Math.max(pose.astern, 0.6 * pose.ahead),
    }
    for (const [kind, mesh] of Object.entries(this.foam)) {
      mesh.material.uniforms.uSpeed.value = speeds[kind]
      mesh.visible = speeds[kind] > 0.01
    }
  }

  update(delta) {
    this.time += delta
    this.water.material.uniforms.time.value += delta * 1.1
    for (const mesh of Object.values(this.foam)) mesh.material.uniforms.uTime.value = this.time
  }
}
