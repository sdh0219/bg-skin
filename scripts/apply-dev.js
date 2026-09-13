'use strict';
/**
 * 开发/救援 CLI：不经扩展宿主，直接对本机 VS Code 执行 bg-skin 补丁操作。
 *
 * 用法：
 *   node scripts/apply-dev.js status              查看补丁状态
 *   node scripts/apply-dev.js apply <图片> [0.2]  打补丁（不传图片则用占位图）
 *   node scripts/apply-dev.js restore             还原原文件
 *
 * 注意：改动要重启 VS Code 才可见；卸载/关闭请用扩展命令，本工具用于开发验证与手动救援。
 */

const path = require('path');
const fs = require('fs');
const patcher = require('../src/patcher');
const { discoverAppRoots } = require('../src/discover');
const { makePlaceholderPng } = require('./make-placeholder');

const [op, ...rest] = process.argv.slice(2);

function pickAppRoot() {
  for (const appRoot of discoverAppRoots()) {
    const state = patcher.readState(appRoot);
    console.log(`appRoot: ${appRoot}`);
    console.log(`  补丁状态: ${state.patched ? '已打补丁' : '未打补丁'} | 指纹: ${state.fingerprint || '-'} | 备份: ${state.backups.length} 份`);
    return appRoot;
  }
  console.error('未找到 VS Code 安装');
  process.exit(1);
}

function main() {
  if (op === 'status' || !op) {
    pickAppRoot();
    return;
  }
  const appRoot = pickAppRoot();
  if (op === 'restore') {
    const r = patcher.restore(appRoot, console.log);
    console.log('还原结果:', JSON.stringify(r));
    return;
  }
  if (op === 'apply') {
    let imagePath = rest[0];
    const opacity = Number(rest[1]) || 0.18;
    if (!imagePath) {
      imagePath = path.join(__dirname, '..', 'assets', 'placeholder.png');
      if (!fs.existsSync(imagePath)) {
        fs.mkdirSync(path.dirname(imagePath), { recursive: true });
        fs.writeFileSync(imagePath, makePlaceholderPng());
      }
    }
    if (!fs.existsSync(imagePath)) {
      console.error(`图片不存在: ${imagePath}`);
      process.exit(1);
    }
    const r = patcher.applyPatch(
      appRoot,
      { imagePath, opacity, position: 'cover', blur: 0 },
      console.log
    );
    console.log('打补丁结果:', JSON.stringify({ ...r, changed: r.changed?.length }, null, 2));
    return;
  }
  console.error('未知操作:', op);
  process.exit(1);
}

main();
