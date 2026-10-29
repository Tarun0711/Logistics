import * as THREE from 'three'
import { rng } from './textures.js'

// Volumetric cumulus layer, ray-marched through a box. Density comes from a
// tileable 3D Perlin-Worley noise texture (soft billows with crisp,
// cauliflower edges), shaped into flat-based towers, lit by marching towards
// the sun (Beer-Lambert + Henyey-Greenstein for the silver lining).

const SIZE = 64

function perlinWorley() {
  const rand = rng(701)
  const n = SIZE

  // Worley: one feature point per cell, periodic over the tile
  const worley = (cells) => {
    const pts = new Float32Array(cells ** 3 * 3)
    for (let i = 0; i < pts.length; i++) pts[i] = rand()
    return (x, y, z) => {
      const fx = x * cells
      const fy = y * cells
      const fz = z * cells
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      const iz = Math.floor(fz)
      let best = 9
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const cx = ix + dx
            const cy = iy + dy
            const cz = iz + dz
            const w = (((cx % cells) + cells) % cells) + cells * ((((cy % cells) + cells) % cells) + cells * (((cz % cells) + cells) % cells))
            const px = cx + pts[w * 3] - fx
            const py = cy + pts[w * 3 + 1] - fy
            const pz = cz + pts[w * 3 + 2] - fz
            best = Math.min(best, px * px + py * py + pz * pz)
          }
      return Math.min(Math.sqrt(best), 1)
    }
  }

  // Value noise on a periodic lattice
  const value = (period) => {
    const lattice = new Float32Array(period ** 3)
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
    const at = (x, y, z) => lattice[(x % period) + period * ((y % period) + period * (z % period))]
    const s = (t) => t * t * (3 - 2 * t)
    return (x, y, z) => {
      const fx = x * period
      const fy = y * period
      const fz = z * period
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      const iz = Math.floor(fz)
      const tx = s(fx - ix)
      const ty = s(fy - iy)
      const tz = s(fz - iz)
      const lerp = (a, b, t) => a + (b - a) * t
      const c = (dx, dy, dz) => at(ix + dx, iy + dy, iz + dz)
      return lerp(
        lerp(lerp(c(0, 0, 0), c(1, 0, 0), tx), lerp(c(0, 1, 0), c(1, 1, 0), tx), ty),
        lerp(lerp(c(0, 0, 1), c(1, 0, 1), tx), lerp(c(0, 1, 1), c(1, 1, 1), tx), ty),
        tz,
      )
    }
  }

  const w = [worley(4), worley(8), worley(16)]
  const v = [value(4), value(8), value(16), value(32)]
  const raw = new Float32Array(n ** 3)
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const px = x / n
        const py = y / n
        const pz = z / n
        const wf = (1 - w[0](px, py, pz)) * 0.625 + (1 - w[1](px, py, pz)) * 0.25 + (1 - w[2](px, py, pz)) * 0.125
        const pf = v[0](px, py, pz) * 0.5 + v[1](px, py, pz) * 0.25 + v[2](px, py, pz) * 0.15 + v[3](px, py, pz) * 0.1
        // Perlin-Worley: billowy value noise, eroded by inverted Worley
        const pw = THREE.MathUtils.clamp((pf - (wf - 1)) / (1 - (wf - 1)) - 0.25, 0, 1) / 0.75
        raw[x + n * (y + n * z)] = pw * 0.4 + wf * 0.6
      }
  // Stretch to the full 0..1 range for well-defined billows
  let lo = Infinity
  let hi = -Infinity
  for (const v of raw) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const data = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) data[i] = Math.round(((raw[i] - lo) / (hi - lo)) * 255)

  const texture = new THREE.Data3DTexture(data, n, n, n)
  texture.format = THREE.RedFormat
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform vec3 uSun;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform float uTime;
  uniform float uCoverage;
  varying vec3 vWorld;

  #define STEPS 56
  #define LIGHT_STEPS 4

  float hg(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
  }

  vec2 boxHit(vec3 ro, vec3 rd) {
    vec3 t0 = (uBoxMin - ro) / rd;
    vec3 t1 = (uBoxMax - ro) / rd;
    vec3 lo = min(t0, t1);
    vec3 hi = max(t0, t1);
    return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
  }

  float density(vec3 p) {
    vec3 size = uBoxMax - uBoxMin;
    float h = (p.y - uBoxMin.y) / size.y;
    vec3 wind = vec3(uTime * 1.6, 0.0, uTime * 0.7);
    // Large-scale coverage map decides where cloud towers form
    float weather = texture(uNoise, vec3((p.xz + wind.xz * 0.3) * 0.0011, 0.37)).r;
    float cover = smoothstep(0.3, 0.7, weather) * uCoverage;
    // Cumulus profile: flat base, towers that round off higher up
    float profile = smoothstep(0.0, 0.1, h) * smoothstep(1.0, 0.35 + 0.5 * (1.0 - cover), h);
    float base = texture(uNoise, (p + wind) * 0.0042).r;
    float d = clamp((base * profile - (1.0 - cover)) / max(cover, 0.05), 0.0, 1.0);
    if (d <= 0.0) return 0.0;
    // Billow the edges at two finer scales: cauliflower puffs on every tower
    float puff = texture(uNoise, (p + wind * 1.6) * 0.011).r;
    float curl = texture(uNoise, (p + wind * 2.4) * 0.027).r;
    float detail = puff * 0.65 + curl * 0.35;
    d = clamp(d - (1.0 - detail) * 0.55 * (1.0 - d), 0.0, 1.0);
    // Fade towards the box sides so the layer has no hard edge
    vec2 edge = min(p.xz - uBoxMin.xz, uBoxMax.xz - p.xz) / (size.xz * 0.12);
    return d * smoothstep(0.0, 1.0, min(edge.x, edge.y));
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    vec2 t = boxHit(ro, rd);
    t.x = max(t.x, 0.0);
    if (t.x >= t.y) discard;

    float len = min(t.y - t.x, 1100.0);
    float dt = len / float(STEPS);
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float mu = dot(rd, uSun);
    float phase = mix(hg(mu, 0.65), hg(mu, -0.2), 0.35);

    float transmittance = 1.0;
    vec3 light = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * (t.x + (float(i) + jitter) * dt);
      float d = density(p);
      if (d > 0.005) {
        float toward = 0.0;
        for (int j = 1; j <= LIGHT_STEPS; j++) toward += density(p + uSun * float(j * j) * 6.0);
        float sunT = exp(-toward * 0.55);
        float powder = 1.0 - exp(-d * 6.0);
        float h = clamp((p.y - uBoxMin.y) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
        vec3 ambient = mix(vec3(0.52, 0.58, 0.68), vec3(0.93, 0.95, 1.0), h);
        vec3 sun = vec3(1.0, 0.96, 0.9) * sunT * (0.35 + phase * 7.0) * mix(0.6, 1.0, powder);
        vec3 lum = sun * 2.2 + ambient * 0.9;
        float extinction = exp(-d * 0.06 * dt);
        light += transmittance * (1.0 - extinction) * lum;
        transmittance *= extinction;
        if (transmittance < 0.02) break;
      }
    }
    float alpha = 1.0 - transmittance;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(light / alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export default class Clouds {
  constructor({ center, sun, size = 1500, base = 145, top = 215 }) {
    const geometry = new THREE.BoxGeometry(size, top - base, size)
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uNoise: { value: perlinWorley() },
        uSun: { value: sun.clone().normalize() },
        uBoxMin: { value: new THREE.Vector3(center.x - size / 2, base, center.z - size / 2) },
        uBoxMax: { value: new THREE.Vector3(center.x + size / 2, top, center.z + size / 2) },
        uTime: { value: 0 },
        uCoverage: { value: 0.78 },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.position.set(center.x, (base + top) / 2, center.z)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10
  }

  update(delta) {
    this.material.uniforms.uTime.value += delta
  }
}
