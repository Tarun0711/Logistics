import * as THREE from 'three'
import { SIZE, corrugated } from './Container.js'
import {
  asphaltCanvas,
  cardboardCanvas,
  chainLinkCanvas,
  concreteCanvas,
  paintCanvas,
  rng,
  shutterCanvas,
  signCanvas,
  toTexture,
  trailerCanvas,
  windowsCanvas,
} from './textures.js'

// Layout (metres). The hero container sits at the origin with its doors
// facing +Z; the warehouse dock face runs along x at WAREHOUSE_Z.
const WAREHOUSE_Z = -24
const DOCK_XS = [-27, -21, -15, -9, -3, 3, 9, 15, 21, 27]
const TRAILER_XS = [-3, 9]
const STACK_GAP = 0.15

const shadowed = (mesh) => {
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}

const box = (size, material, position) => {
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(...size), material))
  mesh.position.set(...position)
  return mesh
}

const markingMaterial = (color) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })

export default class Yard {
  constructor({ scene, logo, variants }) {
    this.scene = scene
    this.logo = logo
    this.variants = variants
    this.group = new THREE.Group()
    scene.add(this.group)

    this.setGround()
    this.setMarkings()
    this.setWarehouse()
    this.setTrailers()
    this.setStacks()
    this.setLightMasts()
    this.setPallets()
    this.setBollards()
    this.setFence()
  }

