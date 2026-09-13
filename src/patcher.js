'use strict';
/**
 * bg-skin 补丁引擎（纯 Node，不依赖 vscode API，便于独立测试）。
 *
 * 职责：
 *  - 定位注入目标：workbench.desktop.main.css（主），旧版回退 workbench.html 内联 <style>
 *  - 备份 → 注入 CSS 补丁块 → 给 workbench.html 的 CSP img-src 放行 file:
 *  - 重写 product.json 的 checksums（实测为 sha256 + base64 去尾部 =，键为相对 out/ 的路径）
 *  - 幂等：同一配置重复打补丁，文件不发生任何变化
 *  - 还原：优先用备份原样恢复；备份丢失时按标记剥离
 *
 * 安全约定：
 *  - 首次改动某文件前必须有备份（.bg-skin-backup + .bg-skin.meta.json）
 *  - 原文件内容与备份不一致时（通常是 VS Code 升级），以当前文件为新原版刷新备份
 *  - 所有写入走 临时文件 + rename，避免写一半被读到
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CSS_START = '/* bg-skin-patch-start */';
const CSS_END = '/* bg-skin-patch-end */';
const HTML_START = '<!-- bg-skin-patch-start (bg-skin) -->';
const HTML_END = '<!-- bg-skin-patch-end (bg-skin) -->';
const BACKUP_SUFFIX = '.bg-skin-backup';
const META_SUFFIX = '.bg-skin.meta.json';
const TMP_SUFFIX = '.bg-skin.tmp';
const CSP_SIGNATURE = 'img-src file:';

// 让主要工作区容器透出背景。标签页、标题栏、弹窗保持原配色，保证可读性。
const TRANSPARENT_SELECTORS = [
  '.monaco-workbench .part.editor > .content',
  '.monaco-workbench .part.editor > .content .editor-group-container',
  '.monaco-workbench .part.editor > .content .editor-group-container > .editor-container',
  '.monaco-workbench .part.editor > .content .editor-group-container > .editor-container > .editor-instance',
  '.monaco-workbench .part.editor > .content .editor-group-container > .editor-group-container-header',
  '.monaco-workbench .part.auxiliarybar',
  '.monaco-workbench .part.sidebar',
  '.monaco-workbench .part.activitybar',
  '.monaco-workbench .part.panel',
  '.monaco-workbench .part.statusbar',
  '.monaco-editor',
  '.monaco-editor .overflow-guard',
  '.monaco-editor .monaco-editor-background',
];

// ---------------------------------------------------------------- 基础工具

function log_noop() {}

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function atomicWrite(file, data) {
  const tmp = file + TMP_SUFFIX;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* 忽略 */ }
    throw err;
  }
}

function readVscodeVersion(appRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version || '?';
  } catch (_) {
    return '?';
  }
}

// ---------------------------------------------------------------- 目标定位

/**
 * 返回 { css, html, styleFile }；均可能为 null。
 * styleFile：样式块应注入的文件（新版是 css，老版本没有 css 时回退 html）。
 */
function resolveTargets(appRoot) {
  const css = path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
  const htmlCandidates = [
    path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
    path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
  ];
  const html = htmlCandidates.find((p) => fs.existsSync(p)) || null;
  const cssExists = fs.existsSync(css);
  return {
    css: cssExists ? css : null,
    html,
    styleFile: cssExists ? css : html,
  };
}

// ---------------------------------------------------------------- 配置指纹

/** 配置指纹：写入补丁块注释，用于启动时判断"设置是否变了、要不要重打"。 */
function fingerprintOf(cfg) {
  const basis = JSON.stringify({ i: cfg.imagePath, o: cfg.opacity, p: cfg.position, b: cfg.blur });
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 8);
}

// ---------------------------------------------------------------- URL / CSS

