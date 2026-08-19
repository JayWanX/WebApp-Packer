'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* ---------------- 极简 PNG 编码器（零依赖） ---------------- */

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
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

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

/* ---------------- 默认图标绘制 ---------------- */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { r: 45, g: 91, b: 255 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/**
 * 生成 512x512 默认应用图标：圆角底 + 简化的窗口图形。
 * 纯像素运算，不依赖任何图形库。
 */
function generateDefaultIcon(accentColor) {
  const size = 512;
  const base = hexToRgb(accentColor);
  const rgba = Buffer.alloc(size * size * 4);

  const radius = 96;
  const inset = 26;
  const left = inset;
  const top = inset;
  const right = size - inset;
  const bottom = size - inset;

  // 窗口图形几何
  const winL = 132;
  const winR = 380;
  const winT = 152;
  const winB = 360;
  const barH = 40;
  const winRadius = 16;

  const insideRounded = (x, y, l, t, r, b, rad) => {
    if (x < l || x > r || y < t || y > b) return false;
    const cx = Math.min(Math.max(x, l + rad), r - rad);
    const cy = Math.min(Math.max(y, t + rad), b - rad);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= rad * rad;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      if (!insideRounded(x, y, left, top, right, bottom, radius)) {
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
        continue;
      }

      // 底色：自上而下轻微加深，避免纯平呆板
      const t = (y - top) / (bottom - top);
      let r = mix(base.r, Math.round(base.r * 0.62), t);
      let g = mix(base.g, Math.round(base.g * 0.62), t);
      let b = mix(base.b, Math.round(base.b * 0.62), t);

      if (insideRounded(x, y, winL, winT, winR, winB, winRadius)) {
        if (y < winT + barH) {
          // 标题栏
          r = 226; g = 232; b = 240;
          // 三个圆点
          const dots = [winL + 26, winL + 54, winL + 82];
          for (const dx of dots) {
            const ddx = x - dx;
            const ddy = y - (winT + barH / 2);
            if (ddx * ddx + ddy * ddy <= 36) {
              r = 120; g = 130; b = 145;
            }
          }
        } else {
          // 内容区
          r = 255; g = 255; b = 255;
          // 三条内容线
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

      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }

  return encodePng(size, size, rgba);
}

/* ---------------- PNG 尺寸探测 ---------------- */

function pngSize(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch (err) {
    return null;
  }
}

/**
 * 准备图标资源。
 * - build/icon.png|ico  → 供 electron-builder 生成各平台图标
 * - assets/icon.png     → 运行时托盘与窗口图标（打进 asar）
 */
function prepareIcon(iconPath, workDir, accentColor, log) {
  const buildDir = path.join(workDir, 'build');
  const assetsDir = path.join(workDir, 'assets');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const fallback = () => {
    const png = generateDefaultIcon(accentColor);
    fs.writeFileSync(path.join(buildDir, 'icon.png'), png);
    fs.writeFileSync(path.join(assetsDir, 'icon.png'), png);
    return { type: 'generated', file: path.join(buildDir, 'icon.png') };
  };

  if (!iconPath) {
    log('未指定图标，已生成默认图标 512x512');
    return fallback();
  }

  if (!fs.existsSync(iconPath)) {
    log(`图标文件不存在，改用默认图标：${iconPath}`);
    return fallback();
  }

  const ext = path.extname(iconPath).toLowerCase();

  if (ext === '.png') {
    const size = pngSize(iconPath);
    if (!size) {
      log('图标不是有效的 PNG，改用默认图标');
      return fallback();
    }
    if (size.width < 256 || size.height < 256) {
      log(`图标尺寸 ${size.width}x${size.height} 小于 256x256，无法生成 Windows/macOS 图标，改用默认图标`);
      return fallback();
    }
    if (size.width !== size.height) {
      log(`图标非正方形（${size.width}x${size.height}），各平台可能出现裁切`);
    }
    fs.copyFileSync(iconPath, path.join(buildDir, 'icon.png'));
    fs.copyFileSync(iconPath, path.join(assetsDir, 'icon.png'));
    log(`已应用 PNG 图标 ${size.width}x${size.height}`);
    return { type: 'png', file: path.join(buildDir, 'icon.png') };
  }

  if (ext === '.ico') {
    fs.copyFileSync(iconPath, path.join(buildDir, 'icon.ico'));
    fs.copyFileSync(iconPath, path.join(assetsDir, 'icon.ico'));
    // macOS / Linux 仍需 png，用默认图标兜底
    const png = generateDefaultIcon(accentColor);
    fs.writeFileSync(path.join(buildDir, 'icon.png'), png);
    fs.writeFileSync(path.join(assetsDir, 'icon.png'), png);
    log('已应用 ICO 图标（Windows）；macOS / Linux 使用生成的 PNG 兜底，建议改用 512x512 PNG');
    return { type: 'ico', file: path.join(buildDir, 'icon.ico') };
  }

  log(`不支持的图标格式 ${ext}（仅支持 .png / .ico），改用默认图标`);
  return fallback();
}

module.exports = { prepareIcon, generateDefaultIcon, encodePng, pngSize };
