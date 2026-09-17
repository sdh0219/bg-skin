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
const CSP_START = '<!-- bg-skin-csp-start -->';
const BACKUP_SUFFIX = '.bg-skin-backup';
const META_SUFFIX = '.bg-skin.meta.json';
const TMP_SUFFIX = '.bg-skin.tmp';

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
 *
 * 版本兼容策略：优先认已知文件名；找不到就在目录里扫描兜底——
 *  - css：out/vs/workbench/ 下名为 workbench*.css 的文件中取最大者（主样式包）
 *  - html：out/vs/code/<any>/workbench/workbench.html（先试 electron-sandbox / electron-browser）
 */
function resolveTargets(appRoot) {
  const wbDir = path.join(appRoot, 'out', 'vs', 'workbench');

  let css = null;
  const exactCss = path.join(wbDir, 'workbench.desktop.main.css');
  if (fs.existsSync(exactCss)) {
    css = exactCss;
  } else if (fs.existsSync(wbDir)) {
    let best = null;
    let bestSize = -1;
    for (const f of fs.readdirSync(wbDir)) {
      if (!/^workbench[\w.-]*\.css$/i.test(f)) continue;
      const fp = path.join(wbDir, f);
      let size = 0;
      try {
        size = fs.statSync(fp).size;
      } catch (_) {
        continue;
      }
      if (size > bestSize) {
        bestSize = size;
        best = fp;
      }
    }
    css = best;
  }

  const codeDir = path.join(appRoot, 'out', 'vs', 'code');
  let html = null;
  for (const backend of ['electron-sandbox', 'electron-browser']) {
    const p = path.join(codeDir, backend, 'workbench', 'workbench.html');
    if (fs.existsSync(p)) {
      html = p;
      break;
    }
  }
  if (!html && fs.existsSync(codeDir)) {
    for (const e of fs.readdirSync(codeDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(codeDir, e.name, 'workbench', 'workbench.html');
      if (fs.existsSync(p)) {
        html = p;
        break;
      }
    }
  }

  return {
    css,
    html,
    styleFile: css || html,
  };
}

// ---------------------------------------------------------------- 配置指纹

/** 配置指纹：写入补丁块注释，用于启动时判断"设置是否变了、要不要重打"。 */
function fingerprintOf(cfg) {
  const basis = JSON.stringify({
    i: cfg.imagePath,
    o: cfg.opacity,
    p: cfg.position,
    b: cfg.blur,
    m: cfg.mode,
  });
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
  // overlay（覆盖层）：图以低透明度盖在整窗之上，不碰任何内部类名——
  // VS Code 改 DOM 结构时它依然有效，是 behind 模式失效时的保底。
  const overlay = cfg.mode === 'overlay';
  const base = [
    'body::after {',
    '  content: "";',
    '  position: fixed;',
    '  top: 0; right: 0; bottom: 0; left: 0;',
    '  pointer-events: none;',
    `  z-index: ${overlay ? '99998' : '-1'};`,
    `  background-image: url("${pathToFileUrl(cfg.imagePath)}");`,
    '  background-repeat: no-repeat;',
    `  background-position: ${position};`,
    `  background-size: ${size};`,
    `  opacity: ${opacity.toFixed(3)};`,
    `  filter: blur(${blur}px);`,
    '}',
  ];
  if (overlay) return base.join('\n');
  return [
    'html, body { background-color: transparent !important; background-image: none !important; }',
    ...base,
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

/**
 * 给 CSP img-src 增加 file:，并插入 CSP_START 标记（只动我们自己加过的）。
 * 返回 { content, changed, ok, reason? }。
 */
function patchCspContent(html) {
  const m = html.match(/img-src([^;]*);/);
  if (!m) return { content: html, changed: false, ok: false, reason: 'CSP img-src 指令未找到' };
  if (/file:/.test(m[1])) {
    // 已有 file:：无论是我们加的还是上游自带，都不重复改
    return { content: html, changed: false, ok: true };
  }
  let next = html.replace(m[0], () => `img-src file:${m[1]};`);
  if (!next.includes(CSP_START)) {
    // 保留 meta 标签原有缩进，剥离时才能字节级还原
    const marked = next.replace(
      /([ \t]*)(<meta\b[^>]*Content-Security-Policy[^>]*>)/i,
      (_, indent, tag) => `${indent}${CSP_START}\n${indent}${tag}`
    );
    next = marked.includes(CSP_START) ? marked : `${CSP_START}\n${next}`;
  }
  return { content: next, changed: true, ok: true };
}

/** 只在存在 CSP_START 标记时移除我们插入的 file:；绝不碰上游自带的 file:。 */
function unpatchCspContent(html) {
  if (!html.includes(CSP_START)) return html;
  return html
    .replace(/img-src file:(\s)/, 'img-src$1')
    // 只吃掉「标记前缩进 + 标记 + 换行」，保留下一行（meta）自己的缩进
    .replace(new RegExp(`[ \\t]*${escapeRe(CSP_START)}\\r?\\n`, 'g'), '');
}

// ---------------------------------------------------------------- 标记拼接 / 剥离

function isPatched(content) {
  return (
    content.includes(CSS_START) ||
    content.includes(HTML_START) ||
    content.includes(CSP_START)
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

/** 相对 out/ 的 POSIX 校验和键；不在 out/ 下返回 null。 */
function checksumKeyFor(file, appRoot) {
  const outDir = path.join(appRoot, 'out');
  const rel = path.relative(outDir, file).split(path.sep).join('/');
  return rel.startsWith('..') ? null : rel;
}

function readProductJson(appRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeMeta(metaFile, buf, version, verb, algoName, originalChecksum) {
  fs.writeFileSync(
    metaFile,
    JSON.stringify(
      {
        vscodeVersion: version,
        sha256: sha256hex(buf),
        checksumAlgo: algoName ?? null,
        // 备份时机 product.json 里该文件的原厂值；还原时优先写回，避免依赖已污染的存量哈希反推
        originalChecksum: originalChecksum ?? null,
        [`${verb}At`]: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

/**
 * 确保备份与当前（未打补丁的）文件一致；内容不一致时刷新备份。返回 { backup, refreshed }。
 * 备份时机文件必然是原版——此时探测校验和算法最可靠，结果记入元数据，
 * 供日后"存量校验和已是我们的重写值、内容反推失效"的还原流程使用。
 */
function ensureBackup(file, version, log, appRoot) {
  const backup = file + BACKUP_SUFFIX;
  const metaFile = file + META_SUFFIX;
  const cur = fs.readFileSync(file);
  const algoName = detectChecksumAlgo(appRoot)?.name ?? null;
  const rel = checksumKeyFor(file, appRoot);
  const originalChecksum = rel != null ? (readProductJson(appRoot)?.checksums?.[rel] ?? null) : null;

  if (fs.existsSync(backup)) {
    const prev = fs.readFileSync(backup);
    if (!prev.equals(cur)) {
      fs.writeFileSync(backup, cur);
      writeMeta(metaFile, cur, version, 'refreshed', algoName, originalChecksum);
      log(`备份已刷新（原文件内容变化，通常是 VS Code 升级）: ${backup}`);
      return { backup, refreshed: true };
    }
    // 备份一致但 meta 缺 originalChecksum（老版本升级上来）：补写
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (meta.originalChecksum == null && originalChecksum != null) {
        meta.originalChecksum = originalChecksum;
        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
      }
    } catch (_) {
      writeMeta(metaFile, cur, version, 'refreshed', algoName, originalChecksum);
    }
    return { backup, refreshed: false };
  }
  fs.writeFileSync(backup, cur);
  writeMeta(metaFile, cur, version, 'created', algoName, originalChecksum);
  log(`备份已创建: ${backup}`);
  return { backup, refreshed: true };
}

/** 首次改写或升级后刷新 product.json 备份。当前 product.json 必须仍是上游原厂状态。 */
function ensureProductBackup(appRoot, log, forceRefresh) {
  const productPath = path.join(appRoot, 'product.json');
  if (!fs.existsSync(productPath)) return false;
  const backup = productPath + BACKUP_SUFFIX;
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, fs.readFileSync(productPath));
    log(`product.json 备份已创建: ${backup}`);
    return true;
  }
  if (forceRefresh) {
    fs.writeFileSync(backup, fs.readFileSync(productPath));
    log(`product.json 备份已刷新（上游文件变化）: ${backup}`);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- 校验和

// 各世代 VS Code 的校验和算法（1.119 实测 sha256；更老版本为 sha1 世代，格式见社区修复工具）。
// 顺序即优先级：新世代在前。
const CHECKSUM_ALGOS = [
  {
    name: 'sha256-b64-nopad',
    compute: (b) => crypto.createHash('sha256').update(b).digest('base64').replace(/=+$/, ''),
  },
  {
    name: 'sha1-b64-nopad',
    compute: (b) => crypto.createHash('sha1').update(b).digest('base64').replace(/=+$/, ''),
  },
  {
    name: 'sha1-b64',
    compute: (b) => crypto.createHash('sha1').update(b).digest('base64'),
  },
];

function computeChecksum(buf, algo) {
  return (algo || CHECKSUM_ALGOS[0]).compute(buf);
}

/**
 * 反推本机 VS Code 使用的校验和算法：拿 product.json 里的存量值，
 * 对"未修改的文件"（当前原样文件或备份=打补丁前的原版）逐算法比对。
 * 探测不到返回 null，调用方必须跳过重写并提示——绝不猜格式。
 */
function detectChecksumAlgo(appRoot, log) {
  let product;
  try {
    product = JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8'));
  } catch (_) {
    return null;
  }
  const sums = product.checksums || {};
  const outDir = path.join(appRoot, 'out');
  // 每个 entry 可能对应两个探针：当前文件（未打补丁时=原版）与备份（=打补丁前的原版）。
  const probes = [];
  for (const [key, stored] of Object.entries(sums)) {
    const fp = path.join(outDir, key);
    if (fs.existsSync(fp)) probes.push({ read: () => fs.readFileSync(fp), stored });
    const backup = fp + BACKUP_SUFFIX;
    if (fs.existsSync(backup)) probes.push({ read: () => fs.readFileSync(backup), stored });
  }
  for (const algo of CHECKSUM_ALGOS) {
    for (const p of probes) {
      let buf;
      try {
        buf = p.read();
      } catch (_) {
        continue;
      }
      if (algo.compute(buf) === p.stored) return algo;
    }
  }
  return null;
}

/**
 * 内容反推失败时的兜底：读备份元数据里记录的算法名（备份时机=文件必然原版，最可靠）。
 */
function algoFromMeta(files) {
  for (const file of files) {
    try {
      const meta = JSON.parse(fs.readFileSync(file + META_SUFFIX, 'utf8'));
      const algo = CHECKSUM_ALGOS.find((a) => a.name === meta.checksumAlgo);
      if (algo) return algo;
    } catch (_) {
      continue;
    }
  }
  return null;
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
  const algo = detectChecksumAlgo(appRoot, log) || algoFromMeta(files);
  if (!algo) {
    log('无法识别本机 VS Code 的校验和算法，跳过重写。若出现"安装似乎已损坏"提示，安装 lehni.vscode-fix-checksums 即可修复');
    return 'skipped';
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
    const next = computeChecksum(fs.readFileSync(file), algo);
    if (product.checksums[rel] !== next) {
      product.checksums[rel] = next;
      changed = true;
      log(`校验和已更新 (${algo.name}): ${rel}`);
    }
  }
  if (changed) atomicWrite(productPath, `${JSON.stringify(product, null, '\t')}\n`);
  return changed;
}

/**
 * 还原时优先从 meta.originalChecksum 写回原厂校验和。
 * 返回 { ok, restored, missing, changed }；ok 表示所有受校验文件都成功写回。
 */
function restoreChecksumsFromMeta(appRoot, files, log) {
  const productPath = path.join(appRoot, 'product.json');
  if (!fs.existsSync(productPath)) return { ok: false, restored: 0, missing: files.length, changed: false };
  let product;
  try {
    product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
  } catch (_) {
    return { ok: false, restored: 0, missing: files.length, changed: false };
  }
  if (!product.checksums) return { ok: false, restored: 0, missing: files.length, changed: false };

  const outDir = path.join(appRoot, 'out');
  let changed = false;
  let restored = 0;
  let missing = 0;
  for (const file of files) {
    const rel = path.relative(outDir, file).split(path.sep).join('/');
    if (rel.startsWith('..') || !(rel in product.checksums)) continue;
    let meta = null;
    try {
      meta = JSON.parse(fs.readFileSync(file + META_SUFFIX, 'utf8'));
    } catch (_) {
      meta = null;
    }
    if (!meta || meta.originalChecksum == null) {
      missing++;
      continue;
    }
    if (product.checksums[rel] !== meta.originalChecksum) {
      product.checksums[rel] = meta.originalChecksum;
      changed = true;
    }
    restored++;
  }
  if (changed) {
    atomicWrite(productPath, `${JSON.stringify(product, null, '\t')}\n`);
    log('校验和已从 meta 原厂值写回 product.json');
  }
  return { ok: missing === 0 && restored > 0, restored, missing, changed };
}

/** product.json 整文件从备份还原（剥离还原且 meta 缺失时的兜底）。 */
function restoreProductJsonFromBackup(appRoot, log) {
  const productPath = path.join(appRoot, 'product.json');
  const backup = productPath + BACKUP_SUFFIX;
  if (!fs.existsSync(backup)) return false;
  try {
    atomicWrite(productPath, fs.readFileSync(backup));
    log(`已从备份还原 product.json: ${backup}`);
    return true;
  } catch (err) {
    log(`product.json 备份还原失败: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------- 主流程

function patchFile(file, block, version, log, appRoot) {
  const original = fs.readFileSync(file, 'utf8');
  let refreshed = false;
  if (!isPatched(original)) {
    refreshed = ensureBackup(file, version, log, appRoot).refreshed;
  }
  const isHtml = file.toLowerCase().endsWith('.html');
  const updated = isHtml ? spliceHtmlBlock(original, block) : spliceCssBlock(original, block);
  if (updated !== original) {
    atomicWrite(file, updated);
    log(`已写入补丁: ${file}`);
  }
  return { changed: updated !== original, refreshed };
}

/**
 * 按配置打补丁。cfg = { imagePath, opacity, position, blur, mode }。
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
  let anyRefreshed = false;

  // 1) 样式块：新版注入 css，老版本回退 html
  const styleFile = targets.styleFile;
  const block = styleFile === targets.css ? buildCssBlock(cfg) : buildHtmlBlock(cfg);
  const styleResult = patchFile(styleFile, block, version, log, appRoot);
  if (styleResult.changed) changed.push(styleFile);
  if (styleResult.refreshed) anyRefreshed = true;
  touched.push(styleFile);

  // 2) CSP：给 workbench.html 的 img-src 放行 file:（带独立标记）
  if (targets.html) {
    const html = fs.readFileSync(targets.html, 'utf8');
    if (!isPatched(html)) {
      if (ensureBackup(targets.html, version, log, appRoot).refreshed) anyRefreshed = true;
    }
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

  // 2.5) product.json 备份：此时仍是上游原厂校验和，是备份的唯一正确时机
  ensureProductBackup(appRoot, log, anyRefreshed);

  // 3) 校验和（识别不了算法则跳过并警告，绝不写错格式）
  const csStatus = updateChecksums(appRoot, touched, log);
  if (csStatus === 'skipped') {
    warnings.push(
      '无法识别校验和算法，未重写 product.json；若 VS Code 提示"安装似乎已损坏"，安装 lehni.vscode-fix-checksums 即可修复'
    );
  }

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

  if (touched.length) {
    // 优先：meta 里的原厂 checksum（不依赖已污染的存量值反推算法）
    const fromMeta = restoreChecksumsFromMeta(appRoot, touched, log);
    if (!fromMeta.ok) {
      // 次选：整份 product.json 备份（剥离还原且 meta 缺失时）
      if (!restoreProductJsonFromBackup(appRoot, log)) {
        // 末选：算法探测 + 按当前（已还原）文件重算
        updateChecksums(appRoot, touched, log);
      }
    }
  }

  if (cleanBackups) {
    const productBackup = path.join(appRoot, 'product.json') + BACKUP_SUFFIX;
    try { fs.unlinkSync(productBackup); } catch (_) { /* 忽略 */ }
  }

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
  CSP_START,
  BACKUP_SUFFIX,
  META_SUFFIX,
  // 主流程
  resolveTargets,
  applyPatch,
  restore,
  readState,
  fingerprintOf,
  computeChecksum,
  detectChecksumAlgo,
  CHECKSUM_ALGOS,
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
  ensureProductBackup,
  restoreChecksumsFromMeta,
};
