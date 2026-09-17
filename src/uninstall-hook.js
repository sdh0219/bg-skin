'use strict';
/**
 * 卸载钩子：VS Code 卸载本扩展时通过 package.json 的 "vscode:uninstall" 脚本调用。
 * 此环境没有 vscode API，纯 Node 尽力而为：扫描常见安装位置，发现 bg-skin 补丁即还原。
 */

const fs = require('fs');
const path = require('path');
const patcher = require('./patcher');
const { discoverAppRoots } = require('./discover');
const persist = require('./persist');

const PREFIX = '[bg-skin:uninstall]';

// 磁盘扫描 + 运行期记录的自定义安装位置（扩展运行时写入 ~/.bg-skin.json）
const candidates = [...discoverAppRoots()];
const persisted = persist.readLastAppRoot();
if (persisted && persist.looksLikeAppRoot(persisted) && !candidates.includes(persisted)) {
  console.log(`${PREFIX} 发现运行期记录的安装位置: ${persisted}`);
  candidates.push(persisted);
}

for (const appRoot of candidates) {
  try {
    const state = patcher.readState(appRoot);
    if (!state.patched && state.backups.length === 0) {
      // 即使无补丁，也清掉可能残留的 product.json 备份
      const pb = path.join(appRoot, 'product.json') + patcher.BACKUP_SUFFIX;
      if (fs.existsSync(pb)) {
        fs.unlinkSync(pb);
        console.log(`${PREFIX} 清理 product.json 残留备份: ${pb}`);
      }
      continue;
    }
    const result = patcher.restore(appRoot, (m) => console.log(`${PREFIX} ${m}`), {
      cleanBackups: true,
    });
    // 已还原但仍留着备份的（上次还原后残留）：直接清掉
    if (!state.patched && state.backups.length) {
      for (const b of state.backups) {
        for (const junk of [b, b.replace(patcher.BACKUP_SUFFIX, patcher.META_SUFFIX)]) {
          try { fs.unlinkSync(junk); } catch (_) { /* 忽略 */ }
        }
      }
      console.log(`${PREFIX} 清理残留备份: ${state.backups.length} 份`);
    }
    // product.json 备份兜底清理（restore --cleanBackups 已删，这里防漏）
    const pb = path.join(appRoot, 'product.json') + patcher.BACKUP_SUFFIX;
    try { fs.unlinkSync(pb); } catch (_) { /* 忽略 */ }
    console.log(`${PREFIX} ${appRoot} -> ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`${PREFIX} 失败 ${appRoot}: ${err && err.message}`);
  }
}

// 卸载后清掉安装位置标记，避免留下无用隐藏文件
try {
  fs.unlinkSync(persist.MARKER);
  console.log(`${PREFIX} 已清理安装位置标记: ${persist.MARKER}`);
} catch (_) { /* 不存在则忽略 */ }