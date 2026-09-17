'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const patcher = require('./src/patcher');
const persist = require('./src/persist');

let outputChannel = null;
let extensionId = null;
let extensionPath = null;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

/** 内置二次元预设皮肤（图在扩展 presets/images/ 下）。 */
const PRESETS = [
  {
    id: 'forest',
    name: '森林 · 水手服',
    file: 'forest.jpg',
    opacity: 0.2,
    blur: 0,
    position: 'cover',
    mode: 'behind',
    desc: '阳光森林，代码区透出氛围感',
  },
  {
    id: 'city',
    name: '赛博 · 雨夜',
    file: 'city.jpg',
    opacity: 0.22,
    blur: 2,
    position: 'cover',
    mode: 'behind',
    desc: '霓虹雨夜 + 轻微毛玻璃',
  },
  {
    id: 'room',
    name: '暖光 · 书桌',
    file: 'room.jpg',
    opacity: 0.18,
    blur: 0,
    position: 'cover',
    mode: 'behind',
    desc: '黄昏书桌，安静写代码',
  },
  {
    id: 'sakura',
    name: '樱花 · 神社',
    file: 'sakura.jpg',
    opacity: 0.2,
    blur: 0,
    position: 'cover',
    mode: 'behind',
    desc: '落樱参道，二次元浓度拉满',
  },
  {
    id: 'starry',
    name: '星空 · 天台',
    file: 'starry.jpg',
    opacity: 0.18,
    blur: 0,
    position: 'cover',
    mode: 'behind',
    desc: '银河天台，夜猫子友好',
  },
  {
    id: 'nebula',
    name: '星云 · 极简',
    file: 'nebula.jpg',
    opacity: 0.16,
    blur: 0,
    position: 'cover',
    mode: 'behind',
    desc: '深空星云，不抢代码注意力',
  },
];

function presetImagePath(file) {
  const base = extensionPath || path.join(__dirname);
  return path.join(base, 'presets', 'images', file);
}

function findPreset(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

/** 当前 VS Code 是否亮色主题。 */
function isLightTheme() {
  try {
    const k = vscode.window.activeColorTheme.kind;
    return (
      k === vscode.ColorThemeKind.Light ||
      k === vscode.ColorThemeKind.HighContrastLight
    );
  } catch (_) {
    return false;
  }
}

/** 把预设写入设置（不立刻 applyFlow，由调用方决定是否重载）。 */
async function writePresetSettings(p) {
  const img = presetImagePath(p.file);
  if (!fs.existsSync(img)) {
    log(`预设图片缺失: ${img}`);
    return false;
  }
  await updateSetting('images', [img]);
  await updateSetting('opacity', p.opacity);
  await updateSetting('blur', p.blur);
  await updateSetting('position', p.position);
  await updateSetting('mode', p.mode);
  return true;
}

/**
 * 按当前亮/暗主题自动套预设。
 * quiet=true 时仅在「当前图与目标不一致」时写入并 apply。
 */
async function syncPresetByTheme(quiet) {
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.autoPresetByTheme) return false;
  const presetId = isLightTheme() ? cfg.lightPreset : cfg.darkPreset;
  const p = findPreset(presetId);
  if (!p) return false;
  const img = presetImagePath(p.file);
  const already = cfg.images[0] && path.resolve(cfg.images[0]) === path.resolve(img);
  if (quiet && already) {
    log(`主题预设已是 ${p.id}，跳过`);
    return false;
  }
  const ok = await writePresetSettings(p);
  if (!ok) return false;
  log(`主题联动 → ${p.name}（${isLightTheme() ? '亮色' : '暗色'}主题）`);
  applyFlow(`已按主题套用「${p.name}」`);
  return true;
}

