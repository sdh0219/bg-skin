'use strict';
/**
 * 在本机磁盘上发现 VS Code（及兼容布局）的 appRoot（resources/app）。
 * 纯 Node，无 vscode API —— 卸载钩子和 CLI 工具共用。
 *
 * 覆盖两类布局：
 *  - 经典：<base>/resources/app
 *  - 哈希目录（新安装器，如 D:\soft\VsCode\<hash>\resources\app）：向下探一层
 */

const fs = require('fs');
const path = require('path');

function* discoverAppRoots() {
  const bases = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'),
    'C:\\Program Files\\Microsoft VS Code',
    'C:\\Program Files (x86)\\Microsoft VS Code',
    'D:\\soft\\VsCode',
  ].filter(Boolean);

  for (const base of bases) {
    const direct = path.join(base, 'resources', 'app');
    if (fs.existsSync(direct)) {
      yield direct;
      continue;
    }
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const nested = path.join(base, e.name, 'resources', 'app');
      if (fs.existsSync(nested)) yield nested;
    }
  }
}

module.exports = { discoverAppRoots };
