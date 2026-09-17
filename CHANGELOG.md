# Changelog

## 0.2.2 (2026-09-15)

图库与 overlay 体验：

- 新增 `bgSkin.imageFolder`：指定图库文件夹后，「随机切换」自动扫描文件夹
- 新增 `bgSkin.rotateOnStartup`：每次启动从图库随机换一张（换图后需重载窗口）
- 新增命令 `bgSkin.selectFolder`「选择图库文件夹」
- 新增 `bgSkin.overlayOpacity`：overlay 覆盖层独立透明度（默认 0.08），不再与 behind 共用 opacity
- 启动指纹按模式取对应透明度，避免 behind/overlay 切换后误判无需重载

## 0.2.1 (2026-09-15)

稳定性加固 + 可用性：

- meta 记录 `originalChecksum`（备份时机 product.json 原厂值）；还原时优先写回，不再依赖已污染的存量哈希反推算法
- 首次改写及 VS Code 升级时备份 `product.json`；剥离还原且 meta 缺失时从该备份整份恢复校验和
- CSP 改用独立标记 `<!-- bg-skin-csp-start -->`：上游自带 `img-src file:` 时不插入、还原不误删；`isPatched` 不再把上游 `file:` 当成我方痕迹
- 卸载钩子：校验 persist 路径、清理 `~/.bg-skin.json` 与 product.json 残留备份
- `discover.js` 移除开发机硬编码路径，改用 `ProgramFiles` 环境变量并去重
- 识别 EPERM/EACCES：系统级安装时提示以管理员运行一次 VS Code，不再只显示笼统失败
- 启动同步/应用前检查背景图是否仍存在，缺失时明确提示重新选图
- 沙箱测试扩至 18 项（新增：剥离还原校验和回原厂、上游 file: 不误伤、极端丢失不猜测、meta 原厂值优先）

## 0.2.0 (2026-09-14)

- 版本兼容加固：校验和算法自动探测（sha256/sha1 世代）+ 元数据记忆兜底，识别不了则跳过重写并提示（绝不写错格式触发"安装损坏"）
- 注入目标目录扫描兜底（核心文件改名/布局漂移时仍可注入）
- 新增 overlay 覆盖层背景模式：不依赖 VS Code 内部类名，behind 模式因 DOM 变更失效时的保底（命令 + `bgSkin.mode` 设置）
- 卸载钩子可靠化：运行期持久化 appRoot 到 `~/.bg-skin.json`，自定义安装路径的用户卸载后也能自动还原
- 新增命令 `bgSkin.mode`；README 增加版本兼容策略与手动救援章节
- 沙箱测试扩至 15 项

## 0.1.0 (2026-09-13)

- 首个 MVP：选图（可多选）/ 透明度 / 模糊 / 位置 / 状态栏菜单
- 工程化：校验和重写、升级自动重打补丁、卸载还原、版本探测与失败提示