function log(message) {
  if (outputChannel) outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

/** 把 EPERM/EACCES 等文件系统错误翻译成用户能看懂的提示。 */
function describeFsError(err) {
  const code = err && err.code;
  if (code === 'EPERM' || code === 'EACCES') {
    return (
      '没有权限写入 VS Code 安装目录。' +
      '若是系统级安装（Program Files），请「以管理员身份」运行一次 VS Code 后再试；' +
      '或改用用户级安装。'
    );
  }
  if (code === 'ENOENT') {
    return `目标文件不存在：${err && err.message}`;
  }
  return (err && err.message) || String(err);
}

/** 同步前检查第一张背景图是否仍存在；不存在则警告并返回 false。 */
function ensureImageUsable(cfg) {
  if (!cfg.images.length) return true;
  const img = cfg.images[0];
  if (!fs.existsSync(img)) {
    log(`背景图不存在: ${img}`);
    showOutputButton(
      `背景图不存在或已被移动：${img}。请重新执行「选择背景图」。`,
      'warning'
    );
    return false;
  }
  return true;
}

/** 列出文件夹内可用背景图（绝对路径，排序稳定）。 */
function listImagesInFolder(folder) {
  if (!folder || !fs.existsSync(folder)) return [];
  try {
    return fs
      .readdirSync(folder)
      .filter((n) => IMAGE_EXT.test(n))
      .map((n) => path.join(folder, n))
      .sort();
  } catch (err) {
    log(`读取图库失败: ${describeFsError(err)}`);
    return [];
  }
}

/** overlay 模式用独立透明度；behind 用 opacity。 */
function effectiveOpacity(cfg) {
  return cfg.mode === 'overlay' ? cfg.overlayOpacity : cfg.opacity;
}

function getConfig() {
  const c = vscode.workspace.getConfiguration('bgSkin');
  return {
    enabled: c.get('enabled', true),
    images: (c.get('images', []) || []).map(String),
    imageFolder: String(c.get('imageFolder', '') || ''),
    rotateOnStartup: !!c.get('rotateOnStartup', false),
    opacity: c.get('opacity', 0.18),
    overlayOpacity: c.get('overlayOpacity', 0.08),
    autoPresetByTheme: !!c.get('autoPresetByTheme', false),
    lightPreset: String(c.get('lightPreset', 'sakura') || 'sakura'),
    darkPreset: String(c.get('darkPreset', 'starry') || 'starry'),
    blur: c.get('blur', 0),
    position: c.get('position', 'cover'),
    mode: c.get('mode', 'behind'),
  };
}

function updateSetting(key, value) {
  return vscode.workspace.getConfiguration('bgSkin').update(key, value, vscode.ConfigurationTarget.Global);
}

/**
 * 按当前配置同步核心文件：启用且有图 → 打补丁；否则若仍有残留补丁 → 还原。
 */
function syncPatch() {
  const cfg = getConfig();
  const appRoot = vscode.env.appRoot;
  const opacity = effectiveOpacity(cfg);
  if (cfg.enabled && cfg.images.length > 0) {
    return patcher.applyPatch(
      appRoot,
      {
        imagePath: cfg.images[0],
        opacity,
        position: cfg.position,
        blur: cfg.blur,
        mode: cfg.mode,
      },
      log
    );
  }
  const state = patcher.readState(appRoot);
  if (state.patched) return patcher.restore(appRoot, log);
  return { ok: true, changed: [], restoredFrom: [], strippedIn: [] };
}

function offerReload(prefix) {
  vscode.window
    .showInformationMessage(`${prefix}需要重新加载窗口后生效。`, '重新加载窗口', '稍后')
    .then((pick) => {
      if (pick === '重新加载窗口') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
}

function showOutputButton(message, level) {
  const fn = level === 'error' ? vscode.window.showErrorMessage : vscode.window.showWarningMessage;
  fn(`bg-skin：${message}`, '查看输出').then((pick) => {
    if (pick === '查看输出' && outputChannel) outputChannel.show();
  });
}

/** 应用并提示重载。what：动作描述，如 "背景图已更新"。 */
function applyFlow(what) {
  let result;
  const cfg = getConfig();
  if (cfg.enabled && cfg.images.length > 0 && !ensureImageUsable(cfg)) {
    return;
  }
  try {
    result = syncPatch();
  } catch (err) {
    log(`apply 失败: ${err && err.stack}`);
    showOutputButton(`打补丁失败：${describeFsError(err)}`, 'error');
    return;
  }
  if (!result.ok) {
    showOutputButton(
      result.reason === 'no-target'
        ? '未找到可注入的 workbench 文件，可能是不支持的 VS Code 版本或安装布局'
        : '打补丁失败',
      'error'
    );
    return;
  }
  // 记住本次成功操作过的 appRoot，供卸载钩子还原自定义安装路径
  persist.saveLastAppRoot(vscode.env.appRoot);
  if (result.warnings && result.warnings.length) {
    showOutputButton(result.warnings[0], 'warning');
  }
  if (result.changed && result.changed.length > 0) {
    offerReload(`${what}，`);
  } else {
    log(`${what}: 文件无变化，无需重载`);
  }
}

// ---------------------------------------------------------------- 命令实现

async function cmdApplyPreset() {
  const items = PRESETS.map((p) => ({
    label: `$(sparkle) ${p.name}`,
    description: `${p.opacity} · ${p.blur ? `blur ${p.blur}` : '清晰'}`,
    detail: p.desc,
    preset: p,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: 'bg-skin：选择预设皮肤（二次元壁纸 + 推荐参数）',
    placeHolder: '选中后自动改图并写入设置，重载窗口生效',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!pick) return;
  const p = pick.preset;
  const img = presetImagePath(p.file);
  if (!fs.existsSync(img)) {
    showOutputButton(`预设图片缺失：${img}`, 'error');
    return;
  }
  await updateSetting('images', [img]);
  await updateSetting('opacity', p.opacity);
  await updateSetting('blur', p.blur);
  await updateSetting('position', p.position);
  await updateSetting('mode', p.mode);
  log(`应用预设 ${p.id}: ${img}`);
  applyFlow(`已应用预设「${p.name}」`);
}

/** 从内置预设里随机换一套（二次元浓度拉满）。 */
async function cmdRandomPreset() {
  const cfg = getConfig();
  const current = cfg.images[0] ? path.basename(cfg.images[0]) : '';
  const pool = PRESETS.filter((p) => p.file !== current);
  const list = pool.length ? pool : PRESETS;
  const p = list[Math.floor(Math.random() * list.length)];
  const ok = await writePresetSettings(p);
  if (!ok) {
    showOutputButton(`预设图片缺失：${p.file}`, 'error');
    return;
  }
  log(`随机预设: ${p.id}`);
  applyFlow(`随机换上「${p.name}」`);
}

/** 开关「按亮/暗主题自动换预设」。 */
async function cmdToggleThemePreset() {
  const cfg = getConfig();
  const next = !cfg.autoPresetByTheme;
  await updateSetting('autoPresetByTheme', next);
  log(next ? '已开启主题联动' : '已关闭主题联动');
  if (next) {
    await syncPresetByTheme(false);
    vscode.window.showInformationMessage(
      `bg-skin：已开启主题联动（亮→${cfg.lightPreset}，暗→${cfg.darkPreset}）。切主题后自动换肤。`
    );
  } else {
    vscode.window.showInformationMessage('bg-skin：已关闭主题联动。');
  }
}

async function cmdSelectFolder() {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: '设为图库',
    title: 'bg-skin：选择背景图文件夹',
  });
  if (!uris || !uris.length) return;
  const folder = uris[0].fsPath;
  const list = listImagesInFolder(folder);
  if (!list.length) {
    vscode.window.showWarningMessage(`bg-skin：文件夹里没有可用图片：${folder}`);
    return;
  }
  await updateSetting('imageFolder', folder);
  await updateSetting('images', list);
  log(`图库已设置: ${folder}（${list.length} 张）`);
  applyFlow(`图库已加载（${list.length} 张）`);
}

/** 从图库文件夹重新扫描并随机换一张；未设文件夹则在 images 里轮换。 */
async function cmdRotateFromFolder() {
  const cfg = getConfig();
  let pool = cfg.images;
  if (cfg.imageFolder) {
    pool = listImagesInFolder(cfg.imageFolder);
    if (!pool.length) {
      vscode.window.showWarningMessage(`bg-skin：图库文件夹没有可用图片：${cfg.imageFolder}`);
      return;
    }
    await updateSetting('images', pool);
    log(`图库已刷新: ${pool.length} 张`);
  }
  if (pool.length < 2 && !cfg.imageFolder) {
    vscode.window.showInformationMessage(
      'bg-skin：先「选择图库文件夹」或「选择背景图（可多选）」。'
    );
    return;
  }
  const idx = Math.floor(Math.random() * pool.length);
  const picked = pool[idx];
  // 把选中的挪到首位，其余保持相对顺序
  const next = [picked, ...pool.filter((p) => p !== picked)];
  await updateSetting('images', next);
  log(`随机切换: ${picked}`);
  applyFlow('已随机切换背景图');
}

async function cmdSelectImages() {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFolders: false,
    openLabel: '设为背景',
    title: 'bg-skin：选择背景图片（可多选）',
    filters: { 图片: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] },
  });
  if (!uris || uris.length === 0) return;
  const images = uris.map((u) => u.fsPath);
  await updateSetting('images', images);
  log('背景图已设置:', images.join(' | '));
  applyFlow('背景图已更新');
}

