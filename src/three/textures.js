import * as THREE from 'three'

// Procedural canvas textures for the shipping containers: weathered paint,
// ELIV branding, door markings, interior wood floor and yard concrete.

export const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const INK = [232, 228, 216]
const INK_CSS = `rgb(${INK.join(',')})`

const createCanvas = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export const toTexture = (canvas, { srgb = true, repeat } = {}) => {
  const texture = new THREE.CanvasTexture(canvas)
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeat, repeat)
  }
  return texture
}

export const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })

function grain(ctx, w, h, rand, amount) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}

function blotches(ctx, w, h, rand, count, light, dark, scale) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w
    const y = rand() * h
    const r = (30 + rand() * 160) * scale
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rand() < 0.45 ? light : dark)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

function rust(ctx, w, h, rand, count, scale) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w
    // Rust gathers toward the bottom edge
    const y = h * Math.pow(rand(), 0.35)
    const r = (0.5 + rand() * 2.4) * scale
    ctx.fillStyle = `rgba(${85 + rand() * 40},${45 + rand() * 20},${25 + rand() * 12},${0.2 + rand() * 0.35})`
    ctx.beginPath()
    ctx.ellipse(x, y, r * (1 + rand()), r, rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()

    if (rand() < 0.25) {
      const len = (20 + rand() * 90) * scale
      const g = ctx.createLinearGradient(0, y, 0, y + len)
      g.addColorStop(0, 'rgba(120,60,25,0.35)')
      g.addColorStop(1, 'rgba(120,60,25,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r * 0.5, y, Math.max(1, r), len)
    }
  }
}

export function paintCanvas(w, h, color, seed = 1, { rustAmount = 1 } = {}) {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed)
  const scale = Math.max(w, h) / 1024
  const area = (w * h) / (1024 * 1024)

  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)

  // Sun-faded mottling
  blotches(ctx, w, h, rand, 260 * area + 40, 'rgba(255,255,255,0.05)', 'rgba(0,10,30,0.08)', scale)

  // Rain streaks
  for (let i = 0; i < 120 * area + 20; i++) {
    const x = rand() * w
    const y = rand() * h * 0.6
    const len = (60 + rand() * 300) * scale
    const g = ctx.createLinearGradient(0, y, 0, y + len)
    g.addColorStop(0, `rgba(70,45,25,${0.04 + rand() * 0.1})`)
    g.addColorStop(1, 'rgba(70,45,25,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, y, (1 + rand() * 4) * scale, len)
  }

  // Grime at the bottom and top edges
  let g = ctx.createLinearGradient(0, h, 0, h * 0.78)
  g.addColorStop(0, 'rgba(60,40,25,0.45)')
  g.addColorStop(1, 'rgba(60,40,25,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  g = ctx.createLinearGradient(0, 0, 0, h * 0.08)
  g.addColorStop(0, 'rgba(50,35,20,0.3)')
  g.addColorStop(1, 'rgba(50,35,20,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  rust(ctx, w, h, rand, (140 * area + 20) * rustAmount, scale)

  // Scratches
  ctx.lineWidth = Math.max(1, scale)
  for (let i = 0; i < 90 * area + 10; i++) {
    const x = rand() * w
    const y = rand() * h
    const a = rand() * Math.PI
    const len = (5 + rand() * 30) * scale
    ctx.strokeStyle = `rgba(190,200,215,${0.08 + rand() * 0.15})`
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }

  grain(ctx, w, h, rand, 14)
  return canvas
}

export function roughnessCanvas(seed = 5) {
  const size = 512
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed)
  ctx.fillStyle = '#8f8f8f'
  ctx.fillRect(0, 0, size, size)
  blotches(ctx, size, size, rand, 120, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.12)', 0.5)
  grain(ctx, size, size, rand, 40)
  return canvas
}

export function woodCanvas(seed = 9) {
  const w = 512
  const h = 1024
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed)
  const planks = 8
  const pw = w / planks

  for (let i = 0; i < planks; i++) {
    let y = -rand() * 400
    while (y < h) {
      const len = 300 + rand() * 500
      const l = 28 + rand() * 12
      ctx.fillStyle = `hsl(${22 + rand() * 10}, ${35 + rand() * 15}%, ${l}%)`
      ctx.fillRect(i * pw, y, pw, len)
      for (let k = 0; k < 14; k++) {
        ctx.strokeStyle = `rgba(40,20,10,${0.08 + rand() * 0.15})`
        ctx.lineWidth = 1 + rand() * 2
        const x = i * pw + rand() * pw
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.bezierCurveTo(x + (rand() - 0.5) * 10, y + len * 0.33, x + (rand() - 0.5) * 10, y + len * 0.66, x, y + len)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(15,8,4,0.8)'
      ctx.fillRect(i * pw, y, pw, 2)
      y += len
    }
    ctx.fillStyle = 'rgba(15,8,4,0.85)'
    ctx.fillRect(i * pw, 0, 2, h)
  }

  blotches(ctx, w, h, rand, 60, 'rgba(255,230,200,0.05)', 'rgba(20,10,5,0.18)', 0.6)
  grain(ctx, w, h, rand, 18)
  return canvas
}

export function concreteCanvas(seed = 21) {
  const size = 1024
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed)
  ctx.fillStyle = '#8d8c88'
  ctx.fillRect(0, 0, size, size)
  blotches(ctx, size, size, rand, 220, 'rgba(255,255,255,0.025)', 'rgba(0,0,0,0.035)', 1)
  // Oil stains
  blotches(ctx, size, size, rand, 10, 'rgba(20,20,20,0.06)', 'rgba(20,20,20,0.1)', 0.5)
  ctx.fillStyle = 'rgba(40,40,40,0.55)'
  for (let i = 0; i <= 4; i++) {
    ctx.fillRect(0, i * (size / 4) - 1, size, 3)
    ctx.fillRect(i * (size / 4) - 1, 0, 3, size)
  }
  grain(ctx, size, size, rand, 26)
  return canvas
}

