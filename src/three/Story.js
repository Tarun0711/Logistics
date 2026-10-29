import * as THREE from 'three'
import { SIZE } from './Container.js'
import { PARCEL, STRIDE } from './Worker.js'
import { TRAILER_CENTER } from './Truck.js'
import { FORK_FACE_Z } from './Forklift.js'
import { route, CRANE_POS, QUAY_X, TRUCK_LANE_X, BERTH_X } from './Route.js'

// Scroll-driven choreography. Everything is a pure function of scroll
// progress p (0..1), so scrubbing backwards rewinds the scene exactly.

const FLOOR = 0.17 // container floor height above the yard
const DOOR_Z = SIZE.length / 2
const DROP_Z = DOOR_Z - 2 // where the worker stands to set the parcel down
export const CARGO_FRONT_Z = DROP_Z - 0.78 // face of the cartons already loaded

const PHASES = {
  walkIn: [0.028, 0.21],
  crouch: [0.224, 0.273],
  rise: [0.273, 0.315],
  turn: [0.315, 0.336],
  walkOut: [0.336, 0.476],
  doors: [0.392, 0.476],
  truck: [0.49, 0.68],
}

// Forklift: drive in, slide forks into the pockets, lift, carry across onto
// the trailer, set down, drop the forks clear and back away.
export const LIFT = {
  approach: [0.7, 0.77],
  engage: [0.77, 0.8],
  lift: [0.8, 0.83],
  carry: [0.83, 0.9],
  lower: [0.9, 0.92],
  release: [0.92, 0.935],
  reverse: [0.935, 0.98],
}

// The yard chapters above were authored on a 0..1 scroll; they now play in
// the first EARLY share of it, leaving room for the drive to the port.
// Everything through the crane lift plays in the first LATE share of the
// scroll; the rest is the ship sailing and the climb above the clouds.
const LATE = 0.82
const late = (range) => range.map((v) => v * LATE)
const EARLY = 0.62 * LATE
for (const phases of [PHASES, LIFT]) for (const k in phases) phases[k] = phases[k].map((v) => v * EARLY)

export const ROAD = { drive: late([0.63, 0.86]) }

// Crane: trolley over the truck, lower, lock twist-locks, hoist clear of the
// ship's stacks, travel out over the ship, set down, release and lift away
export const CRANE = {
  toTruck: late([0.862, 0.88]),
  lower: late([0.88, 0.897]),
  lock: late([0.897, 0.904]),
  hoist: late([0.904, 0.921]),
  travel: late([0.921, 0.942]),
  set: late([0.942, 0.957]),
  release: late([0.957, 0.966]),
}

export const SEA = {
  sail: [0.835, 0.935], // backs out of the berth
  ascend: [0.915, 0.985], // camera climbs through the cloud layer
  white: [0.955, 1.0], // scene fades to white
}
// Voyage: back straight out until the bow clears the jetty, swing to
// starboard round a turning circle, then accelerate bow-first out to sea
const ASTERN = 225
const TURN_R = 60
const AHEAD = 380
const ASTERN_SHARE = 0.3
const HEEL = 0.09
export const VOYAGE_END = { x: BERTH_X + TURN_R + AHEAD, z: ASTERN - TURN_R }

const TURN_DISTANCE = 0.9

const inbound = new THREE.CatmullRomCurve3([
  new THREE.Vector3(5.5, 0, 17),
  new THREE.Vector3(3.4, 0, 12),
  new THREE.Vector3(0.6, 0, 7.5),
  new THREE.Vector3(0, 0, DOOR_Z + 1.4),
  new THREE.Vector3(0, 0, DROP_Z),
])
const outbound = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, DROP_Z),
  new THREE.Vector3(0, 0, DOOR_Z + 1.6),
  new THREE.Vector3(-0.8, 0, 8),
  new THREE.Vector3(-3.6, 0, 13.5),
  new THREE.Vector3(-8, 0, 20),
])
const inLength = inbound.getLength()
const outLength = outbound.getLength()

