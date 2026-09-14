'use strict';
/**
 * bg-skin 沙箱测试：在 test/.sandbox 里搭一个假的 appRoot（结构仿照本机 VS Code 1.119.1），
 * 全流程验证补丁引擎。绝不接触真实 VS Code 安装。
 *
 * 运行：node test/run-sandbox.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const patcher = require('../src/patcher');

const SANDBOX = path.join(__dirname, '.sandbox');
const APP_ROOT = path.join(SANDBOX, 'resources', 'app');
const CSS_PATH = path.join(APP_ROOT, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
const HTML_PATH = path.join(
  APP_ROOT,
  'out',
  'vs',
  'code',
  'electron-browser',
  'workbench',
  'workbench.html'
);

const ORIGINAL_CSS = [
  '/*!-----------------------------------------------------------',
  ' * Copyright (c) Microsoft Corporation. All rights reserved.',
  ' *-----------------------------------------------------------*/',
  '.monaco-workbench { color: var(--vscode-foreground); }',
  '.part.editor > .content { background-color: var(--vscode-editor-background); }',
  '',
].join('\n');

// 与真实 VS Code 1.119 的 workbench.html 相同结构（多行 CSP）
const ORIGINAL_HTML = `<!-- Copyright (C) Microsoft Corporation. All rights reserved. -->
<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8" />
		<meta
			http-equiv="Content-Security-Policy"
			content="
				default-src
					'none'
				;
				img-src
					'self'
					data:
					blob:
					vscode-remote-resource:
					https:
				;
				style-src
					'self'
					'unsafe-inline'
				;
		"/>
		<!-- Workbench CSS -->
		<link rel="stylesheet" href="../../../workbench/workbench.desktop.main.css">
	</head>
	<body aria-label="">
	</body>
	<script src="./workbench.js" type="module"></script>
</html>
`;

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function checksumOf(buf) {
  return crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
}

function read(file) {
  return fs.readFileSync(file);
}

function makeSandbox() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(CSS_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(HTML_PATH), { recursive: true });
  fs.writeFileSync(CSS_PATH, ORIGINAL_CSS);
  fs.writeFileSync(HTML_PATH, ORIGINAL_HTML);
  fs.writeFileSync(path.join(APP_ROOT, 'package.json'), JSON.stringify({ version: '1.119.1' }));
  // 一张真实存在的"壁纸"（沙箱内，中文+空格路径）
  const imgPath = path.join(SANDBOX, 'img', '壁纸 一号.png');
  fs.mkdirSync(path.dirname(imgPath), { recursive: true });
  fs.writeFileSync(imgPath, 'fake-png-bytes');

  const product = {
    nameShort: 'Code',
    version: '1.119.1',
    checksums: {}, // 下面按真实算法填，模拟原厂状态
  };
  product.checksums['vs/workbench/workbench.desktop.main.css'] = checksumOf(read(CSS_PATH));
  product.checksums['vs/code/electron-browser/workbench/workbench.html'] = checksumOf(
    read(HTML_PATH)
  );
  fs.writeFileSync(
    path.join(APP_ROOT, 'product.json'),
    `${JSON.stringify(product, null, '\t')}\n`
  );

  const originalState = {
    css: sha256hex(read(CSS_PATH)),
    html: sha256hex(read(HTML_PATH)),
    checksums: JSON.parse(read(path.join(APP_ROOT, 'product.json'))).checksums,
  };
  return originalState;
}

const IMG_PATH = path.join(SANDBOX, 'img', '壁纸 一号.png').replace(/\\/g, '/');
const CFG1 = { imagePath: IMG_PATH, opacity: 0.18, position: 'cover', blur: 0 };
const CFG2 = { imagePath: IMG_PATH, opacity: 0.3, position: 'cover', blur: 4 };
const CFG_MISSING = { imagePath: 'D:/不存在的图.png', opacity: 0.18, position: 'cover', blur: 0 };

