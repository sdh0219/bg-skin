'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const TMP = path.join(__dirname, '.tmp-max');
const FADE = 0.55;

// 与 assemble-max 相同顺序
const ids = [
  'c01_s01_default', 'c02_s02_menu', 'c03_s03a_opacity', 'c04_s03b_opacity',
  'c05_s03c_opacity', 'c06_s03d_opacity', 'c07_s04_compare', 'c08_s05_city',
  'c09_s06_gallery', 'c10_s12_settings', 'c11_s13_palette', 'c12_s07_trust',
  'c13_s08_github', 'c14_s09_releases', 'c15_s10_vsix', 'c16_s11_done',
  'c17_s11_done_r', 'c18_s14_outro', 'c19_s14_outro_r', 'c20_s14_outro_r',
];
function dur(f) {
  return parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).stdout.trim());
}
const clips = ids.map((id) => path.join(TMP, `${id}.mp4`));
for (const c of clips) {
  if (!fs.existsSync(c)) { console.error('missing', c); process.exit(1); }
}
const durs = clips.map(dur);
console.log('durs', durs.map((d) => d.toFixed(2)).join(' '));
const args = clips.flatMap((c) => ['-i', c]);
const filters = [];
let offset = durs[0] - FADE;
let prev = '[0:v]';
for (let i = 1; i < clips.length; i++) {
  const out = i === clips.length - 1 ? '[vout]' : `[v${i}]`;
  const tr = i >= 10 ? 'slideleft' : 'fade';
  filters.push(`${prev}[${i}:v]xfade=transition=${tr}:duration=${FADE}:offset=${offset.toFixed(3)}${out}`);
  prev = out;
  offset += durs[i] - FADE;
}
const videoOnly = path.join(TMP, 'video_only.mp4');
try { fs.unlinkSync(videoOnly); } catch (_) {}
const r = spawnSync('ffmpeg', [
  '-y', ...args,
  '-filter_complex', filters.join(';'),
  '-map', '[vout]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '60',
  videoOnly,
], { stdio: 'inherit', cwd: __dirname });
if (r.status !== 0) process.exit(r.status || 1);
console.log('video_only', dur(videoOnly));