// The trailer's middle axle reverses along this line: in from the right
// along the lane, then curving back into the bay beside the container.
export const TRUCK_PARK_X = 4.6
const truckCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(34, 0, 15.5),
    new THREE.Vector3(20, 0, 15.5),
    new THREE.Vector3(10, 0, 14.6),
    new THREE.Vector3(5.4, 0, 11),
    new THREE.Vector3(TRUCK_PARK_X, 0, 5.5),
    new THREE.Vector3(TRUCK_PARK_X, 0, 0),
    new THREE.Vector3(TRUCK_PARK_X, 0, -TRAILER_CENTER),
  ],
  false,
  'centripetal',
)
const truckLength = truckCurve.getLength()
const truckStartDir = truckCurve.getTangentAt(0)
export const truckPath = {
  length: truckLength,
  // Negative s extends the run-in straight, so the cab has road to sit on
  pointAt: (s) =>
    s <= 0
      ? truckCurve.getPointAt(0).addScaledVector(truckStartDir, s)
      : truckCurve.getPointAt(Math.min(s / truckLength, 1)),
}

const clamp01 = (v) => THREE.MathUtils.clamp(v, 0, 1)
const local = (p, [a, b]) => clamp01((p - a) / (b - a))
const smooth = (t) => t * t * (3 - 2 * t)
// Gentle ease-in/out on walking so he accelerates and settles
const walkEase = (t) => (t < 0.08 ? (t * t) / 0.16 : t > 0.92 ? 1 - ((1 - t) * (1 - t)) / 0.16 : t)
// Trucks pull away slowly and creep the last metres
const driveEase = (t, a = 0.15, b = 0.3) => {
  const g = t < a ? (t * t) / (2 * a) : t < 1 - b ? t - a / 2 : 1 - b - a / 2 + b / 2 - ((1 - t) * (1 - t)) / (2 * b)
  return g / (1 - (a + b) / 2)
}

// Long drive: gentle pull-away, steady cruise, long smooth stop under the crane
const roadEase = (t) => driveEase(t, 0.08, 0.16)

// Step up over the door sill onto the container floor
const floorAt = (x, z) => (Math.abs(x) < SIZE.width / 2 ? FLOOR * smooth(clamp01((DOOR_Z + 0.05 - z) / 0.3)) : 0)

const headingOf = (tangent) => Math.atan2(tangent.x, tangent.z)

const _tan = new THREE.Vector3()
const _fwd = new THREE.Vector3()

export function workerState(p, out) {
  const tIn = walkEase(local(p, PHASES.walkIn))
  const tTurn = smooth(local(p, PHASES.turn))
  const tOut = walkEase(local(p, PHASES.walkOut))
  const tCrouch = smooth(local(p, PHASES.crouch))
  const tRise = smooth(local(p, PHASES.rise))

  let distance
  if (p < PHASES.turn[0]) {
    inbound.getPointAt(tIn, out.position)
    out.heading = headingOf(inbound.getTangentAt(Math.min(tIn, 0.999), _tan))
    distance = tIn * inLength
  } else if (p < PHASES.walkOut[0]) {
    out.position.set(0, 0, DROP_Z)
    out.heading = Math.PI * (1 - tTurn)
    distance = inLength + tTurn * TURN_DISTANCE
  } else {
    outbound.getPointAt(tOut, out.position)
    out.heading = headingOf(outbound.getTangentAt(Math.max(tOut, 0.001), _tan))
    distance = inLength + TURN_DISTANCE + tOut * outLength
  }
  out.position.y = floorAt(out.position.x, out.position.z)
  out.walkPhase = (distance / STRIDE) * 1.0333

  const walking = (range, fade = 0.007) =>
    smooth(clamp01((p - range[0] + fade) / fade)) * smooth(clamp01((range[1] + fade - p) / fade))
  out.walkWeight = Math.max(walking(PHASES.walkIn), walking(PHASES.turn), walking(PHASES.walkOut))

  out.crouch = p < PHASES.rise[0] ? tCrouch : 1 - tRise
  out.carry = p < PHASES.rise[0] ? 1 : 1 - smooth(clamp01(local(p, PHASES.rise) * 2.5))
  out.holding = p < PHASES.crouch[1]

  // Parcel: carried in front of the chest, then lowered to the floor
  _fwd.set(Math.sin(out.heading), 0, Math.cos(out.heading))
  const carried = new THREE.Vector3().copy(out.position).addScaledVector(_fwd, 0.36)
  carried.y += 1.0
  const placed = new THREE.Vector3(0, FLOOR + PARCEL.height / 2, CARGO_FRONT_Z + PARCEL.depth / 2 + 0.03)
  if (p < PHASES.crouch[0]) out.parcel.copy(carried)
  else if (out.holding) out.parcel.lerpVectors(carried.setY(1.0 + FLOOR), placed, tCrouch)
  else out.parcel.copy(placed)

  out.doorsClosed = smooth(local(p, PHASES.doors))

  const tTruck = local(p, PHASES.truck)
  out.truckS = driveEase(tTruck) * truckLength
  out.truckReversing = tTruck > 0 && tTruck < 1
  out.onRoad = p >= ROAD.drive[0]
  out.routeS = roadEase(local(p, ROAD.drive)) * route.length
  return out
}

