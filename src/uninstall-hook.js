'use strict';
/**
 * 卸载钩子：VS Code 卸载本扩展时通过 package.json 的 "vscode:uninstall" 脚本调用。
 * 此环境没有 vscode API，纯 Node 尽力而为：扫描常见安装位置，发现 bg-skin 补丁即还原。
 */

const fs = require('fs');
const path = require('path');
const patcher = require('./patcher');
const { discoverAppRoots } = require('./discover');

const PREFIX = '[bg-skin:uninstall]';

for (const appRoot of discoverAppRoots()) {
  try {
    const state = patcher.readState(appRoot);
    if (!state.patched && state.backups.length === 0) continue;
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
    console.log(`${PREFIX} ${appRoot} -> ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`${PREFIX} 失败 ${appRoot}: ${err && err.message}`);
  }
}