// Turns the ELIV logo (navy/blue on white) into a painted-stencil alpha mask
// and splits it into emblem, wordmark and tagline so they can be laid out
// on a container side like real fleet branding.
export function processLogo(img) {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const src = createCanvas(w, h)
  const sctx = src.getContext('2d')
  sctx.drawImage(img, 0, 0)
  const data = sctx.getImageData(0, 0, w, h).data

  const alpha = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const dark = 1 - Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) / 255
    alpha[i] = (data[i * 4 + 3] / 255) * THREE.MathUtils.clamp((dark - 0.2) / 0.45, 0, 1)
  }

  const rowHasInk = (y) => {
    let n = 0
    for (let x = 0; x < w; x++) if (alpha[y * w + x] > 0.5) n++
    return n > 2
  }

  const bands = []
  let start = -1
  let end = -1
  let gap = 0
  for (let y = 0; y < h; y++) {
    if (rowHasInk(y)) {
      if (start < 0) start = y
      end = y
      gap = 0
    } else if (start >= 0 && ++gap > 3) {
      if (end - start > 4) bands.push([start, end])
      start = -1
    }
  }
  if (start >= 0 && end - start > 4) bands.push([start, end])

  const crop = ([y0, y1]) => {
    let x0 = w
    let x1 = 0
    for (let y = y0; y <= y1; y++)
      for (let x = 0; x < w; x++)
        if (alpha[y * w + x] > 0.5) {
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x)
        }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  }

  const stencil = (rect, [r, g, b] = INK) => {
    const c = createCanvas(rect.w, rect.h)
    const ctx = c.getContext('2d')
    const out = ctx.createImageData(rect.w, rect.h)
    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++) {
        const o = (y * rect.w + x) * 4
        out.data[o] = r
        out.data[o + 1] = g
        out.data[o + 2] = b
        out.data[o + 3] = alpha[(rect.y + y) * w + rect.x + x] * 255
      }
    ctx.putImageData(out, 0, 0)
    return c
  }

  const full = bands.length ? crop([bands[0][0], bands[bands.length - 1][1]]) : { x: 0, y: 0, w, h }
  const parts =
    bands.length >= 3 ? { emblem: crop(bands[0]), word: crop(bands[1]), tagline: crop(bands[bands.length - 1]) } : null

  return { img, full, parts, stencil }
}

