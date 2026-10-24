// 生成应用图标：
//   assets/icon.png（512×512）应用/任务栏/安装包图标：蓝→紫渐变圆角块 + 白色时钟表盘（10:10）
//   assets/tray.png（32×32）  托盘/通知专用：粗笔画小时钟，16px 显示下依然清晰
// 纯 Node 实现，无图像库依赖：SDF 绘制 + zlib PNG 编码
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---- SDF 基元 ----
const sdRoundRect = (px, py, cx, cy, hw, hh, r) => {
  const dx = Math.abs(px - cx) - (hw - r)
  const dy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r
}
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r
/** 环形：内圆 r-t / 外圆 r+t 的中轴距离（t = 半厚度） */
const sdRing = (px, py, cx, cy, r, t) => Math.abs(sdCircle(px, py, cx, cy, r)) - t
/** 指针：绕表心旋转 -ang 后按竖直圆角条评估（以 12 点方向为 0° 顺时针），off = 起点距表心间隙 */
const sdHand = (px, py, cx, cy, ang, len, w, off) => {
  const rad = -ang
  const dx = px - cx
  const dy = py - cy
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad)
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad)
  return sdRoundRect(rx, -ry, 0, -len / 2 - off, w, len, w)
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))
/** 抗锯齿覆盖：d<0 内部 1，d>0 外部 0，边缘 1px 过渡 */
const cov = (d) => clamp01(0.5 - d)
const mix = (a, b, t) => a + (b - a) * t
const over = (dst, src) => {
  const a = src[3] + dst[3] * (1 - src[3])
  if (a === 0) return [0, 0, 0, 0]
  return [
    (src[0] * src[3] + dst[0] * dst[3] * (1 - src[3])) / a,
    (src[1] * src[3] + dst[1] * dst[3] * (1 - src[3])) / a,
    (src[2] * src[3] + dst[2] * dst[3] * (1 - src[3])) / a,
    a,
  ]
}
const solid = (c, alpha) => [c[0], c[1], c[2], alpha]

// 应用主色：蓝 → 紫（与界面 --accent / --purple 一致）
const GRAD1 = [0x3d, 0x8b, 0xe9]
const GRAD2 = [0x8e, 0x6c, 0xf0]
const WHITE = [0xff, 0xff, 0xff]

// ---- PNG 编码 ----
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePNG(px, SIZE) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0
    Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- 512×512 主图标：渐变圆角块 + 表盘环 + 10:10 指针 + 表冠/侧钮 ----
function drawIcon512() {
  const SIZE = 512
  const CLOCK = { x: 256, y: 256, r: 132 }
  const px = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let out = [0, 0, 0, 0]
      const t = (x + y) / (SIZE * 2)
      const bg = cov(sdRoundRect(x, y, 256, 256, 244, 244, 116))
      if (bg > 0) {
        out = over(out, solid([mix(GRAD1[0], GRAD2[0], t), mix(GRAD1[1], GRAD2[1], t), mix(GRAD1[2], GRAD2[2], t)], bg))
      }
      const ring = cov(sdRing(x, y, CLOCK.x, CLOCK.y, CLOCK.r, 13))
      if (ring > 0) out = over(out, solid(WHITE, ring))
      const hour = cov(sdHand(x, y, CLOCK.x, CLOCK.y, 305, 66, 9.5, 8))
      if (hour > 0) out = over(out, solid(WHITE, hour))
      const minute = cov(sdHand(x, y, CLOCK.x, CLOCK.y, 60, 100, 9.5, 8))
      if (minute > 0) out = over(out, solid(WHITE, minute))
      const dot = cov(sdCircle(x, y, CLOCK.x, CLOCK.y, 14))
      if (dot > 0) out = over(out, solid(WHITE, dot))
      const i = (y * SIZE + x) * 4
      px[i] = Math.round(out[0])
      px[i + 1] = Math.round(out[1])
      px[i + 2] = Math.round(out[2])
      px[i + 3] = Math.round(out[3] * 255)
    }
  }
  return encodePNG(px, SIZE)
}

// ---- 32×32 托盘图标：同样式简化版，粗环粗指针保证 16px 下可读 ----
function drawTray32() {
  const SIZE = 32
  const C = { x: 16, y: 16.5, r: 9.6 }
  const px = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let out = [0, 0, 0, 0]
      const t = (x + y) / (SIZE * 2)
      const bg = cov(sdRoundRect(x, y, 16, 16, 15.6, 15.6, 8))
      if (bg > 0) {
        out = over(out, solid([mix(GRAD1[0], GRAD2[0], t), mix(GRAD1[1], GRAD2[1], t), mix(GRAD1[2], GRAD2[2], t)], bg))
      }
      const ring = cov(sdRing(x, y, C.x, C.y, C.r, 1.7))
      if (ring > 0) out = over(out, solid(WHITE, ring))
      const hour = cov(sdHand(x, y, C.x, C.y, 300, 5, 1.35, 0.6))
      if (hour > 0) out = over(out, solid(WHITE, hour))
      const minute = cov(sdHand(x, y, C.x, C.y, 55, 7.2, 1.35, 0.6))
      if (minute > 0) out = over(out, solid(WHITE, minute))
      const dot = cov(sdCircle(x, y, C.x, C.y, 1.6))
      if (dot > 0) out = over(out, solid(WHITE, dot))
      const i = (y * SIZE + x) * 4
      px[i] = Math.round(out[0])
      px[i + 1] = Math.round(out[1])
      px[i + 2] = Math.round(out[2])
      px[i + 3] = Math.round(out[3] * 255)
    }
  }
  return encodePNG(px, SIZE)
}

mkdirSync(path.join(root, 'assets'), { recursive: true })
const icon = drawIcon512()
writeFileSync(path.join(root, 'assets', 'icon.png'), icon)
console.log(`assets/icon.png 已生成 (${icon.length} 字节)`)
const tray = drawTray32()
writeFileSync(path.join(root, 'assets', 'tray.png'), tray)
console.log(`assets/tray.png 已生成 (${tray.length} 字节)`)
