import * as THREE from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Sky } from 'three/addons/objects/Sky.js'
import { createContainer, doorSequence, fillWithCargo, SIZE } from './Container.js'
import Yard from './Yard.js'
import Worker, { PARCEL } from './Worker.js'
import Truck from './Truck.js'
import Forklift from './Forklift.js'
import { workerState, forkliftState, cameraState, truckPath, CARGO_FRONT_Z, CAPTIONS, CHAPTERS, LIFT, CRANE, SEA, craneState, shipPose, whiteout, VOYAGE_END } from './Story.js'
import Clouds from './Clouds.js'
import { route, buildCountryside } from './Route.js'
import Port from './Port.js'
import { cardboardCanvas, loadImage, processLogo, toTexture } from './textures.js'

gsap.registerPlugin(ScrollTrigger)

const HAZE = '#c9d3dc'
const WHITE = new THREE.Color('#ffffff')
const SUN = new THREE.Vector3(20, 26, 30).normalize()

export default class Experience {
  constructor(canvas) {
    this.canvas = canvas
    this.sizes = { width: window.innerWidth, height: window.innerHeight }
    this.timer = new THREE.Timer()
    this.story = { p: 0 }

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(HAZE, 120, 750)

    this.camera = new THREE.PerspectiveCamera(42, this.sizes.width / this.sizes.height, 0.1, 2000)
    this.camera.position.set(17, 9, 30)
    this.cameraTarget = new THREE.Vector3(0, 1.6, 2)
    this.camera.lookAt(this.cameraTarget)
    this.scene.add(this.camera)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setSize(this.sizes.width, this.sizes.height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.62
    this.renderer.shadowMap.enabled = true

    this.setSky()
    this.setLights()
    this.setWorld()

    window.addEventListener('resize', () => this.resize())
    this.renderer.setAnimationLoop(() => this.update())
  }

  setSky() {
    const sky = new Sky()
    sky.scale.setScalar(5000)
    const u = sky.material.uniforms
    u.turbidity.value = 6
    u.rayleigh.value = 1.4
    u.mieCoefficient.value = 0.006
    u.mieDirectionalG.value = 0.85
    u.sunPosition.value.copy(SUN)
    this.scene.add(sky)

    // Light the scene with the sky itself for believable daylight reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const skyScene = new THREE.Scene()
    skyScene.add(sky.clone())
    this.scene.environment = pmrem.fromScene(skyScene).texture
    this.scene.environmentIntensity = 0.35
  }

  setLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x4a4540, 0.25))

    const sun = new THREE.DirectionalLight(0xfff1dc, 3.2)
    sun.position.copy(SUN).multiplyScalar(50)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    const s = sun.shadow.camera
    s.left = s.bottom = -32
    s.right = s.top = 32
    s.far = 140
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    this.scene.add(sun, sun.target)
    this.sun = sun
  }

  async setWorld() {
    const logo = processLogo(await loadImage('/textures/eliv-logo.png'))
    const variants = [
      createContainer({ color: '#2457b3', logo, seed: 3 }),
      createContainer({ color: '#14295c', logo, seed: 11 }),
    ]

    this.yard = new Yard({ scene: this.scene, logo, variants })
    buildCountryside(this.scene)
    this.port = new Port({ scene: this.scene, logo, variants })
    this.shipPose = {}
    this.clouds = new Clouds({ center: new THREE.Vector3(VOYAGE_END.x, 0, VOYAGE_END.z), sun: SUN })
    this.clouds.mesh.visible = false
    this.scene.add(this.clouds.mesh)

    // The one container on the ground, doors open, waiting for the parcel
    this.container = variants[0].clone()
    this.scene.add(this.container)
    this.doors = doorSequence(this.container)
    this.doors.progress(1)

    const cardboard = new THREE.MeshStandardMaterial({ map: toTexture(cardboardCanvas(logo)), roughness: 0.85 })
    fillWithCargo(this.container, cardboard, CARGO_FRONT_Z, { size: [PARCEL.width, PARCEL.height, PARCEL.depth] })
    this.parcel = new THREE.Mesh(new THREE.BoxGeometry(PARCEL.width, PARCEL.height, PARCEL.depth), cardboard)
    this.parcel.castShadow = this.parcel.receiveShadow = true
    // Child of the container (which starts at the origin), so it rides along when lifted
    this.container.add(this.parcel)

    this.truck = new Truck(logo)
    this.scene.add(this.truck.group)

    this.forklift = new Forklift(logo)
    this.scene.add(this.forklift.group)
    this.liftState = { position: new THREE.Vector3() }
    this.setContainerHandoff()

    this.worker = await new Worker().load('/models/worker.glb')
    this.scene.add(this.worker.root)
    this.state = { position: new THREE.Vector3(), parcel: new THREE.Vector3() }

    gsap.to(this.story, {
      p: 1,
      ease: 'none',
      scrollTrigger: { trigger: '.story', start: 'top top', end: 'bottom bottom', scrub: 1.2 },
    })

    this.captions = CAPTIONS.map((c) => ({ ...c, el: document.querySelector(`[data-caption="${c.id}"]`) }))
    this.setChapterNav()
    this.whiteout = document.querySelector('.whiteout')
    document.body.classList.add('ready')
  }

  // While on the forks the container is rigidly attached to the carriage.
  // Precompute that attachment (from the pose at pickup) and the resting
  // pose on the trailer (from the pose at release).
  setContainerHandoff() {
    const carriageAt = (p) => {
      this.forklift.pose(forkliftState(p, this.liftState))
      return this.forklift.carriage.matrixWorld.clone()
    }
    this.carryOffset = carriageAt(LIFT.lift[0]).invert().multiply(this.container.matrixWorld)
    this.placedMatrix = carriageAt(LIFT.release[0]).multiply(this.carryOffset)
    // Once set down, the container rides on the trailer (parked pose here)
    this.truck.follow(truckPath, truckPath.length)
    this.trailerOffset = this.truck.trailer.group.matrixWorld.clone().invert().multiply(this.placedMatrix)
    this.containerMatrix = new THREE.Matrix4()
  }

  // Once the crane model has loaded: where the spreader picks (container top
  // on the parked trailer) and drops (top of the free slot on the ship), and
  // the container's attachment to the spreader at the moment it locks on.
  setCraneHandoff() {
    const rig = this.port.rig
    this.truck.follow(route, route.length, { dir: 1 })
    const onTrailer = new THREE.Matrix4().multiplyMatrices(this.truck.trailer.group.matrixWorld, this.trailerOffset)
    const pick = new THREE.Vector3().setFromMatrixPosition(onTrailer)
    pick.y += SIZE.height
    const drop = this.port.shipSlot.clone()
    drop.y += SIZE.height
    // Carried container clears the tallest stack on the ship by 1.5 m
    this.craneKeys = { rest: rig.rest.clone(), pick, drop, clear: this.port.shipTop + SIZE.height + 1.5 }
    this.craneSpot = {}

    const anchorAt = (p) => {
      craneState(p, this.craneKeys, this.craneSpot)
      rig.place(this.craneSpot.x, this.craneSpot.y)
      return rig.anchor.matrixWorld.clone()
    }
    this.craneOffset = anchorAt(CRANE.lock[0]).invert().multiply(onTrailer)
    // Once released it belongs to the ship (at her berth pose), so it floats and sails with her
    const placed = anchorAt(CRANE.release[0]).multiply(this.craneOffset)
    this.port.updateShip(shipPose(0, {}))
    this.shipOffset = this.port.ship.matrixWorld.clone().invert().multiply(placed)
  }

  placeContainer(p) {
    const crane = this.craneKeys
    if (p < LIFT.lift[0]) this.containerMatrix.identity()
    else if (p < LIFT.release[0]) this.containerMatrix.multiplyMatrices(this.forklift.carriage.matrixWorld, this.carryOffset)
    else if (!crane || p < CRANE.lock[0]) this.containerMatrix.multiplyMatrices(this.truck.trailer.group.matrixWorld, this.trailerOffset)
    else if (p < CRANE.release[0]) this.containerMatrix.multiplyMatrices(this.port.rig.anchor.matrixWorld, this.craneOffset)
    else this.containerMatrix.multiplyMatrices(this.port.ship.matrixWorld, this.shipOffset)
    this.containerMatrix.decompose(this.container.position, this.container.quaternion, this.container.scale)
  }

  setChapterNav() {
    const nav = document.querySelector('.chapters')
    this.chapters = CHAPTERS.map((c) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.textContent = c.label
      el.addEventListener('click', () => {
        const story = document.querySelector('.story')
        const top = story.offsetTop + c.at * (story.offsetHeight - window.innerHeight)
        window.scrollTo({ top, behavior: 'smooth' })
      })
      nav.append(el)
      return { ...c, el }
    })
  }

  resize() {
    this.sizes.width = window.innerWidth
    this.sizes.height = window.innerHeight

    this.camera.aspect = this.sizes.width / this.sizes.height
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(this.sizes.width, this.sizes.height)
    this.renderer.setPixelRatio(this.clouds?.mesh.visible ? 1 : Math.min(window.devicePixelRatio, 2))
  }

  update() {
    this.timer.update()
    const delta = this.timer.getDelta()

    if (this.worker) {
      const p = this.story.p
      const state = workerState(p, this.state)
      this.worker.update(state, delta)

      this.parcel.position.copy(state.parcel)
      this.parcel.rotation.y = state.holding ? state.heading : Math.PI
      this.doors.progress(1 - state.doorsClosed)

      this.port.updateShip(shipPose(p, this.shipPose))
      if (this.port.rig && !this.craneKeys) this.setCraneHandoff()
      if (this.craneKeys) {
        craneState(p, this.craneKeys, this.craneSpot)
        this.port.rig.place(this.craneSpot.x, this.craneSpot.y)
      }
      if (state.onRoad) this.truck.follow(route, state.routeS, { dir: 1, travelled: state.routeS - truckPath.length })
      else this.truck.follow(truckPath, state.truckS, { reversing: state.truckReversing })
      this.forklift.pose(forkliftState(p, this.liftState))
      this.placeContainer(p)

      cameraState(
        p,
        { worker: state.position, truck: this.truck.center, lift: this.liftState.position, ship: this.port.ship.position },
        this.camera.position,
        this.cameraTarget,
      )
      this.camera.lookAt(this.cameraTarget)

      for (const c of this.captions) c.el?.classList.toggle('visible', p >= c.range[0] && p <= c.range[1])
      this.chapters.forEach((c, i) => c.el.classList.toggle('active', p >= c.at && (i === this.chapters.length - 1 || p < this.chapters[i + 1].at)))

      // Keep the shadow frustum on whatever the camera is looking at
      this.sun.target.position.copy(this.cameraTarget)
      this.sun.position.copy(this.cameraTarget).addScaledVector(SUN, 60)
      this.sun.target.updateMatrixWorld()

      this.port.water.visible = p > 0.68
      // Cloud layer is ray-marched: only draw it from the voyage on, at 1x
      // pixel ratio so the climb through it stays smooth
      const cloudy = p > SEA.sail[0]
      if (cloudy !== this.clouds.mesh.visible) {
        this.clouds.mesh.visible = cloudy
        this.renderer.setPixelRatio(cloudy ? 1 : Math.min(window.devicePixelRatio, 2))
      }
      this.clouds.update(delta)

      // Climbing above the clouds: haze turns white, then the screen does
      const altitude = THREE.MathUtils.smoothstep(this.camera.position.y, 110, 220)
      this.scene.fog.color.set(HAZE).lerp(WHITE, altitude)
      const white = whiteout(p)
      this.whiteout.style.opacity = white
      document.body.classList.toggle('is-white', white > 0.5)
      this.port.update(delta)
    }

    this.renderer.render(this.scene, this.camera)
  }
}
