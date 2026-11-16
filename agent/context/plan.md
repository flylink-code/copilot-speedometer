---
status: active
updated: 2026-11-15
---

# 计划与进度

> 由 Agent 追加维护。只记「在做什么 / 卡在哪 / 下一步」，不记流水账。
> 已完成项一律移出本文件（进归档或删掉），否则下次会被重新排进待办。

## 当前阶段

- 创建 / 实现 / 调试 / 优化 / [x] 归档 —— 当前：**0.2.3 极窄侧栏自适应 + 状态栏仅显示本窗口对话，已提交推送（标签 `v0.2.3`）并安装 VSIX，待上传 Marketplace 后台**

## 当前目标

- 重载窗口核验扩展详情页（默认英文 + 4 张清晰全幅截图），并在 VS Code Marketplace 管理后台上传 `dist/copilot-speedometer-0.2.3.vsix`。

## 进行中

| 事项 | 状态 | 阻塞点 | 负责人 |
| --- | --- | --- | --- |
| 上传 `dist/copilot-speedometer-0.2.3.vsix` 到 Marketplace | 已推送源码与标签，VSIX 就绪 | 本机未配置 `VSCE_PAT`，需登录 Marketplace 网页后台上传 | 用户 |

## 下一步（按优先级）

1. 在当前 VS Code 执行 `Developer: Reload Window`，打开已安装扩展的「细节」页验收（判定：默认显示英文说明，顶部提供 `简体中文` 跳转；4 张截图全幅铺满、无黑框余白与亮白滚动条）。
2. 打开 VS Code Marketplace 发布者后台（`https://marketplace.visualstudio.com/manage/publishers/copilot-speedometer`）上传 `dist/copilot-speedometer-0.2.3.vsix`（判定：商店页面版本显示 `0.2.3`，默认英文且图片完整加载）。
3. 如后续希望命令行一键发布到商店，可配置 `VSCE_PAT` 或添加 GitHub Actions Release 工作流（判定：`npx @vscode/vsce verify-pat copilot-speedometer` 返回成功）。

## 已完成（只留最近 10 条，更早的走归档）

- 0.2.3 极窄侧栏自适应（`ResizeObserver` + xs/xxs 两档、指标卡/按钮/标签自适应）、侧栏顶栏去重复品牌行；状态栏改为只认本窗口会话（`scope.recordStrictlyInWindow`），无本窗口对话时隐藏（2026-11-16）。
- 0.2.2 默认英文 README 与截图修复：将 `README.md` 切为默认英文并配 `README_zh.md` 简体中文版（移除冗余 `README_en.md`）；改用独立 headless Chrome 按精确画幅重拍全部 8 张中英文截图，修复半幅黑边与亮白滚动条，同时调整宽屏 KPI 6 卡单行对称与滚动条主题色（2026-11-15）。
- 0.2.1 状态栏悬停卡片重构：移除多行 Markdown 表格条纹，改为 4 段式单行无框表 + `<hr>` 分隔、首字占比提示/流式解码速度并列、3 列指标格、今日汇总 `k`/`M` 格式化与累计费用、可点击 `command:` 快捷操作栏（2026-11-15）。
- 0.2.0 左侧栏与面板 UI 重构：单行图标顶栏 + 原生 `view/title` 溢出菜单、仪表盘 Hero 主卡 + 2×3 对称指标格 + 均值虚线 + 通栏分组头、会话 Hub 时间分组 + 折叠筛选器 + 窄栏单流钻取（移除双滚动条）+ 结构化详情与分级操作、设置页布尔开关单行右对齐，更新全部中英文预览图（2026-11-15）。
- 0.2.0 增强：会话详情默认折叠、Agent 会话管理（Fork / 移动工作区 / 归档与取消归档 / 删除，含运行锁保护）与面板 UI 状态按窗口持久化（`workspaceState`）（2026-11-14）。
- 0.2.0 追加：左侧栏常驻 `WebviewViewProvider`（`media/sidebar-icon.svg` + 窄屏自适应布局）+ 历史对话打开即回填唤醒，仅自动隐藏右下角状态栏（2026-11-14）。
- 0.2.0：Token 费用估算（`src/pricing.js` + `pricingMultiplier`/`customPricing`）与只读跨工作区会话 Hub（`src/sessions.js` + Hub 视图）（2026-11-14）。
- 0.1.1 补充修复：`setScope` 运行时兜底（`sessionScopeOverride`）+ 面板事件委托，解决未完全重载主进程时「查看所有窗口」静默失败（2026-11-14）。
- 功能扩展①②技术调研落地：`copilot-session-hub.md`、`token-cost-pricing.md`（2026-11-14）。
- 0.1.1：tok/s 按窗口隔离（`src/scope.js` + `sessionScope` 设置 + 面板范围条，2026-11-13）。
- Marketplace 图片修复：去掉 `--no-rewrite-relative-links`，包装脚本先建 `dist/`；vsix 从 72 文件/670 KB 降到 17 文件/73 KB（2026-11-13）。
- 0.4.0：状态栏空闲自动隐藏（`autoHideMinutes`）、图标、改名（提交 `e9f3a9a`）。

## 最后更新

- 2026-11-15 / Gemini（0.2.2 默认英文 README + 全幅截图修复、打包安装与发布推送）