async function cmdRandom() {
  await cmdRotateFromFolder();
}

function askNumber(title, current, min, max, presets, apply) {
  const items = presets.map((v) => ({
    label: String(v),
    description: v === current ? '（当前）' : '',
    value: v,
  }));
  items.push({ label: '自定义…', description: '', value: null });
  vscode.window.showQuickPick(items, { title, placeHolder: '选择一个数值' }).then(async (pick) => {
    if (!pick) return;
    let value = pick.value;
    if (value === null) {
      const input = await vscode.window.showInputBox({
        title,
        prompt: `输入 ${min} ~ ${max} 之间的数值`,
        value: String(current),
        validateInput: (s) => {
          const n = Number(s);
          if (!Number.isFinite(n) || n < min || n > max) return `请输入 ${min} ~ ${max} 之间的数值`;
          return null;
        },
      });
      if (input === undefined) return;
      value = Number(input);
    }
    await apply(value);
  });
}

async function cmdOpacity() {
  const current = getConfig().opacity;
  askNumber(
    'bg-skin：调整背景不透明度（越大越明显）',
    current,
    0.02,
    1,
    [0.1, 0.15, 0.18, 0.25, 0.4, 0.6],
    async (value) => {
      await updateSetting('opacity', value);
      applyFlow('透明度已更新');
    }
  );
}