// Camera keyframes: positions/targets absolute, relative to the worker, or
// relative to the trailer's centre
const rel = (x, y, z) => (c) => new THREE.Vector3(x, y, z).add(c.worker)
const abs = (x, y, z) => () => new THREE.Vector3(x, y, z)
const truck = (x, y, z) => (c) => new THREE.Vector3(x, y, z).add(c.truck)
const lift = (x, y, z) => (c) => new THREE.Vector3(x, y, z).add(c.lift)
const ship = (x, y, z) => (c) => new THREE.Vector3(x, y, z).add(c.ship)
const YARD_CAMERA = [
  { p: 0.0, pos: abs(17, 9, 30), target: abs(0, 1.6, 2) },
  { p: 0.035, pos: rel(3.8, 2.3, 6.5), target: rel(0, 1.1, 0) },
  { p: 0.175, pos: rel(1.7, 1.7, 3.6), target: rel(0, 1.0, -1.2) },
  { p: 0.231, pos: abs(1.1, 1.75, DOOR_Z + 2.7), target: abs(0, 0.7, DROP_Z - 0.6) },
  { p: 0.315, pos: abs(1.1, 1.75, DOOR_Z + 2.7), target: abs(0, 0.85, DROP_Z - 0.4) },
  { p: 0.364, pos: abs(2.6, 1.6, 10.5), target: rel(0, 1.1, 0) },
  { p: 0.476, pos: abs(7, 3.4, 18.5), target: abs(0, 1.4, 1.5) },
  { p: 0.518, pos: abs(4, 4.6, 27), target: truck(0, 1.5, 0) },
  { p: 0.616, pos: abs(17, 6.5, 31), target: truck(0, 1.4, 0) },
  { p: 0.686, pos: abs(1.2, 3.1, 20), target: abs(2.3, 1.5, 0.5) },
  { p: 0.73, pos: abs(-12, 5.5, 17), target: lift(0, 1.5, 0) },
  { p: 0.79, pos: abs(-8, 3.2, 8), target: abs(-0.5, 0.8, 0) },
  { p: 0.84, pos: abs(-6.5, 4, 9), target: abs(0, 1.8, 0) },
  { p: 0.9, pos: abs(-1.5, 4.8, 12), target: abs(3, 2.2, 0) },
  { p: 0.99, pos: abs(9, 3.6, 17), target: abs(3.8, 1.9, 0) },
]
const C = CRANE_POS
const CAMERA_KEYS = [
  ...YARD_CAMERA.map((k) => ({ ...k, p: k.p * EARLY })),
  ...[
    { p: 0.635, pos: truck(-14, 13, 22), target: truck(0, 1.2, 0) },
    { p: 0.69, pos: truck(-24, 28, 18), target: truck(3, 0, 0) },
    { p: 0.75, pos: truck(-18, 34, -26), target: truck(2, 0, 0) },
    { p: 0.81, pos: truck(-30, 30, -8), target: truck(2, 0, 2) },
    { p: 0.855, pos: truck(-24, 15, -30), target: truck(0, 2, 6) },
    { p: 0.875, pos: abs(C.x - 44, 15, C.z - 34), target: abs(C.x - 8, 9, C.z) },
    { p: 0.9, pos: abs(TRUCK_LANE_X - 22, 9, C.z - 22), target: abs(TRUCK_LANE_X + 2, 5, C.z) },
    { p: 0.94, pos: abs(C.x - 36, 27, C.z - 40), target: abs(C.x + 2, 16, C.z) },
    { p: 0.966, pos: abs(C.x - 22, 31, C.z - 34), target: abs(QUAY_X + 11, 19, C.z) },
  ].map((k) => ({ ...k, p: k.p * LATE })),
  { p: 0.83, pos: ship(-34, 62, 52), target: ship(0, 12, 8) },
  { p: 0.9, pos: ship(-14, 88, 74), target: ship(0, 8, -6) },
  { p: 0.94, pos: ship(-4, 130, 62), target: ship(0, 0, 0) },
  { p: 0.985, pos: ship(0, 235, 40), target: ship(0, 0, 0) },
  { p: 1.0, pos: ship(0, 262, 38), target: ship(0, 0, 0) },
]

