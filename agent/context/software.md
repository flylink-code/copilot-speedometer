---
status: active
updated: 2026-11-13
---

# 软件摘要卡

> 只写指针与结论。架构细节留在 `HANDOFF.md` §3–§8，**不要**复制进来。

## 事实源

| 内容 | 路径 | 状态 |
| --- | --- | --- |
| 架构 / 数据源 / 坑 | `HANDOFF.md` §3–§8 | 有效（0.4.0） |
| 面向用户的功能说明 | `README.md` | 有效 |
| 清单与设置定义 | `package.json` | 有效（v0.4.0，`engines.vscode ^1.85.0`） |

## 关键事实

- 技术栈：纯 CommonJS，**无构建、无运行时依赖**；`main = src/extension.js`；`activationEvents = onStartupFinished`。
- 模块（行数为 0.4.0 实测）：
  - `src/extension.js` 824 —— 状态栏、轮询、双源合并、命令、面板消息
  - `src/webview.js` 688 —— Dashboard + Settings 两视图，内联 CSS/JS，CSP nonce
  - `src/i18n.js` 428 —— en/zh 扁平字典（171 键）
  - `src/parser.js` 291 —— B 源 debug-logs 扫描 + 增量 tail
  - `src/usage-events.js` 232 —— A 源 session-state 扫描 + 增量 tail
  - `src/settings.js` 229 —— 面板设置模型（无 vscode 依赖）
  - `src/stats.js` 135 —— 聚合与格式化纯函数
- 数据源（自动合并，A 优先）：
  - A `%USERPROFILE%\.copilot\session-state\<sid>\events.jsonl`，`session.usage_record`，有 BYOK 与 TTFT；
  - B `%APPDATA%\Code\User\globalStorage\github.copilot-chat\debug-logs\<sid>\main.jsonl`，`llm_request`，需开调试日志。
  - 去重键 `callKey = rawModel|output|round(ts/5000)`。
- 协议：宿主→面板 `data|settings|configResult|error`；面板→宿主 `ready|tab|filter|refresh|enableLogging|setConfig|resetConfig|browse|revealUsageRoot|diagnostics|exportJson|clearHistory|openVsCodeSettings`；改一边必须改另一边。
- 设置写入：`writeTarget()` 用 `inspect()` 选择既有 override 的作用域（否则用户“改了没反应”）。
- 加设置字段四步：`settings.js` FIELDS → `package.json` contributes → 两个 `package.nls*.json` → `src/i18n.js`；漂移由测试守卫。

## 已知软件约束

- 只读本地文件，不联网；A 源记录**没有窗口/工作区标识**，状态栏只能按“多久没新回答”隐藏。
- `UsageScanner.readNew` 依赖偏移前一字节为 `0x0a`；目录缓存 key 必须含 `backfillDays`（曾因此漏数据）。
- 非流式端点 `duration − TTFT ≈ 0`，decode rate 判定为不可用是设计行为，不是 bug。
- 面板 CSS 的每个 `--vscode-*` 变量都要有暗色兜底，否则预览/未定义主题下控件隐形。
- 打包：`npm run package`（先 `mkdirSync('dist')`，再 vsce 到 `--out dist`）。**不要**加 `--no-rewrite-relative-links`：vsce 需要把 README 相对图片改写成 GitHub 绝对地址，否则 Marketplace 只显示 alt 文本。`.vscodeignore` 已排除 `agent/`、`doc/`、`docs/`、`task.md` 等内部文件。

## 未决项

- 代码地图尚未生成；需要符号级导航时先跑 `code-map` skill。
- `HANDOFF.md` 记录的本地工作区路径（`E:\W-AI_WorkSpace\...`）与当前检出目录（`E:\workspace\...`）不一致，以当前目录为准。

## 最后更新

- 2026-11-13 / Claude（依据 HANDOFF 0.4.0 与源码行数）