async function cmdBlur() {
  const current = getConfig().blur;
  askNumber('bg-skin：调整背景模糊半径（px）', current, 0, 50, [0, 2, 4, 8, 16], async (value) => {
    await updateSetting('blur', value);
    applyFlow('模糊度已更新');
  });
}

const POSITION_ITEMS = [
  { label: 'cover（填满窗口，可能裁切）', value: 'cover' },
  { label: 'contain（完整显示，可能留边）', value: 'contain' },
  { label: 'center（原始尺寸居中）', value: 'center' },
];

async function cmdPosition() {
  const pick = await vscode.window.showQuickPick(POSITION_ITEMS, {
    title: 'bg-skin：调整背景位置/尺寸模式',
    placeHolder: '当前：' + getConfig().position,
  });
  if (!pick) return;
  await updateSetting('position', pick.value);
  applyFlow('背景位置已更新');
}

const MODE_ITEMS = [
  { label: 'behind（底层：图在编辑器内容下方透出，效果最佳）', value: 'behind' },
  { label: 'overlay（覆盖层：整窗低透明度水印，兼容性最强）', value: 'overlay' },
];

async function cmdMode() {
  const pick = await vscode.window.showQuickPick(MODE_ITEMS, {
    title: 'bg-skin：背景模式（若升级后底层模式看不到图，请切到 overlay）',
    placeHolder: '当前：' + getConfig().mode,
  });
  if (!pick) return;
  await updateSetting('mode', pick.value);
  applyFlow('背景模式已更新');
}

