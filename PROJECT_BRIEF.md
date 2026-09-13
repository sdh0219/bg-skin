# PROJECT_BRIEF：VS Code 自定义背景插件（bg-skin）

> 本文件是新窗口/新会话的交接简报。任务在这份文档所在的目录进行。
> 创建于 2026-09-12，由前一个会话讨论定稿。读完即可开工，无需再向用户确认以下已定事项。

---

## 一、目标（用户原话的工程化表述）

开发一个 VS Code 扩展，让用户**自己选择图片作为编辑器背景**（类似手机自定义壁纸的效果：图片在编辑器内容下方透出，可调透明度），最终目标是**发布到 VS Code 扩展市场**供他人下载。

参考对标（用户已在用）：
- `shalldie.background`（用户当前使用的，状态栏显示 "Background"）
- `AShujiao.background-cover`（整窗壁纸 + 随机轮换风格）

## 二、已定的技术决策

1. **路线：B（背景图注入）**，非纯配色主题。核心机制：扩展激活时定位 VS Code 安装目录的 workbench 核心文件（`resources/app/out/vs/code/.../workbench.html` 或 `workbench.desktop.main.css`），注入背景层 `<div>` + CSS（opacity 约 0.1~0.25 可调），图片路径存用户 `settings.json`。
2. **ZCode 皮肤插件不做**（用户已砍掉）。
3. 本项目独立 git 仓库，与用户的论文项目（`D:\deepLearning\data_of_yuan\1_tem\260727_师兄师姐传承\5_SDH_论文`）完全无关，不要动那个目录。

## 三、必须处理的四件工程事（做不做得上架的分界线）

1. **校验和问题**：改核心文件后 VS Code 会弹"安装似乎已损坏"。方案：联动 `lehni.vscode-fix-checksums` 的做法，自己重算并写回 `product.checksums`，或文档引导用户装修复扩展。
2. **升级自动重打补丁**：VS Code 每次升级覆盖补丁。监听启动，检测注入标记（如 `/* bg-skin-patch */`）丢失则自动重新注入。
3. **卸载/停用恢复原文件**：`deactivate()` 中还原备份的原文件（首次打补丁前先存 `.bg-skin-backup`），否则用户卸载后界面残留异常会被差评。
4. **版本兼容**：不同 VS Code 版本的核心文件路径/结构可能变化，注入逻辑要带探测和失败提示（而不是静默失败）。

## 四、功能清单（MVP → 增强）

**MVP（先做这些）**
- [ ] 命令 `bg-skin: 选择背景图`（文件选择器，支持多选）+ `bg-skin: 关闭背景` + `bg-skin: 调整透明度`
- [ ] settings：`bgSkin.images`（路径数组）、`bgSkin.opacity`（0~1）、`bgSkin.position`（center/cover 等）、`bgSkin.blur`（px）
- [ ] 状态栏按钮（对标 shalldie 的 "Background"）
- [ ] 多显示器/多窗口下工作正常（每个窗口各自打补丁的文件是同一份，注意幂等）

**增强（上架前）**
- [ ] 图库文件夹随机轮换（定时 + 手动切换命令）
- [ ] 预设几套"皮肤"（图+透明度+配色主题组合，一键应用）
- [ ] 状态栏右键菜单
- [ ] 中英双语 README + 截图/GIF（市场页卖相）

## 五、环境与工具

- 系统：Windows 10，Git Bash
- Node 已装：`D:\environment\nodejs_global`（node 在 PATH）
- 用户 VS Code 已安装且在用（自身就是测试环境；改核心文件前务必先备份）
- 开发调试：F5 启动 Extension Development Host
- 打包：`npm i -g @vscode/vsce` → `vsce package` 出 .vsix
- 上架：需要 Azure DevOps 组织 + Publisher ID + PAT（到时引导用户申请）

## 六、目录规划（在本目录内）

```
bg-skin/
├── PROJECT_BRIEF.md      ← 本文件
├── (待生成) package.json / extension.js / README.md / .vscodeignore / LICENSE
└── (可选) themes/        ← 若以后加配色主题
```

## 七、给接手会话的第一步建议

1. `yo code` 不可用的话手写脚手架（package.json + extension.js 即可起步，TypeScript 可选）
2. 先实现"备份 → 注入 → 恢复"三件套的最小闭环，在用户 VS Code 上验证可见
3. 再做命令面板集成和 settings 读取
4. 每一步改动核心文件前，先把原文件备份路径打印到输出通道（Output Channel），出问题能手动救
