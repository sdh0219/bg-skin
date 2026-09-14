# bg-skin — 自定义编辑器背景

选择你自己的图片作为 VS Code 编辑器背景（类似手机壁纸：图片在编辑器内容下方透出），支持透明度 / 模糊 / 位置调节。对标 `shalldie.background` 与 `AShujiao.background-cover`。

> **English** | Pick your own local images as the VS Code editor background, with opacity / blur / position control. The extension patches VS Code's workbench files and keeps checksums consistent, restores originals on uninstall, and re-applies the patch automatically after VS Code upgrades.

## 工作原理与安全设计

VS Code 没有官方的背景 API，本扩展采用社区通行方案：向安装目录的 workbench 样式文件注入一小段 CSS。为此它做了四件别人容易漏掉的工程事：

1. **校验和**：打补丁后自动重写 `product.json` 的 `checksums`（sha256），VS Code 不会再弹"安装似乎已损坏"。
2. **升级自愈**：VS Code 每次升级会覆盖补丁。扩展启动时检测注入标记丢失即自动重新注入。
3. **卸载还原**：首次改动前先备份原文件（`*.bg-skin-backup` + 元数据）。卸载时通过 `vscode:uninstall` 钩子自动还原；`deactivate` 里有兜底检测；也可随时手动执行 `bg-skin: 恢复原状`。
4. **版本兼容**：注入点按优先级探测（`workbench.desktop.main.css` → 旧版 `workbench.html`），找不到时明确报错，绝不静默失败。

所有操作都会记录到输出面板的 **bg-skin** 通道（含每个备份文件的绝对路径，出问题可手动救）。

## 命令（Ctrl+Shift+P）

| 命令 | 说明 |
| --- | --- |
| `bg-skin: 背景设置菜单` | 快捷菜单（状态栏右下角 Background 按钮同款） |
| `bg-skin: 选择背景图（可多选）` | 文件选择器选图，当前显示第一张 |
| `bg-skin: 随机切换背景图` | 从已选图片中随机轮换 |
| `bg-skin: 调整背景透明度` | 0.02~1，越大越明显，建议 0.1~0.25 |
| `bg-skin: 调整背景模糊` | 毛玻璃效果（px） |
| `bg-skin: 调整背景位置/尺寸` | cover / contain / center |
| `bg-skin: 切换背景模式（底层/覆盖层）` | 见下方"版本兼容策略" |
| `bg-skin: 开启 / 关闭背景` | 关闭即还原核心文件 |
| `bg-skin: 恢复原状` | 一键还原所有被修改的文件（卸载前建议先执行） |

## 设置（settings.json）

```jsonc
{
  "bgSkin.enabled": true,
  "bgSkin.images": ["D:/图库/壁纸.png"],   // 多选后自动写入
  "bgSkin.opacity": 0.18,
  "bgSkin.blur": 0,
  "bgSkin.position": "cover",
  "bgSkin.mode": "behind"
}
```

改完设置需要**重载窗口**生效（扩展会弹提示按钮，一键重载）。

## 版本兼容策略（"VS Code 升级后还有效吗？"）

本扩展按纵深防御设计，任何一层失效都有下一层兜底：

1. **升级自愈**：VS Code 升级覆盖核心文件后，注入标记丢失，扩展下次启动自动重新打补丁。
2. **注入目标扫描**：优先认已知文件名（`workbench.desktop.main.css`），找不到就扫描目录取主样式包；老版本的 `workbench.html` 内联路径同样按优先级 + 目录扫描兜底。
3. **校验和算法自动探测**：新版本是 sha256、老版本是 sha1 世代，扩展在备份时机（文件必为原版）反推本机算法并记入元数据；还原时即使存量校验和已是自己重写过的值也能正确回归原厂。完全识别不了时跳过重写并提示用 `lehni.vscode-fix-checksums` 修复，**绝不猜格式乱写**。
4. **双模式保底**：
   - `behind`（默认）：图在编辑器内容下方透出，效果最佳，依赖 VS Code 内部 CSS 类名；
   - `overlay`：低透明度覆盖整窗的"水印"模式，**不依赖任何内部类名**——即使未来 VS Code 改了 DOM 结构导致 behind 看不到图，切到 overlay 依然有效。

边界说明：如果 VS Code 大改到连 CSS 都无法注入（如核心文件位置彻底重构），需要扩展发新版本跟进——这是一切同类扩展的共同边界。但下一条保证没有例外：

## "随时回到默认背景"的保证

任何情况下你都不会被锁死在壁纸状态，共五条退路：

1. 命令 `bg-skin: 开启 / 关闭背景`（或状态栏菜单里的"恢复原状"）；
2. 设置 `bgSkin.enabled: false`，下次启动自动还原；
3. 卸载扩展时 `vscode:uninstall` 钩子自动还原（含自定义安装路径，运行期已记录位置）；
4. `deactivate` 兜底检测；
5. **手动救援**（扩展彻底进不去时的终极手段）：所有备份与被改文件同目录、后缀 `.bg-skin-backup`，把备份复制/改名回原文件名即可回到原厂状态，再把 `product.json` 里对应键删掉或用 fix-checksums 修复。

每次改动核心文件的备份绝对路径都会打印到输出面板（Output → bg-skin），出问题可按图索骥。

## 安装（开发阶段）

```
npm i -g @vscode/vsce
vsce package          # 生成 bg-skin-0.1.0.vsix
code --install-extension bg-skin-0.1.0.vsix
```

调试：F5 启动 Extension Development Host（宿主与正式版共用同一份核心文件，补丁行为完全一致）。

## 开发

```
npm test                        # 沙箱测试：全流程验证补丁引擎，不碰真实 VS Code
node scripts/inspect-vscode.js  # 只读体检本机安装（版本/注入点/校验和格式/CSP）
node scripts/apply-dev.js status|apply|restore   # CLI 直接操作（开发与救援用）
```

技术要点（新版本 VS Code 实测，1.119.1）：

- 注入目标：`resources/app/out/vs/workbench/workbench.desktop.main.css`（尾部追加标记块）；CSP 放行需改 `out/vs/code/electron-browser/workbench/workbench.html` 的 `img-src` 增加 `file:`。
- 校验和：`product.json → checksums`，键为相对 `out/` 的 POSIX 路径；算法按版本自动探测（1.119 实测 sha256-base64-去尾`=`，旧版为 sha1 世代）。
- 背景层：`body::after`（behind 模式 `z-index: -1` 在内容之下并透明化容器；overlay 模式 `z-index: 99998` 置顶水印），标签页、标题栏、弹窗在 behind 模式下保留原配色保证可读性。

## Roadmap

- [x] MVP：选图（多选）/ 透明度 / 模糊 / 位置 / 状态栏 / 升级自愈 / 卸载还原
- [ ] 图库文件夹定时轮换
- [ ] 预设"皮肤"（图 + 透明度 + 主题一键应用）
- [ ] 状态栏右键菜单
- [ ] 中英双语 README + 市场截图

## 已知限制

- 每次修改设置需重载窗口（核心文件注入方案的固有代价，同类扩展均如此）。
- 需要对 VS Code 安装目录的写权限；系统级安装（Program Files）可能需要管理员运行一次。
- 图片被移动/删除后背景会消失（扩展会警告），重新选择即可。

## License

MIT
