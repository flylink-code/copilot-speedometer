---
status: active
updated: 2026-11-15
---

# 软件摘要卡

> 只写指针与结论。架构细节留在 `HANDOFF.md` §3–§8，**不要**复制进来。

## 事实源

| 内容 | 路径 | 状态 |
| --- | --- | --- |
| 架构 / 数据源 / 坑 | `HANDOFF.md` §3–§8 | 有效（0.2.0） |
| 面向用户的功能说明 | `README.md` | 有效 |
| 清单与设置定义 | `package.json` | 有效（v0.2.0，`engines.vscode ^1.85.0`） |

## 关键事实

- 技术栈：纯 CommonJS，**无构建、无运行时依赖**；`main = src/extension.js`；`activationEvents = onStartupFinished`。
- 模块（行数为 0.2.0 实测）：
  - `src/webview.js` 1570 —— Dashboard + 会话 + Settings 三视图（单行顶栏、Hero+对称指标格、窄栏会话钻取、宽屏表格/分栏），内联 CSS/JS，CSP nonce
  - `src/extension.js` 1517 —— 状态栏、轮询、历史会话即时唤醒、双源合并、窗口作用域、左侧栏 ViewProvider + 标签页命令、会话管理动作与 `uiState` 持久化
  - `src/sessions.js` 1003 —— 跨工作区会话只读索引、对话详情解析（Agent + VS Code Chat）与 Agent 会话 Fork / 移动 / 安全删除
  - `src/i18n.js` 660 —— en/zh 扁平字典（285 键）
  - `src/parser.js` 324 —— B 源 debug-logs 扫描 + 增量 tail
  - `src/settings.js` 269 —— 面板设置模型（16 项，无 vscode 依赖）
  - `src/scope.js` 247 —— 按窗口归属过滤（cwd 匹配 + 目录元数据缓存）
  - `src/pricing.js` 245 —— 离线模型价目表、网关前缀归一化与费用估算
  - `src/usage-events.js` 242 —— A 源 session-state 扫描 + 增量 tail
  - `src/stats.js` 167 —— 聚合与格式化纯函数
- 数据源（自动合并，A 优先）：
  - A `%USERPROFILE%\.copilot\session-state\<sid>\events.jsonl`，`session.usage_record`，有 BYOK 与 TTFT；
  - B `%APPDATA%\Code\User\globalStorage\github.copilot-chat\debug-logs\<sid>\main.jsonl`，`llm_request`，需开调试日志。
  - 去重键 `callKey = rawModel|output|round(ts/5000)`。
- 协议：宿主→面板 `uiState|data|sessions|sessionDetail|settings|configResult|error`；面板→宿主 `ready|saveUiState|tab|filter|refresh|openTab|setScope|sessionDetail|copyResume|resumeInTerminal|openSessionFolder|forkSession|moveSession|archiveSession|unarchiveSession|deleteSession|enableLogging|setConfig|resetConfig|browse|revealUsageRoot|diagnostics|exportJson|clearHistory|openVsCodeSettings`；改一边必须改另一边。
- 设置写入：`writeTarget()` 用 `inspect()` 选择既有 override 的作用域（否则用户“改了没反应”）。
- 加设置字段四步：`settings.js` FIELDS → `package.json` contributes → 两个 `package.nls*.json` → `src/i18n.js`；漂移由测试守卫。

## 已知软件约束

- 只读本地文件，不联网；A 源记录**没有窗口/工作区标识**，窗口归属靠会话目录 `workspace.yaml` 的 `cwd`（老会话读 `session.start`）与 `workspaceFolders` 比对，见 `src/scope.js`。
- 作用域推断的边界（不是硬边界）：本窗口没开文件夹 → 不过滤；同目录两窗口 → 无法区分；cwd 解析失败 → 保留记录；目录元数据缓存 10 s。`copilotSpeedometer.sessionScope = "all"` 可关闭过滤。
- `UsageScanner.readNew` 依赖偏移前一字节为 `0x0a`；目录缓存 key 必须含 `backfillDays`（曾因此漏数据）。
- 非流式端点 `duration − TTFT ≈ 0`，decode rate 判定为不可用是设计行为，不是 bug。
- 面板 CSS 的每个 `--vscode-*` 变量都要有暗色兜底，否则预览/未定义主题下控件隐形。
- 打包：`npm run package`（先 `mkdirSync('dist')`，再 vsce 到 `--out dist`）。**不要**加 `--no-rewrite-relative-links`：vsce 需要把 README 相对图片改写成 GitHub 绝对地址，否则 Marketplace 只显示 alt 文本。`.vscodeignore` 已排除 `agent/`、`doc/`、`docs/`、`task.md` 等内部文件。

## 未决项

- 无。

## 最后更新

- 2026-11-15 / Gemini（0.2.0 发布前同步模块行数与消息协议）