export function cameraState(p, context, outPos, outTarget) {
  let i = 0
  while (i < CAMERA_KEYS.length - 2 && p > CAMERA_KEYS[i + 1].p) i++
  const a = CAMERA_KEYS[i]
  const b = CAMERA_KEYS[i + 1]
  const t = smooth(clamp01((p - a.p) / (b.p - a.p)))
  outPos.lerpVectors(a.pos(context), b.pos(context), t)
  outTarget.lerpVectors(a.target(context), b.target(context), t)
}

export const CAPTIONS = [
  ...[
    { range: [0.0, 0.028], id: 'intro' },
    { range: [0.05, 0.196], id: 'carry' },
    { range: [0.231, 0.315], id: 'load' },
    { range: [0.385, 0.476], id: 'sealed' },
    { range: [0.518, 0.69], id: 'truck' },
    { range: [0.74, 1.0], id: 'lift' },
  ].map((c) => ({ ...c, range: c.range.map((v) => v * EARLY) })),
  ...[
    { range: [0.645, 0.85], id: 'road' },
    { range: [0.87, 0.962], id: 'port' },
  ].map((c) => ({ ...c, range: late(c.range) })),
  { range: [0.84, 0.93], id: 'sea' },
  { range: [0.965, 1.0], id: 'sky' },
]

// Chapter navigation: label and the scroll progress it jumps to
export const CHAPTERS = [
  { label: 'Pickup', at: 0 },
  { label: 'The yard', at: 0.231 * EARLY },
  { label: 'Load', at: 0.49 * EARLY },
  { label: 'Road', at: 0.64 * LATE },
  { label: 'Port', at: 0.865 * LATE },
  { label: 'Sea', at: 0.81 },
]

// Forklift route: a curve in from the lane that straightens out facing +X,
// square to the container's side, then straight runs along X.
export const CONTAINER_REACH = FORK_FACE_Z + SIZE.width / 2 + 0.01
const PICK_X = -CONTAINER_REACH
const APPROACH_X = PICK_X - 2.6
const DROP_X = TRUCK_PARK_X - CONTAINER_REACH
const CLEAR_X = APPROACH_X + 1
const LIFT_HEIGHT = 1.75
const DECK = 1.5
const liftCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(-1, 0, 28),
    new THREE.Vector3(-4.5, 0, 18),
    new THREE.Vector3(-6.4, 0, 9),
    new THREE.Vector3(-6.7, 0, 4.2),
    new THREE.Vector3(-6.3, 0, 1.3),
    new THREE.Vector3(APPROACH_X - 0.8, 0, 0.1),
    new THREE.Vector3(APPROACH_X, 0, 0),
  ],
  false,
  'centripetal',
)
const liftCurveLength = liftCurve.getLength()
const _a = new THREE.Vector3()

