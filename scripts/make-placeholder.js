'use strict';
/**
 * 生成一张零依赖的测试 PNG（深蓝→青色对角渐变 + 网格线），
 * 用作真机演练/占位背景图。用法：
 *   node scripts/make-placeholder.js [输出路径] [宽] [高]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function makePlaceholderPng(width = 1024, height = 640) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB

  // 像素：对角渐变 + 每 64px 网格线
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      let r = Math.round(30 + t * 0);
      let g = Math.round(30 + t * 160);
      let b = Math.round(80 + t * 130);
      if (x % 64 === 0 || y % 64 === 0) {
        r = Math.min(255, r + 60);
        g = Math.min(255, g + 60);
        b = Math.min(255, b + 60);
      }
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { makePlaceholderPng };

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, '..', 'assets', 'placeholder.png');
  const w = Number(process.argv[3]) || 1024;
  const h = Number(process.argv[4]) || 640;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, makePlaceholderPng(w, h));
  console.log(`占位图已生成: ${out} (${w}x${h})`);
}