async function cmdToggle() {
  const cfg = getConfig();
  const next = !cfg.enabled;
  await updateSetting('enabled', next);
  applyFlow(next ? '背景已开启' : '背景已关闭');
}

async function cmdRestore() {
  const pick = await vscode.window.showWarningMessage(
    'bg-skin：将还原被修改的 VS Code 核心文件并关闭背景，确认继续？',
    { modal: true },
    '还原'
  );
  if (pick !== '还原') return;
  await updateSetting('enabled', false);
  const result = patcher.restore(vscode.env.appRoot, log);
  log('restore:', JSON.stringify(result));
  if (result.restoredFrom.length || result.strippedIn.length) {
    offerReload('已还原原文件，');
  } else {
    vscode.window.showInformationMessage('bg-skin：未发现需要还原的补丁。');
  }
}

function cmdMenu() {
  const items = [
    { label: '$(sparkle) 预设皮肤（二次元）', cmd: 'bgSkin.applyPreset' },
    { label: '$(dice) 随机换一套预设', cmd: 'bgSkin.randomPreset' },
    { label: '$(color-mode) 按亮/暗主题自动换肤', cmd: 'bgSkin.toggleThemePreset' },
    { label: '$(folder-opened) 选择图库文件夹（随机轮换）', cmd: 'bgSkin.selectFolder' },
    { label: '$(device-camera) 选择背景图（可多选）', cmd: 'bgSkin.selectImages' },
    { label: '$(sync) 随机切换已选图片', cmd: 'bgSkin.random' },
    { label: '$(dash) 调整透明度', cmd: 'bgSkin.opacity' },
    { label: '$(eye-dimmed) 调整模糊', cmd: 'bgSkin.blur' },
    { label: '$(screen-full) 调整位置/尺寸', cmd: 'bgSkin.position' },
    { label: '$(layers) 切换背景模式（底层/覆盖层）', cmd: 'bgSkin.mode' },
    { label: '$(circle-slash) 开启 / 关闭背景', cmd: 'bgSkin.toggle' },
    { label: '$(discard) 恢复原状（还原核心文件）', cmd: 'bgSkin.restore' },
  ];
  vscode.window.showQuickPick(items, { title: 'bg-skin：背景设置' }).then((pick) => {
    if (pick) vscode.commands.executeCommand(pick.cmd);
  });
}

// ---------------------------------------------------------------- 生命周期