// Worn-paint chips knocked out of a stencil layer
function chip(ctx, rand, x, y, w, h, count) {
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.4 + rand() * 0.6})`
    ctx.beginPath()
    ctx.ellipse(x + rand() * w, y + rand() * h, 1 + rand() * 3, 1 + rand() * 2, rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < count / 40; i++) {
    const cx = x + rand() * w
    const cy = y + rand() * h
    const r = 8 + rand() * 30
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, 'rgba(0,0,0,0.3)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  ctx.globalCompositeOperation = 'source-over'
}

function condensed(ctx, text, x, y, size, squeeze = 0.82) {
  ctx.save()
  ctx.font = `bold ${size}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`
  ctx.translate(x, y)
  ctx.scale(squeeze, 1)
  ctx.fillText(text, 0, 0)
  const width = ctx.measureText(text).width * squeeze
  ctx.restore()
  return width
}

export const OWNER_CODE = 'ELVU'
export const SERIAL = '836481'
export const CHECK_DIGIT = '8'
export const TYPE_CODE = '22G1'

export function sideCanvas(logo, color, seed) {
  const W = 2048
  const H = 842
  const canvas = paintCanvas(W, H, color, seed)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed + 7)

  const layer = createCanvas(W, H)
  const l = layer.getContext('2d')
  let box
  let drawTagline = () => {}

  if (logo.parts) {
    const { emblem, word, tagline } = logo.parts
    let eh = 420
    const layout = () => {
      const ew = (eh * emblem.w) / emblem.h
      const gap = eh * 0.1
      const wordAspect = word.w / word.h
      const tagRatio = tagline.h / tagline.w
      const wh = (eh - gap) / (1 + wordAspect * tagRatio)
      const ww = wh * wordAspect
      const space = eh * 0.28
      return { ew, gap, wh, ww, th: ww * tagRatio, space, total: ew + space + ww }
    }
    let p = layout()
    if (p.total > W * 0.8) {
      eh *= (W * 0.8) / p.total
      p = layout()
    }
    const x = W * 0.56 - p.total / 2
    const y = H * 0.5 - eh / 2
    l.drawImage(logo.stencil(emblem), x, y, p.ew, eh)
    l.drawImage(logo.stencil(word), x + p.ew + p.space, y, p.ww, p.wh)
    box = [x, y, p.total, eh]
    // Thin tagline goes on after the wear pass so it stays legible
    drawTagline = () => l.drawImage(logo.stencil(tagline), x + p.ew + p.space, y + p.wh + p.gap, p.ww, p.th)
  } else {
    const h = H * 0.6
    const w = (h * logo.full.w) / logo.full.h
    l.drawImage(logo.stencil(logo.full), W * 0.56 - w / 2, H * 0.2, w, h)
    box = [W * 0.56 - w / 2, H * 0.2, w, h]
  }

  // Vertical ISO marking columns
  l.fillStyle = INK_CSS
  l.textAlign = 'center'
  l.font = 'bold 34px Arial, sans-serif'
  const column = (str, x, y0) => [...str].forEach((ch, i) => l.fillText(ch, x, y0 + i * 40))
  column(OWNER_CODE + SERIAL, 150, 180)
  l.fillText(CHECK_DIGIT, 150, 180 + 10 * 40 + 6)
  l.strokeStyle = INK_CSS
  l.lineWidth = 3
  l.strokeRect(132, 180 + 10 * 40 - 26, 36, 42)
  column(TYPE_CODE, 230, 180)

  chip(l, rand, box[0], box[1], box[2], box[3], 700)
  chip(l, rand, 120, 150, 140, 480, 80)
  drawTagline()

  ctx.globalAlpha = 0.93
  ctx.drawImage(layer, 0, 0)
  ctx.globalAlpha = 1
  rust(ctx, W, H, rand, 30, 2)
  return canvas
}

export function doorCanvas(logo, color, seed, side) {
  const W = 512
  const H = 1024
  const canvas = paintCanvas(W, H, color, seed)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed + 3)
  const layer = createCanvas(W, H)
  const l = layer.getContext('2d')
  l.fillStyle = INK_CSS

  if (side === 'right') {
    // Container number + size/type code in the top panel
    let x = 60
    x += condensed(l, `${OWNER_CODE} ${SERIAL}`, x, 72, 50) + 12
    condensed(l, CHECK_DIGIT, x + 6, 72, 50)
    l.strokeStyle = INK_CSS
    l.lineWidth = 3
    l.strokeRect(x, 30, 34, 52)
    condensed(l, TYPE_CODE, 250, 132, 46)

    // Weight panel
    const rows = [
      ['MAX.GR.', '30,480 KG', '67,200 LB'],
      ['TARE', '2,150 KG', '4,740 LB'],
      ['NET', '28,330 KG', '62,460 LB'],
      ['CU.CAP.', '33.2 CU.M.', '1,172 CU.FT.'],
    ]
    rows.forEach(([label, a, b], i) => {
      const y = 292 + i * 32
      condensed(l, label, 140, y, 28)
      condensed(l, a, 320, y - 13, 13, 0.9)
      condensed(l, b, 320, y, 13, 0.9)
    })
    chip(l, rand, 40, 20, 440, 400, 260)
  } else {
    // Brand badge in the original logo colours
    const e = logo.parts?.emblem ?? logo.full
    ctx.fillStyle = '#f1f1ec'
    ctx.fillRect(58, 40, 84, 84)
    const s = Math.min(68 / e.w, 68 / e.h)
    ctx.drawImage(logo.img, e.x, e.y, e.w, e.h, 100 - (e.w * s) / 2, 82 - (e.h * s) / 2, e.w * s, e.h * s)

    // CSC safety approval plate
    ctx.fillStyle = '#c8c8c1'
    ctx.fillRect(40, 252, 112, 136)
    ctx.strokeStyle = '#7c7c76'
    ctx.lineWidth = 2
    ctx.strokeRect(42, 254, 108, 132)
    ctx.fillStyle = '#4a4a46'
    ctx.font = 'bold 9px Arial, sans-serif'
    ctx.fillText('CSC SAFETY APPROVAL', 48, 268)
    for (let i = 0; i < 12; i++) ctx.fillRect(48, 278 + i * 8, 40 + rand() * 50, 2)

    // Yellow attention label
    ctx.beginPath()
    ctx.moveTo(280, 262)
    ctx.lineTo(350, 262)
    ctx.lineTo(315, 324)
    ctx.closePath()
    ctx.fillStyle = '#f0c419'
    ctx.fill()
    ctx.strokeStyle = '#3a3010'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#2a2a10'
    ctx.font = 'bold 8px Arial, sans-serif'
    ctx.fillText('ATTENTION', 294, 276)
    ctx.fillRect(302, 282, 26, 2)
    ctx.fillRect(306, 288, 18, 2)
  }

  ctx.globalAlpha = 0.93
  ctx.drawImage(layer, 0, 0)
  ctx.globalAlpha = 1
  rust(ctx, W, H, rand, 15, 1)
  return canvas
}

export function asphaltCanvas(seed = 31) {
  const size = 1024
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed)
  ctx.fillStyle = '#4b4c4e'
  ctx.fillRect(0, 0, size, size)
  blotches(ctx, size, size, rand, 160, 'rgba(255,255,255,0.03)', 'rgba(0,0,0,0.06)', 1)
  // Aggregate
  for (let i = 0; i < 26000; i++) {
    const l = 40 + rand() * 70
    ctx.fillStyle = `rgba(${l},${l},${l + 3},${0.3 + rand() * 0.5})`
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2)
  }
  // Tar-sealed cracks
  ctx.strokeStyle = 'rgba(20,20,22,0.5)'
  for (let i = 0; i < 6; i++) {
    let x = rand() * size
    let y = rand() * size
    ctx.lineWidth = 1 + rand() * 2
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let k = 0; k < 12; k++) ctx.lineTo((x += (rand() - 0.5) * 60), (y += (rand() - 0.5) * 60))
    ctx.stroke()
  }
  grain(ctx, size, size, rand, 22)
  return canvas
}

export function cardboardCanvas(logo, seed = 51) {
  const size = 512
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed)
  ctx.fillStyle = '#b48a58'
  ctx.fillRect(0, 0, size, size)
  // Fibres
  for (let i = 0; i < 1600; i++) {
    ctx.strokeStyle = `rgba(${rand() < 0.5 ? '90,60,30' : '220,190,150'},${0.05 + rand() * 0.08})`
    const x = rand() * size
    const y = rand() * size
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rand() - 0.5) * 20, y + (rand() - 0.5) * 4)
    ctx.stroke()
  }
  blotches(ctx, size, size, rand, 30, 'rgba(255,230,190,0.06)', 'rgba(80,50,20,0.08)', 0.4)
  // Packing tape
  ctx.fillStyle = 'rgba(205,170,110,0.75)'
  ctx.fillRect(size * 0.42, 0, size * 0.16, size)
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(size * 0.44, 0, size * 0.03, size)
  // Shipping label
  ctx.fillStyle = '#f4f3ee'
  ctx.fillRect(size * 0.08, size * 0.12, size * 0.3, size * 0.36)
  const e = logo.parts?.emblem ?? logo.full
  const s = Math.min((size * 0.22) / e.w, (size * 0.1) / e.h)
  ctx.drawImage(logo.img, e.x, e.y, e.w, e.h, size * 0.12, size * 0.15, e.w * s, e.h * s)
  ctx.fillStyle = '#222'
  ctx.font = 'bold 15px Arial, sans-serif'
  ctx.fillText('ELIV LOGISTICS', size * 0.1, size * 0.31)
  for (let i = 0; i < 26; i++) ctx.fillRect(size * 0.1 + i * 5, size * 0.34, 1 + (rand() * 3) | 0, size * 0.1)
  grain(ctx, size, size, rand, 12)
  return canvas
}

export function shutterCanvas(seed = 61) {
  const w = 256
  const h = 512
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed)
  for (let y = 0; y < h; y += 16) {
    const g = ctx.createLinearGradient(0, y, 0, y + 16)
    g.addColorStop(0, '#d9dcde')
    g.addColorStop(0.6, '#b9bdc0')
    g.addColorStop(1, '#7d8184')
    ctx.fillStyle = g
    ctx.fillRect(0, y, w, 16)
  }
  ctx.fillStyle = '#2d2f31'
  ctx.fillRect(0, h - 18, w, 18)
  blotches(ctx, w, h, rand, 30, 'rgba(255,255,255,0.04)', 'rgba(40,30,20,0.08)', 0.3)
  grain(ctx, w, h, rand, 10)
  return canvas
}

export function windowsCanvas(seed = 71) {
  const w = 1024
  const h = 256
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const rand = rng(seed)
  ctx.fillStyle = '#d3d6d8'
  ctx.fillRect(0, 0, w, h)
  for (let row = 0; row < 2; row++)
    for (let x = 16; x < w - 60; x += 72) {
      const y = 24 + row * 120
      const g = ctx.createLinearGradient(x, y, x + 60, y + 84)
      g.addColorStop(0, '#5b7a96')
      g.addColorStop(0.5, '#2c4256')
      g.addColorStop(1, '#6f8ca4')
      ctx.fillStyle = g
      ctx.fillRect(x, y, 60, 84)
      ctx.fillStyle = `rgba(255,255,255,${0.05 + rand() * 0.1})`
      ctx.fillRect(x + 6, y + 4, 10, 76)
    }
  grain(ctx, w, h, rand, 8)
  return canvas
}

export function signCanvas(logo) {
  const w = 1024
  const h = 384
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  const f = logo.full
  const s = Math.min((w * 0.9) / f.w, (h * 0.86) / f.h)
  ctx.drawImage(logo.img, f.x, f.y, f.w, f.h, (w - f.w * s) / 2, (h - f.h * s) / 2, f.w * s, f.h * s)
  return canvas
}

export function trailerCanvas(logo, seed = 81) {
  const w = 2048
  const h = 512
  const canvas = paintCanvas(w, h, '#eef0f1', seed, { rustAmount: 0.15 })
  const ctx = canvas.getContext('2d')
  const f = logo.full
  const s = (h * 0.7) / f.h
  ctx.drawImage(logo.img, f.x, f.y, f.w, f.h, w * 0.5 - (f.w * s) / 2, h * 0.15, f.w * s, f.h * s)
  ctx.fillStyle = '#1e5fd0'
  ctx.fillRect(0, h * 0.9, w, h * 0.04)
  return canvas
}

export function chainLinkCanvas() {
  const size = 128
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.strokeStyle = 'rgba(170,175,178,1)'
  ctx.lineWidth = 3
  for (let i = -size; i < size * 2; i += 16) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + size, size)
    ctx.moveTo(i, size)
    ctx.lineTo(i + size, 0)
    ctx.stroke()
  }
  return canvas
}
