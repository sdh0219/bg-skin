'use strict';

const fs = require('fs');
const vscode = require('vscode');
const patcher = require('./src/patcher');
const persist = require('./src/persist');

let outputChannel = null;
let extensionId = null;

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

function getConfig() {
  const c = vscode.workspace.getConfiguration('bgSkin');
  return {
    enabled: c.get('enabled', true),
    images: (c.get('images', []) || []).map(String),
    opacity: c.get('opacity', 0.18),
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
  if (cfg.enabled && cfg.images.length > 0) {
    return patcher.applyPatch(
      appRoot,
      {
        imagePath: cfg.images[0],
        opacity: cfg.opacity,
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
  const cfg = getConfig();
  if (cfg.images.length < 2) {
    vscode.window.showInformationMessage('bg-skin：背景图少于两张，先用「选择背景图」多选几张吧。');
    return;
  }
  const idx = Math.floor(Math.random() * cfg.images.length);
  const picked = cfg.images.splice(idx, 1)[0];
  await updateSetting('images', [picked, ...cfg.images]);
  applyFlow('已随机切换背景图');
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
    { label: '$(device-camera) 选择背景图（可多选）', cmd: 'bgSkin.selectImages' },
    { label: '$(dice) 随机切换一张', cmd: 'bgSkin.random' },
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

  log('=== bg-skin activate ===');
  log(`VS Code ${vscode.version} | appRoot: ${vscode.env.appRoot}`);

  const registrations = [
    ['bgSkin.menu', cmdMenu],
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
    const want = cfg.enabled && cfg.images.length > 0;
    const fp = patcher.fingerprintOf({
      imagePath: cfg.images[0],
      opacity: cfg.opacity,
      position: cfg.position,
      blur: cfg.blur,
      mode: cfg.mode,
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