async function activate(context) {
  outputChannel = vscode.window.createOutputChannel('bg-skin');
  context.subscriptions.push(outputChannel);
  extensionId = context.extension.id;
  extensionPath = context.extensionPath;

  log('=== bg-skin activate ===');
  log(`VS Code ${vscode.version} | appRoot: ${vscode.env.appRoot}`);

  const registrations = [
    ['bgSkin.menu', cmdMenu],
    ['bgSkin.applyPreset', cmdApplyPreset],
    ['bgSkin.randomPreset', cmdRandomPreset],
    ['bgSkin.toggleThemePreset', cmdToggleThemePreset],
    ['bgSkin.selectFolder', cmdSelectFolder],
    ['bgSkin.selectImages', cmdSelectImages],
    ['bgSkin.random', cmdRandom],
    ['bgSkin.opacity', cmdOpacity],
    ['bgSkin.blur', cmdBlur],
    ['bgSkin.position', cmdPosition],
    ['bgSkin.mode', cmdMode],
    ['bgSkin.toggle', cmdToggle],
    ['bgSkin.restore', cmdRestore],
  ];
  for (const [cmd, fn] of registrations) {
    context.subscriptions.push(vscode.commands.registerCommand(cmd, fn));
  }

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.text = '$(paintcan) Background';
  bar.tooltip = 'bg-skin：编辑器背景设置';
  bar.command = 'bgSkin.menu';
  bar.show();
  context.subscriptions.push(bar);

  // 切换亮/暗主题时，若开启主题联动则静默换预设（图已一致则不动）
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      syncPresetByTheme(true).catch((err) => {
        log(`主题联动失败: ${err && err.stack}`);
      });
    })
  );

  // 启动同步：
  //  - VS Code 升级覆盖了补丁（标记丢失）→ 自动重新注入
  //  - 设置被手动改过（指纹不一致）→ 重新注入
  //  - 处于关闭状态但文件仍有残留补丁 → 还原
  //  - 其余情况（已打补丁且指纹一致）→ 什么都不做，保证重启无感
  try {
    const targets = patcher.resolveTargets(vscode.env.appRoot);
    if (!targets.styleFile) {
      log(`未找到注入目标。appRoot=${vscode.env.appRoot}`);
      showOutputButton('未在你的 VS Code 中找到可注入的 workbench 文件，功能不可用', 'error');
      return;
    }
    const state = patcher.readState(vscode.env.appRoot);
    const cfg = getConfig();
    // 主题联动：启动时若已开启，先按当前亮/暗主题对齐预设（仅在不一致时改）
    if (cfg.enabled && cfg.autoPresetByTheme) {
      await syncPresetByTheme(true);
    }
    // 图库启动轮换：每次都从文件夹随机抽一张
    const cfg0 = getConfig();
    if (cfg0.enabled && cfg0.imageFolder && cfg0.rotateOnStartup) {
      const pool = listImagesInFolder(cfg0.imageFolder);
      if (pool.length > 0) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        await updateSetting('images', [pick, ...pool.filter((p) => p !== pick)]);
        log(`启动轮换: ${pick}`);
      } else {
        log(`图库文件夹无图片: ${cfg.imageFolder}`);
      }
    }
    const cfg2 = getConfig();
    const want = cfg2.enabled && cfg2.images.length > 0;
    const fp = patcher.fingerprintOf({
      imagePath: cfg2.images[0],
      opacity: effectiveOpacity(cfg2),
      position: cfg2.position,
      blur: cfg2.blur,
      mode: cfg2.mode,
    });
    log(
      `state: patched=${state.patched} fingerprint=${state.fingerprint} | want=${want} fingerprint=${fp}`
    );

    if (want && (!state.patched || state.fingerprint !== fp)) {
      log('启动同步：注入/更新背景补丁');
      applyFlow('背景已就绪');
    } else if (!want && state.patched) {
      log('启动同步：背景处于关闭状态但文件有残留补丁，执行还原');
      applyFlow('背景已关闭');
    } else {
      log('启动同步：无需变更');
    }
  } catch (err) {
    log(`启动同步失败: ${err && err.stack}`);
    showOutputButton(`启动同步失败：${describeFsError(err)}`, 'error');
  }
}

function deactivate() {
  // 卸载/停用时，VS Code 会先把本扩展从注册表移除再调用 deactivate；
  // 正常关窗时扩展仍能查到。借此区分，避免正常关窗误还原导致每次重启都要重载。
  try {
    if (extensionId && vscode.extensions.getExtension(extensionId) === undefined) {
      const result = patcher.restore(vscode.env.appRoot, (m) => console.log(`[bg-skin] ${m}`));
      console.log('[bg-skin] deactivate 清理:', JSON.stringify(result));
    }
  } catch (err) {
    console.error('[bg-skin] deactivate 清理失败:', err);
  }
}

module.exports = { activate, deactivate };
