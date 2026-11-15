# 调研索引

> 一行一个主题。详细记录在同目录 `<主题>.md`。
> 规则见 `agent/rules/50-research.md`：≥3 个独立来源，含官方文档，记录否决理由。

| 主题 | 结论一句话 | 状态 | 日期 | 详情 |
| --- | --- | --- | --- | --- |
| VS Code 左侧栏 Webview 排布与间距规范 | 采用单行图标顶栏、Hero+对称指标格、通栏分组头与窄栏会话钻取（移除嵌套双滚动条）；不引已弃用的 `@vscode/webview-ui-toolkit` | active | 2026-11-15 | `sidebar-ui-layout.md` |
| VS Code Copilot 会话 Hub | 只读聚合+检索可行，直接改写运行中窗口 `state.vscdb`/`agent-host.db` 会被覆盖或损坏 | active | 2026-11-14 | `copilot-session-hub.md` |
| Token 获取与模型费用统计 | A 源已带全部 token 明细（含 `cacheWrite`/`reasoning`），需前缀归一化 + 离线价目表 + 用户自定义覆盖 | active | 2026-11-14 | `token-cost-pricing.md` |
| （示例）600 Mbps 下的收尾超时处理 | 官方建议用超时兜底 + 状态机复位 | active | 2026-11-13 | `600mbps-dq-timeout.md` |

## 状态说明

- `active`：结论仍适用
- `stale`：超过 12 个月未复核，或依赖的版本已变，引用前须复核
- `superseded`：被新调研取代，读 `superseded_by`

## 维护

- 新增主题：在 `agent/rules/50-research.md` 的模板下建文件，回来加一行。
- 引用前：先看状态与日期；`stale` 直接当现状用是常见错误。
