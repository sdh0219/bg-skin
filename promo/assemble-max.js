'use strict';
/**
 * 最高规格重渲：原速克隆长句、分镜拉满、60fps、连贯混音、烧字幕
 * 画面：1920x1080 @60fps | 音频：自然语速 + 淡入淡出 + 限幅
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const FRAMES = path.join(ROOT, 'assets', 'frames3');
const CLONE = path.join(ROOT, 'assets', 'voice-clone');
const OUT = path.join(ROOT, 'out');
const TMP = path.join(ROOT, '.tmp-max');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const FPS = 60;
const FADE = 0.55;

function dur(f) {
  return parseFloat(
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).stdout.trim()
  );
}
function run(args, label) {
  console.log('===', label, '===');
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) {
    console.error('FAIL', label, r.status);
    process.exit(r.status || 1);
  }
}
function fmt(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor((ms % 3600000) / 60000), 2)}:${p(Math.floor((ms % 60000) / 1000), 2)},${p(ms % 1000, 3)}`;
}

// 完整长句 + 原速；lead/tail 给足，避免抢话
const SCENES = [
  { id: 's01_default', vo: 'vo1.wav', lead: 0.55, tail: 0.7, text: '程序员的 VS Code，凭什么只能一片死黑啊？' },
  { id: 's02_menu', vo: 'vo2.wav', lead: 0.45, tail: 0.7, text: '今天教你，给编辑器换上超好看的自己的壁纸～' },
  { id: 's03a_opacity', hold: 2.2, text: '先从很淡开始…' },
  { id: 's03b_opacity', vo: 'vo3.wav', lead: 0.4, tail: 0.65, text: '像这样，代码底下轻轻透出来，是不是超有氛围感？' },
  { id: 's03c_opacity', hold: 2.0, text: '再调高一点点' },
  { id: 's03d_opacity', hold: 2.4, text: '找到你喜欢的浓度' },
  { id: 's04_compare', vo: 'vo4.wav', lead: 0.4, tail: 0.7, text: '透明度、模糊、位置，全部都可以自己调喔。' },
  { id: 's05_city', vo: 'vo5.wav', lead: 0.4, tail: 0.65, text: '多张图还能随机轮换，每天打开都有新鲜感啦。' },
  { id: 's06_gallery', vo: 'vo6.wav', lead: 0.45, tail: 0.7, text: '升级会自动修复，卸载还能一键还原，超安心的。' },
  { id: 's12_settings', hold: 4.5, text: '配置写在 settings.json，改完重载即可' },
  { id: 's13_palette', hold: 4.0, text: 'Ctrl+Shift+P 输入 bg-skin，全部功能都在这' },
  { id: 's07_trust', vo: 'vo7.wav', lead: 0.5, tail: 0.65, text: '好！重点来了，手把手教你安装，认真听喔。' },
  { id: 's08_github', vo: 'vo8.wav', lead: 0.4, tail: 0.7, text: '第一步，打开浏览器，搜 GitHub bg-skin。' },
  { id: 's09_releases', vo: 'vo9.wav', lead: 0.4, tail: 0.7, text: '第二步，进 Releases，下载那个 vsix 安装包。' },
  { id: 's10_vsix', vo: 'vo10.wav', lead: 0.4, tail: 0.7, text: '第三步，VS Code 扩展面板，选从 VSIX 安装。' },
  { id: 's11_done', vo: 'vo11.wav', lead: 0.4, tail: 0.7, text: '第四步，选一张你喜欢的图，重载窗口就好啦。' },
  { id: 's11_done', vo: 'vo12.wav', lead: 0.4, tail: 0.7, reuse: true, text: '看！壁纸是不是出现啦？写代码心情都变好了耶。' },
  { id: 's14_outro', vo: 'vo13.wav', lead: 0.5, tail: 0.65, text: '觉得有用的话，拜托去 GitHub 帮我点个 Star 好不好？' },
  { id: 's14_outro', vo: 'vo14.wav', lead: 0.4, tail: 0.65, reuse: true, text: '开源免费，不流氓不锁死，真的超推。' },
  { id: 's14_outro', vo: 'vo15.wav', lead: 0.4, tail: 3.2, reuse: true, text: '现在就去试试吧，我们下次见，拜拜～' },
];

// 平滑处理克隆音（原速，仅淡入淡出+限幅）
const pacedMap = new Map();
SCENES.forEach((s) => {
  if (!s.vo) return;
  const src = path.join(CLONE, s.vo);
  const dst = path.join(CLONE, `final_${s.vo}`);
  const td = dur(src);
  run(
    [
      '-y', '-i', src,
      '-filter:a',
      `aresample=48000,aformat=channel_layouts=mono,afade=t=in:st=0:d=0.05,afade=t=out:st=${Math.max(0, td - 0.1).toFixed(3)}:d=0.1,alimiter=limit=0.95:level=false,volume=1.05`,
      dst,
    ],
    `smooth ${s.vo} ${td.toFixed(2)}s`
  );
  pacedMap.set(s.vo, { path: dst, dur: dur(dst) });
});

// 时间轴：分镜总长 = lead + 旁白原速 + tail（或 hold）
const timeline = SCENES.map((s, i) => {
  const png = path.join(FRAMES, `${s.id}.png`);
  let total, voPath = null, vd = 0;
  if (s.vo) {
    const p = pacedMap.get(s.vo);
    voPath = p.path;
    vd = p.dur;
    total = Number(((s.lead || 0) + vd + (s.tail || 0)).toFixed(3));
  } else {
    total = Number((s.hold || 3).toFixed(3));
  }
  return { ...s, png, voPath, vd, total, clip: `c${String(i + 1).padStart(2, '0')}_${s.id}${s.reuse ? '_r' : ''}` };
});

function sceneStart(i) {
  if (i === 0) return 0;
  let t = 0;
  for (let j = 0; j < i; j++) t += timeline[j].total - FADE;
  return t;
}
const outDur = Number(timeline.reduce((a, s, i) => a + s.total - (i > 0 ? FADE : 0), 0).toFixed(3));
console.log('clips', timeline.length, 'sum', timeline.reduce((a, b) => a + b.total, 0).toFixed(2), '=> outDur', outDur);

// 编码分镜 60fps
const clips = [];
timeline.forEach((s, idx) => {
  const clip = path.join(TMP, `${s.clip}.mp4`);
  const frames = Math.round(s.total * FPS);
  const zrate = (0.00022 + (idx % 4) * 0.00005).toFixed(5);
  const filter = [
    `scale=1920:1080:flags=lanczos`,
    `zoompan=z='min(1.0+${zrate}*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${FPS}`,
    `eq=contrast=1.04:saturation=1.07`,
    `fade=t=in:st=0:d=0.28`,
    `fade=t=out:st=${(s.total - 0.28).toFixed(3)}:d=0.28`,
  ].join(',');
  run(
    [
      '-y', '-loop', '1', '-i', s.png, '-t', String(s.total),
      '-filter_complex', filter, '-r', String(FPS),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
      clip,
    ],
    `clip ${s.clip} ${s.total}s`
  );
  clips.push(clip);
});

// xfade
{
  const args = clips.flatMap((c) => ['-i', c]);
  const filters = [];
  let offset = timeline[0].total - FADE;
  let prev = '[0:v]';
  for (let i = 1; i < clips.length; i++) {
    const out = i === clips.length - 1 ? '[vout]' : `[v${i}]`;
    const tr = i >= 11 ? 'slideleft' : 'fade';
    filters.push(`${prev}[${i}:v]xfade=transition=${tr}:duration=${FADE}:offset=${offset.toFixed(3)}${out}`);
    prev = out;
    offset += timeline[i].total - FADE;
  }
  const videoOnly = path.join(TMP, 'video_only.mp4');
  run(
    [
      '-y', ...args,
      '-filter_complex', filters.join(';'),
      '-map', '[vout]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      videoOnly,
    ],
    'xfade'
  );
}

// BGM
const bgmPy = path.join(CLONE, 'make_bgm_max.py');
const bgmWav = path.join(CLONE, 'bgm_max.wav');
fs.writeFileSync(
  bgmPy,
  `
import numpy as np, wave
sr = 44100
duration = ${outDur + 1.2}
n = int(sr * duration)

def note(freq, start, length, amp=0.05):
    seg = np.zeros(n)
    i0 = int(start * sr); i1 = min(n, i0 + int(length * sr))
    if i0 >= n: return seg
    tt = np.arange(i1 - i0) / sr
    env = np.minimum(tt * 8, 1) * np.exp(-tt * 0.9)
    w = np.sin(2*np.pi*freq*tt)*0.58 + np.sin(2*np.pi*freq*2*tt)*0.2 + np.sin(2*np.pi*freq*0.5*tt)*0.28
    seg[i0:i1] = w * env * amp
    return seg

pad = np.zeros(n)
prog = [(0,[220,261.63,329.63]),(10,[174.61,220,261.63]),(20,[196,246.94,293.66]),
        (30,[164.81,196,246.94]),(40,[220,261.63,329.63]),(50,[174.61,220,261.63]),
        (60,[196,246.94,293.66]),(70,[220,261.63,329.63]),(80,[164.81,196,246.94]),
        (90,[220,261.63,329.63])]
for st, freqs in prog:
    for f in freqs:
        pad += note(f, st, 12, 0.038)

bpm = 120; beat = 60/bpm
drums = np.zeros(n)
for kt in np.arange(0, duration, beat):
    i0=int(kt*sr); ln=int(0.1*sr)
    if i0+ln>n: break
    tt=np.arange(ln)/sr
    drums[i0:i0+ln] += np.sin(2*np.pi*(80-38*tt/0.1)*tt)*np.exp(-tt*28)*0.26
rng = np.random.default_rng(3)
for kt in np.arange(beat/2, duration, beat):
    i0=int(kt*sr); ln=int(0.03*sr)
    if i0+ln>n: break
    noise = rng.normal(0,1,ln)*np.exp(-np.arange(ln)/sr*90)*0.025
    noise = np.diff(np.concatenate([[0], noise]))
    drums[i0:i0+ln] += noise

arp = np.zeros(n)
scale = [440,523.25,659.25,783.99,659.25,523.25]
for i, st in enumerate(np.arange(0, duration, 0.55)):
    f = scale[i % len(scale)]
    i0=int(st*sr); ln=int(0.2*sr)
    if i0+ln>n: break
    tt=np.arange(ln)/sr
    arp[i0:i0+ln] += np.sin(2*np.pi*f*tt)*np.exp(-tt*11)*0.022

mix = np.tanh((pad+drums+arp)*1.3)*0.5
fade = np.ones(n); fs_=int(2.2*sr); fade[-fs_:]=np.linspace(1,0,fs_)
mix *= fade
data = (np.clip(mix,-1,1)*32767).astype(np.int16)
stereo = np.column_stack([data, data]).flatten()
with wave.open(r'${bgmWav.replace(/\\/g, '\\\\')}', 'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(stereo.tobytes())
print('bgm_max', duration)
`
);
const py = process.env.MIMO_PYTHON || 'python';
if (spawnSync(py, [bgmPy], { stdio: 'inherit' }).status !== 0) process.exit(1);

// 混音
const aArgs = ['-y', '-i', path.join(TMP, 'video_only.mp4')];
const aFilters = [];
let ai = 1;
timeline.forEach((s, i) => {
  if (!s.voPath) return;
  aArgs.push('-i', s.voPath);
  const delay = Math.round((sceneStart(i) + (s.lead || 0)) * 1000);
  aFilters.push(`[${ai}:a]adelay=${delay}|${delay}[a${ai}]`);
  ai += 1;
});
aArgs.push('-i', bgmWav);
const nVo = ai - 1;
const bgmIdx = ai;
const labs = [];
for (let k = 1; k <= nVo; k++) labs.push(`[a${k}]`);
aFilters.push(
  `${labs.join('')}amix=inputs=${nVo}:duration=longest:normalize=0[vo]`,
  `[vo]apad=whole_dur=${outDur},alimiter=limit=0.92:level=false,volume=1.08[vofull]`,
  `[${bgmIdx}:a]aresample=48000,volume=0.18[bg]`,
  `[vofull][bg]amix=inputs=2:duration=first:normalize=0[aout]`
);
const raw = path.join(OUT, 'bg-skin-v5-max.mp4');
aArgs.push(
  '-filter_complex', aFilters.join(';'),
  '-map', '0:v', '-map', '[aout]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart', '-shortest', raw
);
run(aArgs, 'mux');

// 字幕
const cues = [];
timeline.forEach((s, i) => {
  if (!s.text) return;
  const start = sceneStart(i) + (s.voPath ? s.lead || 0 : 0.2);
  const end = s.voPath
    ? Math.min(start + s.vd + 0.15, sceneStart(i) + s.total - 0.08)
    : sceneStart(i) + s.total - 0.25;
  cues.push({ t: `${fmt(start)} --> ${fmt(end)}`, text: s.text });
});
cues.sort((a, b) => a.t.localeCompare(b.t));
const srt = path.join(OUT, 'bg-skin-v5-max.srt');
fs.writeFileSync(srt, '﻿' + cues.map((c, i) => `${i + 1}\n${c.t}\n${c.text}\n`).join('\n'), 'utf8');
console.log('cues', cues.length);

const final = path.join(OUT, 'bg-skin-v5-max-sub.mp4');
const r = spawnSync(
  'ffmpeg',
  [
    '-y', '-i', 'bg-skin-v5-max.mp4',
    '-vf', `subtitles=bg-skin-v5-max.srt:force_style='FontName=Microsoft YaHei,FontSize=20,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=52,MarginL=80,MarginR=80'`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-c:a', 'copy', '-movflags', '+faststart', 'bg-skin-v5-max-sub.mp4',
  ],
  { stdio: 'inherit', cwd: OUT }
);
if (r.status !== 0) process.exit(r.status || 1);

const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=noprint_wrappers=1', final], { encoding: 'utf8' });
console.log(p.stdout);
console.log('DONE', final);
