'use strict';
/**
 * 安装位置持久化：扩展运行时把 appRoot 记到用户主目录的隐藏标记文件里，
 * 供卸载钩子使用——钩子运行时扩展已被删除，无法再从 vscode API 拿 appRoot，
 * 而磁盘扫描覆盖不了用户的自定义安装路径（如 E:\editor\vscode）。
 * 这是"卸载必还原"硬保证的最后一环。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MARKER = process.env.BG_SKIN_MARKER || path.join(os.homedir(), '.bg-skin.json');

function saveLastAppRoot(appRoot) {
  try {
    fs.writeFileSync(
      MARKER,
      JSON.stringify({ appRoot, updatedAt: new Date().toISOString() }, null, 2)
    );
    return true;
  } catch (_) {
    return false;
  }
}

function readLastAppRoot() {
  try {
    const appRoot = JSON.parse(fs.readFileSync(MARKER, 'utf8')).appRoot;
    return typeof appRoot === 'string' && appRoot ? appRoot : null;
  } catch (_) {
    return null;
  }
}

/** 标记指向的目录像不像一个 appRoot（有 package.json）。 */
function looksLikeAppRoot(appRoot) {
  try {
    return !!appRoot && fs.existsSync(path.join(appRoot, 'package.json'));
  } catch (_) {
    return false;
  }
}

module.exports = { MARKER, saveLastAppRoot, readLastAppRoot, looksLikeAppRoot };