  setGround() {
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 125),
      new THREE.MeshStandardMaterial({ map: toTexture(asphaltCanvas(), { repeat: 18 }), roughness: 0.95 }),
    )
    asphalt.rotation.x = -Math.PI / 2
    asphalt.position.set(0, 0, -10)
    asphalt.receiveShadow = true
    this.group.add(asphalt)

    // Concrete apron in front of the docks
    const apronMap = toTexture(concreteCanvas(), { repeat: 1 })
    apronMap.repeat.set(12, 1.5)
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(92, 12), markingMaterial('#ffffff'))
    apron.material.map = apronMap
    apron.material.roughness = 0.9
    apron.rotation.x = -Math.PI / 2
    apron.position.set(0, 0.002, WAREHOUSE_Z + 6)
    apron.receiveShadow = true
    this.group.add(apron)
  }

  setMarkings() {
    const yellow = markingMaterial('#d8b21c')
    const white = markingMaterial('#e6e6e1')
    const line = (w, d, material, x, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material)
      m.rotation.x = -Math.PI / 2
      m.position.set(x, 0.006, z)
      m.receiveShadow = true
      this.group.add(m)
    }

    // Traffic lane edges and dashed centre line
    // Run right to the asphalt's east edge, where the public road continues them
    line(140, 0.15, yellow, 0, 9)
    line(140, 0.15, yellow, 0, 22)
    for (let x = -67.5; x < 70; x += 6) line(3, 0.12, white, x, 15.5)

    // Pedestrian crossing on the worker's route
    for (let z = 9.6; z < 21.6; z += 0.9) line(3.2, 0.45, white, 3.4, z)

    // Bay outline around the working container
    const bw = SIZE.width + 1.4
    const bl = SIZE.length + 1.6
    line(bw, 0.12, white, 0, bl / 2)
    line(bw, 0.12, white, 0, -bl / 2)
    line(0.12, bl, white, bw / 2, 0)
    line(0.12, bl, white, -bw / 2, 0)

    // Yellow hatched no-parking zone at the docks
    for (let x = -44; x < 44; x += 1.2) line(0.15, 2, yellow, x, WAREHOUSE_Z + 1.4)
  }

  setWarehouse() {
    const g = new THREE.Group()
    g.position.z = WAREHOUSE_Z
    this.group.add(g)

    const width = 90
    const depth = 40
    const plinth = 1.4
    const wallH = 10.6
    const roughnessMap = toTexture(paintCanvas(512, 512, '#888888', 91, { rustAmount: 0.1 }), { srgb: false })
    const cladding = new THREE.MeshStandardMaterial({
      map: toTexture(paintCanvas(1024, 512, '#c7cbce', 92, { rustAmount: 0.15 })),
      roughnessMap,
      roughness: 1,
      metalness: 0.4,
    })
    const concrete = new THREE.MeshStandardMaterial({ map: toTexture(concreteCanvas(93)), color: '#b8b5ae', roughness: 0.95 })
    const navy = new THREE.MeshStandardMaterial({ color: '#14295c', roughness: 0.55, metalness: 0.4 })
    const rubber = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.95 })
    const steel = new THREE.MeshStandardMaterial({ color: '#7c8186', roughness: 0.6, metalness: 0.7 })

    // Walls
    const front = shadowed(new THREE.Mesh(corrugated(width, wallH, 0.25, 0.035), cladding))
    front.position.set(0, plinth + wallH / 2, 0)
    g.add(front)
    for (const sx of [-1, 1]) {
      const side = shadowed(new THREE.Mesh(corrugated(depth, wallH, 0.25, 0.035), cladding))
      side.position.set((sx * width) / 2, plinth + wallH / 2, -depth / 2)
      side.rotation.y = (sx * Math.PI) / 2
      g.add(side)
      g.add(box([0.4, plinth, depth], concrete, [(sx * width) / 2, plinth / 2, -depth / 2]))
    }
    g.add(box([width, plinth, 0.4], concrete, [0, plinth / 2, -0.2]))
    g.add(box([width + 0.6, 1.2, 0.5], navy, [0, plinth + wallH + 0.4, 0]))
    g.add(box([width + 0.6, 0.5, depth + 0.6], steel, [0, plinth + wallH + 1.1, -depth / 2]))

    // Brand sign
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 4.9),
      new THREE.MeshStandardMaterial({ map: toTexture(signCanvas(this.logo)), roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.08 }),
    )
    sign.material.emissiveMap = sign.material.map
    sign.position.set(0, 8.9, 0.08)
    g.add(sign)

    // Dock doors with shelters, bumpers and lights
    const shutter = new THREE.MeshStandardMaterial({ map: toTexture(shutterCanvas()), roughness: 0.6, metalness: 0.5 })
    const dark = new THREE.MeshStandardMaterial({ color: '#16181a', roughness: 1 })
    const lamp = new THREE.MeshStandardMaterial({ color: '#fff6dc', emissive: '#ffe9b0', emissiveIntensity: 1.5 })
    for (const x of DOCK_XS) {
      const open = TRAILER_XS.includes(x)
      const door = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.6), open ? dark : shutter)
      door.position.set(x, plinth + 1.8, 0.06)
      g.add(door)
      if (open) g.add(box([3.1, 0.5, 0.4], steel, [x, plinth + 3.85, 0.2]))
      g.add(box([0.35, 4.2, 0.6], rubber, [x - 1.68, plinth + 2.05, 0.3]))
      g.add(box([0.35, 4.2, 0.6], rubber, [x + 1.68, plinth + 2.05, 0.3]))
      g.add(box([3.7, 0.6, 0.6], rubber, [x, plinth + 4.15, 0.3]))
      g.add(box([0.25, 0.45, 0.18], rubber, [x - 1.1, plinth - 0.35, 0.09]))
      g.add(box([0.25, 0.45, 0.18], rubber, [x + 1.1, plinth - 0.35, 0.09]))
      g.add(box([0.25, 0.12, 0.2], lamp, [x + 2.2, plinth + 4.0, 0.15]))
    }

    // Two-storey office at the east end
    const windows = new THREE.MeshStandardMaterial({ map: toTexture(windowsCanvas()), roughness: 0.25, metalness: 0.3 })
    const officeWall = new THREE.MeshStandardMaterial({ color: '#d3d6d8', roughness: 0.8 })
    const office = shadowed(
      new THREE.Mesh(new THREE.BoxGeometry(16, 8, 14), [officeWall, officeWall, navy, officeWall, windows, officeWall]),
    )
    office.position.set(width / 2 + 8, 4, -7)
    g.add(office)
  }

  setTrailers() {
    const side = new THREE.MeshStandardMaterial({ map: toTexture(trailerCanvas(this.logo)), roughness: 0.5, metalness: 0.2 })
    const white = new THREE.MeshStandardMaterial({ color: '#e9ebec', roughness: 0.5, metalness: 0.2 })
    const chassis = new THREE.MeshStandardMaterial({ color: '#222426', roughness: 0.8, metalness: 0.5 })
    const tyre = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 })
    const rim = new THREE.MeshStandardMaterial({ color: '#b8bcc0', roughness: 0.4, metalness: 0.8 })
    const length = 13.6
    const wheel = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 24)
    const hub = new THREE.CylinderGeometry(0.28, 0.28, 0.34, 16)

    for (const x of TRAILER_XS) {
      const t = new THREE.Group()
      t.position.set(x, 0, WAREHOUSE_Z + 0.65 + length / 2)
      t.add(box([2.55, 2.75, length], [side, side, white, chassis, white, white], [0, 1.3 + 1.375, 0]))
      t.add(box([1.2, 0.3, length - 0.4], chassis, [0, 1.15, 0]))
      for (let a = 0; a < 3; a++)
        for (const sx of [-1, 1])
          for (const inset of [0, 0.34]) {
            const z = -length / 2 + 1.6 + a * 1.35
            const tx = sx * (1.08 - inset)
            const w = shadowed(new THREE.Mesh(wheel, tyre))
            w.rotation.z = Math.PI / 2
            w.position.set(tx, 0.5, z)
            t.add(w)
            if (!inset) {
              const h = new THREE.Mesh(hub, rim)
              h.rotation.z = Math.PI / 2
              h.position.set(tx + sx * 0.01, 0.5, z)
              t.add(h)
            }
          }
      for (const sx of [-1, 1]) t.add(box([0.12, 1.15, 0.12], chassis, [sx * 0.8, 0.58, length / 2 - 3]))
      this.group.add(t)
    }
  }

  setStacks() {
    const rand = rng(77)
    const heights = [
      [3, 2],
      [2, 4],
      [4, 3],
      [1, 2],
      [3, 3],
    ]
    for (const sx of [-1, 1])
      heights.forEach((rows, c) => {
        rows.forEach((count, r) => {
          for (let j = 0; j < count; j++) {
            const container = this.variants[(c + r + j + (sx > 0 ? 1 : 0)) % this.variants.length].clone()
            container.position.set(
              sx * (9.6 + c * (SIZE.width + STACK_GAP)),
              j * SIZE.height,
              -r * (SIZE.length + 0.5) + (rand() - 0.5) * 0.06,
            )
            container.rotation.y = (rand() - 0.5) * 0.008
            this.group.add(container)
          }
        })
      })
  }

  setLightMasts() {
    const steel = new THREE.MeshStandardMaterial({ color: '#9aa0a5', roughness: 0.5, metalness: 0.8 })
    const lamp = new THREE.MeshStandardMaterial({ color: '#f4f1e8', emissive: '#fff2cc', emissiveIntensity: 0.6 })
    for (const [x, z] of [
      [-7.5, 26],
      [7.5, 26],
      [-30, 8],
      [30, 8],
      [-22, -16],
      [22, -16],
    ]) {
      const mast = new THREE.Group()
      mast.position.set(x, 0, z)
      mast.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 18, 12), steel)).translateY(9))
      mast.add(box([3.2, 0.15, 0.15], steel, [0, 17.6, 0]))
      for (const lx of [-1.3, -0.45, 0.45, 1.3]) {
        const head = box([0.7, 0.45, 0.25], lamp, [lx, 17.25, 0])
        head.rotation.x = 0.5
        mast.add(head)
      }
      mast.lookAt(0, 0, 0)
      this.group.add(mast)
    }
  }

  setPallets() {
    const wood = new THREE.MeshStandardMaterial({ color: '#9a7a52', roughness: 0.9 })
    const carton = new THREE.MeshStandardMaterial({ map: toTexture(cardboardCanvas(this.logo, 52)), roughness: 0.85 })
    const wrap = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.15, transmission: 0.6, transparent: true, opacity: 0.35 })
    const rand = rng(88)
    const spots = [
      [13, -17],
      [14.5, -17],
      [16, -17],
      [13.7, -15.5],
      [-14, -17],
      [-15.5, -17],
      [-14.7, -15.4],
      [21, -18],
    ]
    for (const [x, z] of spots) {
      const pallet = new THREE.Group()
      pallet.position.set(x, 0, z)
      pallet.rotation.y = (rand() - 0.5) * 0.2
      for (const px of [-0.5, 0, 0.5]) pallet.add(box([0.1, 0.1, 1.0], wood, [px, 0.05, 0]))
      pallet.add(box([1.2, 0.03, 1.0], wood, [0, 0.12, 0]))
      const layers = 2 + Math.floor(rand() * 3)
      for (let l = 0; l < layers; l++)
        for (const cx of [-0.3, 0.3])
          for (const cz of [-0.25, 0.25]) pallet.add(box([0.58, 0.4, 0.48], carton, [cx, 0.335 + l * 0.41, cz]))
      const wrapped = new THREE.Mesh(new THREE.BoxGeometry(1.22, layers * 0.41, 1.02), wrap)
      wrapped.position.y = 0.135 + (layers * 0.41) / 2
      pallet.add(wrapped)
      this.group.add(pallet)
    }
  }

  setBollards() {
    const yellow = new THREE.MeshStandardMaterial({ color: '#e0b31a', roughness: 0.5, metalness: 0.3 })
    const geo = new THREE.CylinderGeometry(0.1, 0.1, 1.1, 16)
    const hw = SIZE.width / 2 + 0.9
    const hl = SIZE.length / 2 + 1.0
    for (const [x, z] of [
      [hw, hl],
      [-hw, hl],
      [hw, -hl],
      [-hw, -hl],
      ...DOCK_XS.flatMap((x) => [
        [x - 2.1, WAREHOUSE_Z + 0.8],
        [x + 2.1, WAREHOUSE_Z + 0.8],
      ]),
    ]) {
      const b = shadowed(new THREE.Mesh(geo, yellow))
      b.position.set(x, 0.55, z)
      this.group.add(b)
    }
  }

  setFence() {
    const map = toTexture(chainLinkCanvas(), { srgb: false })
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    const post = new THREE.MeshStandardMaterial({ color: '#8d9295', roughness: 0.5, metalness: 0.8 })
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8)
    const runs = [
      [0, 48, 130, 0],
      [-65, -10, 116, Math.PI / 2],
      // East side has a gate where the road leaves the yard (z 5..27)
      [65, -31.5, 73, Math.PI / 2],
      [65, 37.5, 21, Math.PI / 2],
    ]
    for (const [x, z, len, rot] of runs) {
      const m = map.clone()
      m.repeat.set(len / 0.6, 2.4 / 0.6)
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(len, 2.4),
        new THREE.MeshStandardMaterial({ alphaMap: m, color: '#a9afb3', transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6 }),
      )
      mesh.position.set(x, 1.3, z)
      mesh.rotation.y = rot
      this.group.add(mesh)
      for (let d = -len / 2; d <= len / 2; d += 3) {
        const p = new THREE.Mesh(postGeo, post)
        p.position.set(x + Math.cos(rot) * d, 1.3, z - Math.sin(rot) * d)
        this.group.add(p)
      }
    }
  }
}