export function forkliftState(p, out) {
  const tA = walkEase(local(p, LIFT.approach))
  let x = null
  if (p < LIFT.engage[0]) {
    liftCurve.getPointAt(tA, out.position)
    const tan = liftCurve.getTangentAt(Math.min(tA, 0.999), _tan)
    out.heading = Math.atan2(tan.x, tan.z)
    out.distance = tA * liftCurveLength
    // Rear-wheel steering from the path curvature
    const ahead = liftCurve.getTangentAt(Math.min(tA + 0.01, 1), _a)
    const dHeading = Math.atan2(ahead.x, ahead.z) - out.heading
    const ds = 0.01 * liftCurveLength
    out.steer = THREE.MathUtils.clamp(-Math.atan((3.2 * dHeading) / ds), -0.9, 0.9)
  } else {
    if (p < LIFT.carry[0]) x = THREE.MathUtils.lerp(APPROACH_X, PICK_X, smooth(local(p, LIFT.engage)))
    else if (p < LIFT.reverse[0]) x = THREE.MathUtils.lerp(PICK_X, DROP_X, driveEase(local(p, LIFT.carry)))
    else x = THREE.MathUtils.lerp(DROP_X, CLEAR_X, smooth(local(p, LIFT.reverse)))
    out.position.set(x, 0, 0)
    out.heading = Math.PI / 2
    out.distance = liftCurveLength + (x - APPROACH_X)
    out.steer = 0
  }

  // Forks ride a little high, drop to pocket height, lift, set down, clear
  const pocket = 0.12 * (1 - smooth(local(p, [LIFT.approach[1] - 0.02, LIFT.approach[1]])))
  if (p < LIFT.lift[0]) out.lift = pocket
  else if (p < LIFT.lower[0]) out.lift = LIFT_HEIGHT * smooth(local(p, LIFT.lift))
  else if (p < LIFT.release[0]) out.lift = THREE.MathUtils.lerp(LIFT_HEIGHT, DECK, smooth(local(p, LIFT.lower)))
  else if (p < LIFT.reverse[0]) out.lift = DECK - 0.14 * smooth(local(p, LIFT.release))
  else out.lift = THREE.MathUtils.lerp(DECK - 0.14, 0.3, smooth(local(p, LIFT.reverse)))

  // Mast tilts back while travelling loaded
  const carry = local(p, LIFT.carry)
  out.tilt = 0.045 * (smooth(clamp01(carry * 6)) - smooth(clamp01((carry - 0.8) * 5)))
  return out
}

// Spreader underside position over time. k: { rest, pick, drop, clear } with
// pick/drop the container-top points on the trailer and on the ship.
export function craneState(p, k, out) {
  const e = (range) => smooth(local(p, range))
  out.x = p < CRANE.travel[0] ? THREE.MathUtils.lerp(k.rest.x, k.pick.x, e(CRANE.toTruck)) : THREE.MathUtils.lerp(k.pick.x, k.drop.x, e(CRANE.travel))
  // Everything travels at the clear height, above the tallest stack on board
  if (p < CRANE.lower[0]) out.y = THREE.MathUtils.lerp(k.rest.y, k.clear, e(CRANE.toTruck))
  else if (p < CRANE.hoist[0]) out.y = THREE.MathUtils.lerp(k.clear, k.pick.y, e(CRANE.lower))
  else if (p < CRANE.set[0]) out.y = THREE.MathUtils.lerp(k.pick.y, k.clear, e(CRANE.hoist))
  else if (p < CRANE.release[0]) out.y = THREE.MathUtils.lerp(k.clear, k.drop.y, e(CRANE.set))
  else out.y = THREE.MathUtils.lerp(k.drop.y, k.drop.y + 4, e(CRANE.release))
  return out
}

// Ship pose along the voyage: position (x, z), yaw, heel and squat, plus
// how hard she is going ahead / astern (0..1, for the foam)
export function shipPose(p, out) {
  const t = local(p, SEA.sail)
  out.moving = t > 0
  out.pitch = 0
  out.roll = 0
  out.astern = t < ASTERN_SHARE ? Math.sin((Math.PI * t) / ASTERN_SHARE) : 0
  if (t < ASTERN_SHARE) {
    out.x = BERTH_X
    out.z = ASTERN * smooth(t / ASTERN_SHARE)
    out.yaw = 0
    out.ahead = 0
    return out
  }
  const u = (t - ASTERN_SHARE) / (1 - ASTERN_SHARE)
  const arc = (Math.PI * TURN_R) / 2
  const d = (arc + AHEAD) * u ** 1.7
  let dx = 1
  let dz = 0
  if (d < arc) {
    const phi = Math.PI + d / TURN_R
    out.x = BERTH_X + TURN_R + TURN_R * Math.cos(phi)
    out.z = ASTERN + TURN_R * Math.sin(phi)
    dx = -Math.sin(phi)
    dz = Math.cos(phi)
  } else {
    out.x = BERTH_X + TURN_R + (d - arc)
    out.z = ASTERN - TURN_R
  }
  // Bow is local -Z; heel outward (to port) through the starboard turn
  out.yaw = Math.atan2(-dx, -dz)
  out.ahead = clamp01(1.7 * u ** 0.7)
  out.roll = HEEL * Math.sin(Math.PI * clamp01(d / arc)) + 0.025 * out.ahead
  out.pitch = 0.012 * out.ahead
  return out
}

export const whiteout = (p) => smooth(local(p, SEA.white))
