'use strict';

// 零依赖 PNG 编码器 + 默认图标生成（在 CI 中于打包前生成 build/icon.png 与 assets/icon.png）
// 这样仓库无需提交二进制图标，规避文本型 API 无法上传二进制文件的问题。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const table = crcTable();
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { r: 45, g: 91, b: 255 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}
function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function generateDefaultIcon(accentColor) {
  const size = 512;
  const base = hexToRgb(accentColor);
  const rgba = Buffer.alloc(size * size * 4);
  const radius = 96;
  const inset = 26;
  const left = inset, top = inset, right = size - inset, bottom = size - inset;
  const winL = 132, winR = 380, winT = 152, winB = 360, barH = 40, winRadius = 16;
  const insideRounded = (x, y, l, t, r, b, rad) => {
    if (x < l || x > r || y < t || y > b) return false;
    const cx = Math.min(Math.max(x, l + rad), r - rad);
    const cy = Math.min(Math.max(y, t + rad), b - rad);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= rad * rad;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!insideRounded(x, y, left, top, right, bottom, radius)) {
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
        continue;
      }
      const t = (y - top) / (bottom - top);
      let r = mix(base.r, Math.round(base.r * 0.62), t);
      let g = mix(base.g, Math.round(base.g * 0.62), t);
      let b = mix(base.b, Math.round(base.b * 0.62), t);
      if (insideRounded(x, y, winL, winT, winR, winB, winRadius)) {
        if (y < winT + barH) {
          r = 226; g = 232; b = 240;
          const dots = [winL + 26, winL + 54, winL + 82];
          for (const dx of dots) {
            const ddx = x - dx, ddy = y - (winT + barH / 2);
            if (ddx * ddx + ddy * ddy <= 36) { r = 120; g = 130; b = 145; }
          }
        } else {
          r = 255; g = 255; b = 255;
          const lines = [
            { y0: winT + 74, y1: winT + 90, x0: winL + 26, x1: winR - 60 },
            { y0: winT + 112, y1: winT + 128, x0: winL + 26, x1: winR - 26 },
            { y0: winT + 150, y1: winT + 166, x0: winL + 26, x1: winR - 100 }
          ];
          for (const ln of lines) {
            if (y >= ln.y0 && y <= ln.y1 && x >= ln.x0 && x <= ln.x1) {
              r = mix(base.r, 255, 0.55);
              g = mix(base.g, 255, 0.55);
              b = mix(base.b, 255, 0.55);
            }
          }
        }
      }
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

const png = generateDefaultIcon('#2d5bff');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'build', 'icon.png'), png);
fs.writeFileSync(path.join(__dirname, 'assets', 'icon.png'), png);
console.log('icon generated: build/icon.png, assets/icon.png');
