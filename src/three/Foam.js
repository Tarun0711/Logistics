import * as THREE from 'three'

// Animated foam for a ship under way: streaming fbm noise masked into a bow
// wave / hull wash, a V-shaped Kelvin wake with propeller wash, or a stern
// churn. uv.y runs in the direction the water flows past (bow -> stern ->
// far astern); uSpeed scales both the flow and the amount of white water.

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform vec2 uScale;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + 11.7;
      a *= 0.5;
    }
    return v;
  }

  float mask(vec2 uv) {
  #if defined(WAKE)
    // Kelvin wake: two spreading arms plus turbulent propeller wash
    float x = abs(uv.x - 0.5);
    float spread = 0.05 + 0.42 * uv.y;
    float arms = exp(-pow((x - spread) / (0.025 + 0.06 * uv.y), 2.0)) * pow(1.0 - uv.y, 1.3);
    float wash = exp(-pow(x / (0.04 + 0.16 * uv.y), 2.0)) * pow(1.0 - uv.y, 1.8);
    float edges = smoothstep(0.5, 0.42, x) * smoothstep(0.0, 0.04, uv.y) * smoothstep(1.0, 0.8, uv.y);
    return max(arms, wash * 1.15) * edges;
  #elif defined(CHURN)
    float r = length(uv - 0.5) * 2.0;
    return smoothstep(0.95, 0.2, r);
  #elif defined(BOW)
    // Bow wave: a crest curving round ahead of the stem, white water piled
    // against the bow inside it; uv.x inner -> outer, uv.y ahead -> aft
    float crest = exp(-pow((uv.x - 0.62) / 0.2, 2.0));
    float pile = smoothstep(0.55, 0.0, uv.x);
    float edges = smoothstep(1.0, 0.78, uv.x) * smoothstep(1.0, 0.75, uv.y);
    return max(crest, pile * 0.9) * pow(1.0 - uv.y, 0.6) * edges;
  #else
    // Hull wash: white water hugging the hull, plus the diverging wave
    // crest along the outer edge that spreads away from the bow
    float hug = pow(1.0 - uv.x, 1.3);
    float crest = exp(-pow((uv.x - 0.72) / 0.11, 2.0)) * (0.9 - 0.5 * uv.y);
    // Fade before every edge of the sheet: outer rim, the bow end (where the
    // bow wave takes over) and the stern end
    float edges = smoothstep(1.0, 0.86, uv.x) * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.82, uv.y);
    return max(hug * (0.75 + 0.25 * smoothstep(0.3, 0.0, uv.y)), crest) * edges;
  #endif
  }

  void main() {
    float flow = uTime * (0.25 + uSpeed * 0.9);
    vec2 p = vUv * uScale - vec2(0.0, flow * uScale.y * 0.08);
    float n = fbm(p);
    float bubbles = fbm(p * 3.1 + 7.0);
    // Ragged, noisy outline instead of the mask's smooth falloff
    float m = mask(vUv);
    m = smoothstep(0.08, 0.45, m + (n - 0.5) * 0.35) * m;
    m *= clamp(uSpeed, 0.0, 1.0);
    float foam = smoothstep(0.5 - 0.4 * m, 0.82 - 0.35 * m, n * 0.7 + bubbles * 0.45) * m;
    if (foam < 0.01) discard;
    // Bright white water, faintly blue where it thins out
    vec3 colour = mix(vec3(0.9, 0.95, 0.98), vec3(1.0), smoothstep(0.1, 0.6, foam));
    gl_FragColor = vec4(colour * 1.15, clamp(foam * 1.7, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function foamMaterial(kind, scale = [6, 30]) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    defines: kind === 'wash' ? {} : { [kind.toUpperCase()]: '' },
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 0 },
      uScale: { value: new THREE.Vector2(...scale) },
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
}