/** 本地路径 → file:// URL，处理反斜杠、空格、中文、引号、#/?。 */
function pathToFileUrl(p) {
  let norm = String(p).replace(/\\/g, '/');
  if (!norm.startsWith('/')) norm = '/' + norm;
  let u = 'file://' + encodeURI(norm);
  // encodeURI 不会编码这些字符，但它们会破坏 CSS url("...") 或 URL 语义
  // （encodeURIComponent 同样不处理单引号，需显式转义）
  u = u.replace(/["'\\]/g, (c) => (c === "'" ? '%27' : c === '"' ? '%22' : '%5C'));
  u = u.replace(/#/g, '%23').replace(/\?/g, '%3F');
  return u;
}

function resolveSizePosition(mode) {
  switch (mode) {
    case 'contain':
      return { size: 'contain', position: 'center' };
    case 'center':
      return { size: 'auto', position: 'center' };
    case 'cover':
    default:
      return { size: 'cover', position: 'center' };
  }
}

function buildInnerCss(cfg) {
  const { size, position } = resolveSizePosition(cfg.position);
  const opacity = Math.min(1, Math.max(0.02, Number(cfg.opacity) || 0.18));
  const blur = Math.max(0, Number(cfg.blur) || 0);
  return [
    'html, body { background-color: transparent !important; background-image: none !important; }',
    'body::after {',
    '  content: "";',
    '  position: fixed;',
    '  top: 0; right: 0; bottom: 0; left: 0;',
    '  z-index: -1;',
    '  pointer-events: none;',
    `  background-image: url("${pathToFileUrl(cfg.imagePath)}");`,
    '  background-repeat: no-repeat;',
    `  background-position: ${position};`,
    `  background-size: ${size};`,
    `  opacity: ${opacity.toFixed(3)};`,
    `  filter: blur(${blur}px);`,
    '}',
    '.monaco-workbench { background-color: transparent !important; }',
    `${TRANSPARENT_SELECTORS.join(',\n')} { background-color: transparent !important; }`,
  ].join('\n');
}

function buildCssBlock(cfg) {
  return [
    CSS_START,
    `/* bg-skin ${fingerprintOf(cfg)} generated; do not edit */`,
    buildInnerCss(cfg),
    CSS_END,
  ].join('\n');
}

function buildHtmlBlock(cfg) {
  return [
    HTML_START,
    '<style id="bg-skin-style">',
    `/* bg-skin ${fingerprintOf(cfg)} generated; do not edit */`,
    buildInnerCss(cfg),
    '</style>',
    HTML_END,
  ].join('\n');
}

// ---------------------------------------------------------------- CSP

/** 给 CSP img-src 增加 file:。返回 { content, changed, ok, reason? } */
function patchCspContent(html) {
  const m = html.match(/img-src([^;]*);/);
  if (!m) return { content: html, changed: false, ok: false, reason: 'CSP img-src 指令未找到' };
  if (/file:/.test(m[1])) return { content: html, changed: false, ok: true };
  const next = html.replace(m[0], () => `img-src file:${m[1]};`);
  return { content: next, changed: true, ok: true };
}

/** 只移除我们插入的 "img-src file:" 签名，不碰上游本来就有的 file:。 */
function unpatchCspContent(html) {
  return html.replace(/img-src file:(\s)/, 'img-src$1');
}

// ---------------------------------------------------------------- 标记拼接 / 剥离

function isPatched(content) {
  return (
    content.includes(CSS_START) ||
    content.includes(HTML_START) ||
    content.includes(CSP_SIGNATURE)
  );
}

function spliceCssBlock(content, block) {
  const re = new RegExp(
    `${escapeRe(CSS_START)}[\\s\\S]*?${escapeRe(CSS_END)}` +
    `|${escapeRe(HTML_START)}[\\s\\S]*?${escapeRe(HTML_END)}`
  );
  if (re.test(content)) return content.replace(re, () => block);
  return `${content.replace(/\s+$/, '')}\n\n${block}\n`;
}

function spliceHtmlBlock(html, block) {
  const re = new RegExp(
    `${escapeRe(CSS_START)}[\\s\\S]*?${escapeRe(CSS_END)}` +
    `|${escapeRe(HTML_START)}[\\s\\S]*?${escapeRe(HTML_END)}`
  );
  if (re.test(html)) return html.replace(re, () => block);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => `${block}\n</head>`);
  return `${html}\n${block}\n`;
}

function stripBlocks(content) {
  const re = new RegExp(
    `\\s*${escapeRe(CSS_START)}[\\s\\S]*?${escapeRe(CSS_END)}\\s*` +
    `|\\s*${escapeRe(HTML_START)}[\\s\\S]*?${escapeRe(HTML_END)}\\s*`,
    'g'
  );
  return content.replace(re, '\n');
}

// ---------------------------------------------------------------- 备份

function writeMeta(metaFile, buf, version, verb) {
  fs.writeFileSync(
    metaFile,
    JSON.stringify(
      { vscodeVersion: version, sha256: sha256hex(buf), [`${verb}At`]: new Date().toISOString() },
      null,
      2
    )
  );
}

/** 确保备份与当前（未打补丁的）文件一致；内容不一致时刷新备份。返回备份路径。 */
function ensureBackup(file, version, log) {
  const backup = file + BACKUP_SUFFIX;
  const metaFile = file + META_SUFFIX;
  const cur = fs.readFileSync(file);
  if (fs.existsSync(backup)) {
    const prev = fs.readFileSync(backup);
    if (!prev.equals(cur)) {
      fs.writeFileSync(backup, cur);
      writeMeta(metaFile, cur, version, 'refreshed');
      log(`备份已刷新（原文件内容变化，通常是 VS Code 升级）: ${backup}`);
    }
  } else {
    fs.writeFileSync(backup, cur);
    writeMeta(metaFile, cur, version, 'created');
    log(`备份已创建: ${backup}`);
  }
  return backup;
}

// ---------------------------------------------------------------- 校验和

/** 与 VS Code 1.119 实测一致：sha256 + base64 去掉尾部 =。 */
function computeChecksum(buf) {
  return crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
}

/** 只更新 product.json checksums 里已存在的键；不存在说明 VS Code 不校验该文件。 */
function updateChecksums(appRoot, files, log) {
  const productPath = path.join(appRoot, 'product.json');
  if (!fs.existsSync(productPath)) {
    log('product.json 缺失，跳过校验和更新');
    return false;
  }
  let product;
  try {
    product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
  } catch (err) {
    log(`product.json 解析失败，跳过校验和更新: ${err.message}`);
    return false;
  }
  if (!product.checksums) {
    log('product.json 无 checksums 字段，跳过校验和更新');
    return false;
  }
  const outDir = path.join(appRoot, 'out');
  let changed = false;
  for (const file of files) {
    const rel = path.relative(outDir, file).split(path.sep).join('/');
    if (rel.startsWith('..')) continue;
    if (!(rel in product.checksums)) {
      log(`checksums 中无 ${rel}（该文件不受校验），跳过`);
      continue;
    }
    const next = computeChecksum(fs.readFileSync(file));
    if (product.checksums[rel] !== next) {
      product.checksums[rel] = next;
      changed = true;
      log(`校验和已更新: ${rel}`);
    }
  }
  if (changed) atomicWrite(productPath, `${JSON.stringify(product, null, '\t')}\n`);
  return changed;
}

// ---------------------------------------------------------------- 主流程

function patchFile(file, block, version, log) {
  const original = fs.readFileSync(file, 'utf8');
  if (!isPatched(original)) ensureBackup(file, version, log);
  const isHtml = file.toLowerCase().endsWith('.html');
  const updated = isHtml ? spliceHtmlBlock(original, block) : spliceCssBlock(original, block);
  if (updated !== original) {
    atomicWrite(file, updated);
    log(`已写入补丁: ${file}`);
  }
  return { changed: updated !== original };
}

/**
 * 按配置打补丁。cfg = { imagePath, opacity, position, blur }。
 * 返回 { ok, reason?, changed[], backups[], warnings[] }。
 */
function applyPatch(appRoot, cfg, log) {
  log = log || log_noop;
  const targets = resolveTargets(appRoot);
  const warnings = [];
  if (!targets.styleFile) {
    log(`未找到注入目标（appRoot=${appRoot}）`);
    return { ok: false, reason: 'no-target', changed: [], backups: [], warnings };
  }
  if (cfg.imagePath && !fs.existsSync(cfg.imagePath)) {
    warnings.push(`背景图不存在：${cfg.imagePath}`);
  }

  const version = readVscodeVersion(appRoot);
  const changed = [];
  const touched = [];

  // 1) 样式块：新版注入 css，老版本回退 html
  const styleFile = targets.styleFile;
  const block = styleFile === targets.css ? buildCssBlock(cfg) : buildHtmlBlock(cfg);
  if (patchFile(styleFile, block, version, log).changed) changed.push(styleFile);
  touched.push(styleFile);

  // 2) CSP：给 workbench.html 的 img-src 放行 file:
  if (targets.html) {
    const html = fs.readFileSync(targets.html, 'utf8');
    if (!isPatched(html)) ensureBackup(targets.html, version, log);
    const res = patchCspContent(html);
    if (res.changed) {
      atomicWrite(targets.html, res.content);
      changed.push(targets.html);
      log(`已放行 file: 协议 (CSP img-src): ${targets.html}`);
    }
    if (!res.ok) warnings.push(res.reason);
    if (!touched.includes(targets.html)) touched.push(targets.html);
  } else {
    warnings.push('未找到 workbench.html，未能放宽 CSP；若背景图不显示多半是这个原因');
  }

  // 3) 校验和
  updateChecksums(appRoot, touched, log);

  return { ok: true, changed, backups: touched.map((f) => f + BACKUP_SUFFIX), warnings };
}

/**
 * 还原所有被 bg-skin 修改的文件。
 * options.cleanBackups：还原后删除备份与元数据（卸载时用）。
 * 返回 { ok, restoredFrom[], strippedIn[] }。
 */
function restore(appRoot, log, options) {
  log = log || log_noop;
  const cleanBackups = !!(options && options.cleanBackups);
  const targets = resolveTargets(appRoot);
  const restoredFrom = [];
  const strippedIn = [];
  const touched = [];
  const seen = new Set();

  for (const file of [targets.styleFile, targets.html].filter(Boolean)) {
    if (seen.has(file)) continue;
    seen.add(file);
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    if (!isPatched(content)) continue;

    const backup = file + BACKUP_SUFFIX;
    let next;
    if (fs.existsSync(backup)) {
      next = fs.readFileSync(backup, 'utf8');
      restoredFrom.push(backup);
      log(`已从备份还原: ${file}`);
    } else {
      next = unpatchCspContent(stripBlocks(content));
      strippedIn.push(file);
      log(`备份缺失，按标记剥离还原: ${file}`);
    }
    if (next !== content) atomicWrite(file, next);
    touched.push(file);

    if (cleanBackups) {
      for (const junk of [backup, file + META_SUFFIX]) {
        try { fs.unlinkSync(junk); } catch (_) { /* 忽略 */ }
      }
    }
  }

  if (touched.length) updateChecksums(appRoot, touched, log);
  return { ok: true, restoredFrom, strippedIn };
}

/** 读取当前补丁状态（启动同步用）。 */
function readState(appRoot) {
  const targets = resolveTargets(appRoot);
  let patched = false;
  let fingerprint = null;
  for (const file of [targets.styleFile, targets.html].filter(Boolean)) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    if (content.includes(CSS_START) || content.includes(HTML_START)) patched = true;
    const m = content.match(/bg-skin ([0-9a-f]{8}) /);
    if (m) fingerprint = m[1];
  }
  const backups = [targets.styleFile, targets.html]
    .filter(Boolean)
    .map((f) => f + BACKUP_SUFFIX)
    .filter((b) => fs.existsSync(b));
  return { targets, patched, fingerprint, backups };
}

module.exports = {
  // 常量（测试用）
  CSS_START,
  CSS_END,
  HTML_START,
  HTML_END,
  BACKUP_SUFFIX,
  META_SUFFIX,
  // 主流程
  resolveTargets,
  applyPatch,
  restore,
  readState,
  fingerprintOf,
  computeChecksum,
  // 内部（测试用）
  buildCssBlock,
  buildHtmlBlock,
  buildInnerCss,
  pathToFileUrl,
  patchCspContent,
  unpatchCspContent,
  isPatched,
  updateChecksums,
  atomicWrite,
};
