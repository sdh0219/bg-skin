#!/usr/bin/env node
'use strict';
/**
 * bg-skin 开发辅助：只读体检本机 VS Code 安装。
 *
 * 输出：
 *  - 安装目录 / 版本
 *  - workbench 注入目标文件是否存在
 *  - product.json 里 checksums 的键形态（basename 还是相对路径）
 *  - 校验和算法验证（用未改动文件反推 sha1 的编码格式：base64 / hex）
 *  - workbench.html 的 CSP img-src 现状
 *
 * 本脚本只读，绝不写任何文件。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha1(buf, enc) {
  return crypto.createHash('sha1').update(buf).digest(enc);
}

function findInstalls() {
  // 命令行参数优先（inspect-vscode.js "D:\soft\VsCode"）
  const fromArgs = process.argv.slice(2);
  const candidates = [...fromArgs];
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'));
  }
  candidates.push(
    'C:\\Program Files\\Microsoft VS Code',
    'C:\\Program Files (x86)\\Microsoft VS Code',
    'D:\\soft\\VsCode'
  );
  return candidates.filter((p) => fs.existsSync(path.join(p, 'resources', 'app', 'package.json')));
}

function inspectInstall(dir) {
  const appRoot = path.join(dir, 'resources', 'app');
  console.log('='.repeat(70));
  console.log('install dir :', dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  console.log('version     :', pkg.version);

  const targets = {
    css: path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css'),
    'html (electron-sandbox)': path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
    'html (electron-browser)': path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
  };
  for (const [k, p] of Object.entries(targets)) {
    const ok = fs.existsSync(p);
    console.log(`target ${k.padEnd(22)}:`, ok ? `EXISTS (${fs.statSync(p).size} bytes)` : 'missing');
    console.log('   ', p);
  }

  const productPath = path.join(appRoot, 'product.json');
  if (!fs.existsSync(productPath)) {
    console.log('product.json: missing');
    return;
  }
  const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
  const sums = product.checksums || {};
  const keys = Object.keys(sums);
  console.log('checksums   :', keys.length, 'entries');

  // 键形态 + 算法反推：找一个真实存在且能对上的文件
  let solved = false;
  for (const key of keys) {
    const tries = [
      path.join(appRoot, key),
      path.join(appRoot, 'out', key),
      path.join(appRoot, 'out', 'vs', key.replace(/^vs[\\/]/, '')),
    ];
    const fp = tries.find((t) => fs.existsSync(t));
    if (!fp) continue;
    const buf = fs.readFileSync(fp);
    const b64 = (algo) => crypto.createHash(algo).update(buf).digest('base64').replace(/=+$/, '');
    const variants = {
      'sha256-base64-nopad': b64('sha256'),
      'sha1-base64-nopad': b64('sha1'),
      'sha1-base64': sha1(buf, 'base64'),
      'sha1-hex-upper': sha1(buf, 'hex').toUpperCase(),
    };
    const matched = Object.entries(variants).find(([, v]) => v === sums[key]);
    console.log('checksum key sample :', JSON.stringify(key));
    console.log('  file resolved     :', fp);
    console.log('  algorithm match   :', matched ? matched[0] : 'NONE (需人工排查)');
    solved = true;
    break;
  }
  if (!solved) {
    console.log('前 5 个 checksum 键（未能在磁盘上定位对应文件）:');
    keys.slice(0, 5).forEach((k) => console.log('  ', JSON.stringify(k), '=', String(sums[k]).slice(0, 12) + '...'));
  }

  // workbench 相关的键是否被 VS Code 校验
  for (const key of keys) {
    if (/workbench(\.desktop)?\.(html|main\.css)/.test(key)) {
      console.log('  workbench checksum key:', JSON.stringify(key));
    }
  }

  // CSP 现状
  const htmlPath = targets['html (electron-sandbox)'];
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const m = html.match(/Content-Security-Policy[^>]*content="([^"]*)"/);
    if (m) {
      const img = m[1].match(/img-src\s+([^;"']*)/);
      console.log('CSP img-src :', img ? img[1].trim() : '(no img-src directive)');
    } else {
      console.log('CSP meta    : not found');
    }
  }
}

function main() {
  const installs = findInstalls();
  if (installs.length === 0) {
    console.log('未找到 VS Code 安装（检查过 LOCALAPPDATA 与 Program Files）');
    process.exit(1);
  }
  installs.forEach(inspectInstall);
}

main();
