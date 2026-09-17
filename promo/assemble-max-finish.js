'use strict';
/** 续跑 assemble-max：BGM + 混音 + 字幕 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const CLONE = path.join(ROOT, 'assets', 'voice-clone');
const OUT = path.join(ROOT, 'out');
const TMP = path.join(ROOT, '.tmp-max');
const FADE = 0.55;

function dur(f) {
  return parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).stdout.trim());
}
function run(args, label, cwd) {
  console.log('===', label, '===');
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit', cwd: cwd || ROOT });
  if (r.status !== 0) { console.error('FAIL', label); process.exit(r.status || 1); }
}
function fmt(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor((ms % 3600000) / 60000), 2)}:${p(Math.floor((ms % 60000) / 1000), 2)},${p(ms % 1000, 3)}`;
}

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
  { id: 's11_done', vo: 'vo12.wav', lead: 0.4, tail: 0.7, text: '看！壁纸是不是出现啦？写代码心情都变好了耶。' },
  { id: 's14_outro', vo: 'vo13.wav', lead: 0.5, tail: 0.65, text: '觉得有用的话，拜托去 GitHub 帮我点个 Star 好不好？' },
  { id: 's14_outro', vo: 'vo14.wav', lead: 0.4, tail: 0.65, text: '开源免费，不流氓不锁死，真的超推。' },
  { id: 's14_outro', vo: 'vo15.wav', lead: 0.4, tail: 3.2, text: '现在就去试试吧，我们下次见，拜拜～' },
];

const timeline = SCENES.map((s) => {
  const voPath = s.vo ? path.join(CLONE, `final_${s.vo}`) : null;
  const vd = voPath ? dur(voPath) : 0;
  const total = s.vo
    ? Number(((s.lead || 0) + vd + (s.tail || 0)).toFixed(3))
    : Number((s.hold || 3).toFixed(3));
  return { ...s, voPath, vd, total };
});

function sceneStart(i) {
  if (i === 0) return 0;
  let t = 0;
  for (let j = 0; j < i; j++) t += timeline[j].total - FADE;
  return t;
}
const outDur = Number(timeline.reduce((a, s, i) => a + s.total - (i > 0 ? FADE : 0), 0).toFixed(3));
const videoOnly = path.join(TMP, 'video_only.mp4');
console.log('videoOnly', dur(videoOnly), 'outDur', outDur);

// BGM
const bgmWav = path.join(CLONE, 'bgm_max.wav');
if (!fs.existsSync(bgmWav)) {
  const py = process.env.MIMO_PYTHON || 'python';
  const bgmPy = path.join(CLONE, 'make_bgm_max2.py');
  fs.writeFileSync(bgmPy, `
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
for st, freqs in [(0,[220,261.63,329.63]),(10,[174.61,220,261.63]),(20,[196,246.94,293.66]),
                  (30,[164.81,196,246.94]),(40,[220,261.63,329.63]),(50,[174.61,220,261.63]),
                  (60,[196,246.94,293.66]),(70,[220,261.63,329.63]),(80,[164.81,196,246.94]),(90,[220,261.63,329.63])]:
    for f in freqs: pad += note(f, st, 12, 0.038)
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
print('bgm', duration)
`);
  if (spawnSync(py, [bgmPy], { stdio: 'inherit' }).status !== 0) process.exit(1);
}

// mux
const raw = path.join(OUT, 'bg-skin-v5-max.mp4');
const aArgs = ['-y', '-i', videoOnly];
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
aArgs.push('-filter_complex', aFilters.join(';'), '-map', '0:v', '-map', '[aout]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', raw);
run(aArgs, 'mux');

// srt
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
fs.writeFileSync(path.join(OUT, 'bg-skin-v5-max.srt'),
  '\ufeff' + cues.map((c, i) => `${i + 1}\n${c.t}\n${c.text}\n`).join('\n'), 'utf8');
console.log('cues', cues.length);

const r = spawnSync('ffmpeg', [
  '-y', '-i', 'bg-skin-v5-max.mp4',
  '-vf', `subtitles=bg-skin-v5-max.srt:force_style='FontName=Microsoft YaHei,FontSize=20,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=52,MarginL=80,MarginR=80'`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
  '-c:a', 'copy', '-movflags', '+faststart', 'bg-skin-v5-max-sub.mp4',
], { stdio: 'inherit', cwd: OUT });
if (r.status !== 0) process.exit(r.status || 1);

const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=noprint_wrappers=1', path.join(OUT, 'bg-skin-v5-max-sub.mp4')], { encoding: 'utf8' });
console.log(p.stdout);
console.log('DONE');