function run() {
  const pristine = makeSandbox();
  const productPath = path.join(APP_ROOT, 'product.json');
  const log = () => {};

  // ---------- 1. URL 编码 ----------
  {
    const url = patcher.pathToFileUrl('D:\\图库\\我 的 相册\\壁纸 一号.png');
    assert.ok(url.startsWith('file:///D:/'), `URL 前缀错误: ${url}`);
    assert.ok(!url.includes(' '), `空格未编码: ${url}`);
    assert.ok(!/[^\x00-\x7f]/.test(url), `非 ASCII 未编码: ${url}`);
    assert.ok(url.includes('%20') && url.includes('%E5%9B%BE'), `编码结果异常: ${url}`);
    const quoted = patcher.pathToFileUrl("C:/it's a #test?.jpg");
    assert.ok(!quoted.includes("'") && !quoted.includes('#') && !quoted.includes('?'), `特殊字符未处理: ${quoted}`);
    console.log('ok  1 - pathToFileUrl 编码');
  }

  // ---------- 2. 指纹 ----------
  {
    assert.strictEqual(patcher.fingerprintOf(CFG1), patcher.fingerprintOf({ ...CFG1 }));
    assert.notStrictEqual(patcher.fingerprintOf(CFG1), patcher.fingerprintOf(CFG2));
    console.log('ok  2 - fingerprintOf 稳定且区分配置');
  }

  // ---------- 3. 首次打补丁 ----------
  {
    const r = patcher.applyPatch(APP_ROOT, CFG1, log);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.changed.sort(), [CSS_PATH, HTML_PATH].sort(), '应有且仅有两个文件被改');
    assert.strictEqual(r.warnings.length, 0, `不应有警告: ${r.warnings}`);

    const css = read(CSS_PATH).toString();
    assert.ok(css.includes(patcher.CSS_START) && css.includes(patcher.CSS_END), 'css 缺少补丁标记');
    assert.strictEqual(css.split(patcher.CSS_START).length - 1, 1, 'css 补丁块应只有一份');
    assert.ok(css.includes(`url("file:///${encodeURI(IMG_PATH).replace(/'/g, '%27')}`) ||
      css.includes(`url("file:///${encodeURI(IMG_PATH)}`), `css 应包含图片地址: ${css.match(/url\("([^"]+)"\)/)?.[1]}`);
    assert.ok(!/[^\\]\s/.test((css.match(/url\("([^"]+)"\)/) || ['', ''])[1]), 'URL 中不应有未编码空格');
    assert.ok(css.includes('opacity: 0.180'), 'css 应包含透明度');
    assert.ok(css.includes('z-index: -1'), '背景层应在内容之下');

    const html = read(HTML_PATH).toString();
    assert.ok(html.includes('img-src file:'), 'CSP 应放行 file:');
    assert.ok(html.includes("'self'"), 'CSP 原有指令应保留');
    assert.strictEqual(html.split('img-src file:').length - 1, 1, 'file: 只插入一次');

    // 备份存在且与原版一致
    const cssBackup = read(CSS_PATH + patcher.BACKUP_SUFFIX);
    assert.strictEqual(sha256hex(cssBackup), pristine.css, 'css 备份应是原版');
    const htmlBackup = read(HTML_PATH + patcher.BACKUP_SUFFIX);
    assert.strictEqual(sha256hex(htmlBackup), pristine.html, 'html 备份应是原版');

    // 校验和已重写且算法正确
    const sums = JSON.parse(read(productPath)).checksums;
    assert.strictEqual(sums['vs/workbench/workbench.desktop.main.css'], checksumOf(read(CSS_PATH)));
    assert.strictEqual(
      sums['vs/code/electron-browser/workbench/workbench.html'],
      checksumOf(read(HTML_PATH))
    );
    assert.ok(!sums['vs/workbench/workbench.desktop.main.css'].includes('='), '校验和不应含 = 尾');
    console.log('ok  3 - 首次打补丁（注入+CSP+备份+校验和）');
  }

  // ---------- 4. 幂等：同配置重复打补丁 ----------
  {
    const before = sha256hex(read(CSS_PATH));
    const r = patcher.applyPatch(APP_ROOT, CFG1, log);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed.length, 0, '重复打补丁不应改文件');
    assert.strictEqual(sha256hex(read(CSS_PATH)), before, '文件字节不变');
    console.log('ok  4 - 幂等（同配置零写入）');
  }

  // ---------- 5. 配置变化 → 原地替换补丁块 ----------
  {
    const r = patcher.applyPatch(APP_ROOT, CFG2, log);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.changed, [CSS_PATH], '只应改 css');
    const css = read(CSS_PATH).toString();
    assert.strictEqual(css.split(patcher.CSS_START).length - 1, 1, '替换后仍只有一份补丁块');
    assert.ok(css.includes('opacity: 0.300') && css.includes('blur(4px)'), '新配置应生效');
    assert.ok(patcher.readState(APP_ROOT).fingerprint === patcher.fingerprintOf(CFG2), '指纹应更新');
    const sums = JSON.parse(read(productPath)).checksums;
    assert.strictEqual(sums['vs/workbench/workbench.desktop.main.css'], checksumOf(read(CSS_PATH)));
    console.log('ok  5 - 配置变化原地替换 + 校验和跟随');
  }

  // ---------- 6. 还原（有备份）----------
  {
    const r = patcher.restore(APP_ROOT, log);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.restoredFrom.length, 2, '两个文件都应从备份还原');
    assert.strictEqual(sha256hex(read(CSS_PATH)), pristine.css, 'css 应还原为原版字节');
    assert.strictEqual(sha256hex(read(HTML_PATH)), pristine.html, 'html 应还原为原版字节');
    const sums = JSON.parse(read(productPath)).checksums;
    assert.deepStrictEqual(sums, pristine.checksums, '校验和应回到原厂值');
    assert.strictEqual(patcher.readState(APP_ROOT).patched, false, '还原后应为未打补丁状态');
    console.log('ok  6 - 还原（有备份，字节级一致 + 校验和回原厂）');
  }

  // ---------- 7. 重复还原 → 无害空操作 ----------
  {
    const r = patcher.restore(APP_ROOT, log);
    assert.strictEqual(r.restoredFrom.length, 0);
    assert.strictEqual(r.strippedIn.length, 0);
    console.log('ok  7 - 重复还原为空操作');
  }

  // ---------- 8. 备份丢失 → 按标记剥离还原 ----------
  {
    patcher.applyPatch(APP_ROOT, CFG1, log);
    fs.rmSync(CSS_PATH + patcher.BACKUP_SUFFIX);
    fs.rmSync(HTML_PATH + patcher.BACKUP_SUFFIX);
    const r = patcher.restore(APP_ROOT, log);
    assert.strictEqual(r.strippedIn.length, 2, '应走剥离路径');
    const css = read(CSS_PATH).toString();
    const html = read(HTML_PATH).toString();
    assert.ok(!css.includes('bg-skin') && !html.includes('bg-skin'), '剥离后不应残留任何 bg-skin 痕迹');
    assert.ok(!html.includes('img-src file:'), '剥离应移除 CSP 签名');
    assert.strictEqual(sha256hex(read(CSS_PATH)), pristine.css, '剥离还原后 css 应与原版一致');
    assert.strictEqual(sha256hex(read(HTML_PATH)), pristine.html, '剥离还原后 html 应与原版一致');
    console.log('ok  8 - 备份丢失时按标记剥离还原');
  }

  // ---------- 9. VS Code 升级模拟：原文件被上游覆盖 → 备份自动刷新 ----------
  {
    patcher.applyPatch(APP_ROOT, CFG1, log);
    // 模拟升级：新版本原版文件（内容不同于旧原版）
    const upgradedCss = ORIGINAL_CSS + '\n/* upstream 1.120 content */\n.new-version-rule {}\n';
    const upgradedHtml = ORIGINAL_HTML.replace("'self'", "'self'\n\t\t\t\t\thttps://new-upstream.example");
    fs.writeFileSync(CSS_PATH, upgradedCss);
    fs.writeFileSync(HTML_PATH, upgradedHtml);
    // 升级后校验和应仍与 product.json 一致（模拟官方升级行为）
    const product = JSON.parse(read(productPath));
    product.checksums['vs/workbench/workbench.desktop.main.css'] = checksumOf(read(CSS_PATH));
    product.checksums['vs/code/electron-browser/workbench/workbench.html'] = checksumOf(read(HTML_PATH));
    fs.writeFileSync(productPath, `${JSON.stringify(product, null, '\t')}\n`);

    // 此时 readState 应报告未打补丁（标记丢失）
    const state = patcher.readState(APP_ROOT);
    assert.strictEqual(state.patched, false, '升级后标记应丢失');

    // 重新打补丁：应以新原版刷新备份
    patcher.applyPatch(APP_ROOT, CFG1, log);
    const backupCss = read(CSS_PATH + patcher.BACKUP_SUFFIX).toString();
    assert.strictEqual(backupCss, upgradedCss, '备份应刷新为新版原版（而非旧版残留）');

    // 升级场景的完整还原
    patcher.restore(APP_ROOT, log);
    assert.strictEqual(read(CSS_PATH).toString(), upgradedCss, '还原应得到新版原版');
    const sums = JSON.parse(read(productPath)).checksums;
    assert.deepStrictEqual(sums, product.checksums, '校验和应与新版原厂一致');
    console.log('ok  9 - 升级模拟：标记丢失检测 + 备份刷新 + 版本匹配还原');
  }

  // ---------- 10. 图片不存在 → 有警告；无目标文件 → 明确报错而非静默 ----------
  {
    const rw = patcher.applyPatch(APP_ROOT, CFG_MISSING, log);
    assert.strictEqual(rw.ok, true);
    assert.ok(rw.warnings.some((w) => w.includes('不存在的图')), `应警告图片不存在: ${rw.warnings}`);
    patcher.restore(APP_ROOT, log); // 清场后再测无目标

    fs.rmSync(SANDBOX, { recursive: true, force: true });
    fs.mkdirSync(SANDBOX, { recursive: true });
    const r = patcher.applyPatch(APP_ROOT, CFG1, log);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-target');
    console.log('ok 10 - 图片缺失有警告 / 无目标文件时明确失败');
  }

  // ---------- 11. 旧版校验和算法（sha1 世代）→ 自动探测并沿用 ----------
  {
    makeSandbox();
    const sha1nopad = (b) => crypto.createHash('sha1').update(b).digest('base64').replace(/=+$/, '');
    const product = JSON.parse(read(productPath));
    product.checksums['vs/workbench/workbench.desktop.main.css'] = sha1nopad(read(CSS_PATH));
    product.checksums['vs/code/electron-browser/workbench/workbench.html'] = sha1nopad(read(HTML_PATH));
    fs.writeFileSync(productPath, `${JSON.stringify(product, null, '\t')}\n`);

    const r = patcher.applyPatch(APP_ROOT, CFG1, log);
    assert.strictEqual(r.ok, true);
    const sums = JSON.parse(read(productPath)).checksums;
    // 关键：写入的必须是 sha1 算法的结果，而不是默认 sha256
    assert.strictEqual(sums['vs/workbench/workbench.desktop.main.css'], sha1nopad(read(CSS_PATH)),
      '应沿用探测到的 sha1-b64-nopad 算法');
    assert.notStrictEqual(sums['vs/workbench/workbench.desktop.main.css'], checksumOf(read(CSS_PATH)),
      '不应错误地使用 sha256');
    patcher.restore(APP_ROOT, log);
    console.log('ok 11 - 校验和算法自动探测（sha1 世代兼容）');
  }

  // ---------- 12. 无法识别的算法 → 跳过重写 + 用户可见警告，绝不写错 ----------
  {
    makeSandbox();
    const product = JSON.parse(read(productPath));
    for (const k of Object.keys(product.checksums)) product.checksums[k] = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    fs.writeFileSync(productPath, `${JSON.stringify(product, null, '\t')}\n`);

    const r = patcher.applyPatch(APP_ROOT, CFG1, log);
    assert.strictEqual(r.ok, true, '打补丁本身仍应成功');
    assert.ok(r.warnings.some((w) => w.includes('校验和')), `应产生校验和警告: ${r.warnings}`);
    const sums = JSON.parse(read(productPath)).checksums;
    for (const k of Object.keys(sums)) {
      assert.strictEqual(sums[k], 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '不应猜格式乱写');
    }
    patcher.restore(APP_ROOT, log);
    console.log('ok 12 - 未知算法时跳过重写并警告（绝无"损坏"风险）');
  }

  // ---------- 13. 核心文件改名 → 目录扫描兜底 ----------
  {
    makeSandbox();
    const wbDir = path.dirname(CSS_PATH);
    const renamed = path.join(wbDir, 'workbench.future-version.css');
    fs.renameSync(CSS_PATH, renamed);

    const targets = patcher.resolveTargets(APP_ROOT);
    assert.ok(targets.css && targets.css.endsWith('workbench.future-version.css'),
      `应扫描到改名后的主样式包: ${targets.css}`);

    const r = patcher.applyPatch(APP_ROOT, CFG1, log);
    assert.strictEqual(r.ok, true);
    assert.ok(read(renamed).toString().includes(patcher.CSS_START), '补丁应注入到扫描到的文件');
    patcher.restore(APP_ROOT, log);
    console.log('ok 13 - 文件名漂移时目录扫描兜底');
  }

  // ---------- 14. overlay 覆盖层模式：不依赖内部类名 ----------
  {
    makeSandbox();
    const cfgO = { ...CFG1, mode: 'overlay' };
    const block = patcher.buildCssBlock(cfgO);
    assert.ok(block.includes('z-index: 99998'), 'overlay 应置顶显示');
    assert.ok(!block.includes('monaco'), 'overlay 不得依赖任何 monaco 内部类名');
    assert.ok(!block.includes('background-color: transparent'), 'overlay 不应改动容器配色');
    assert.notStrictEqual(
      patcher.fingerprintOf(cfgO),
      patcher.fingerprintOf(CFG1),
      'mode 应参与指纹'
    );
    // 默认 behind 模式行为不变
    assert.ok(patcher.buildCssBlock(CFG1).includes('z-index: -1'), 'behind 应保持在内容之下');
    // 端到端：overlay 打补丁 + 还原
    const r = patcher.applyPatch(APP_ROOT, cfgO, log);
    assert.strictEqual(r.ok, true);
    assert.ok(read(CSS_PATH).toString().includes('z-index: 99998'));
    patcher.restore(APP_ROOT, log);
    console.log('ok 14 - overlay 保底模式');
  }

  // ---------- 15. 安装位置持久化（卸载钩子的自定义路径保险） ----------
  {
    process.env.BG_SKIN_MARKER = path.join(__dirname, '.marker-test.json');
    const persist = require('../src/persist');
    assert.ok(persist.saveLastAppRoot('D:/custom/path/vscode/resources/app'));
    assert.strictEqual(persist.readLastAppRoot(), 'D:/custom/path/vscode/resources/app');
    assert.strictEqual(persist.readLastAppRoot(), 'D:/custom/path/vscode/resources/app');
    assert.ok(persist.looksLikeAppRoot(APP_ROOT), '合法 appRoot 应被识别');
    assert.ok(!persist.looksLikeAppRoot('D:/no/such/dir'), '非法路径应被拒绝');
    assert.ok(!persist.looksLikeAppRoot(null));
    fs.rmSync(process.env.BG_SKIN_MARKER, { force: true });
    delete process.env.BG_SKIN_MARKER;
    console.log('ok 15 - 安装位置持久化');
  }

  // 清理
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.log('\n全部沙箱测试通过 ✔');
}

let failed = false;
try {
  run();
} catch (err) {
  failed = true;
  console.error('\n测试失败:');
  console.error(err && err.stack);
}
process.exit(failed ? 1 : 0);
