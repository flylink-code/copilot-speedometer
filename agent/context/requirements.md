---
status: active
updated: 2026-11-15
---

# 需求摘要卡

> 只写指针与结论。正文留在原位，**不要**复制进来。

## 事实源

| 版本 | 路径 | 状态 |
| --- | --- | --- |
| 用户待办（当前） | `task.md` | 有效（优化 1、问题修复、功能扩展 1–2 均已在 0.1.1 / 0.2.0 实现） |
| 交接说明（当前） | `HANDOFF.md` | 有效（对应公开发布 0.2.2） |
| 用户 / 安装说明 | `README.md`（默认英文）、`README_zh.md`（简体中文） | 有效 |
| 版本变更 | `CHANGELOG.md` | 有效（用户要求每版必记） |

## 当前结论

- 产品：VS Code 扩展，显示 GitHub Copilot Chat 的 **tok/s**、TTFT、token 用量、单次耗时与离线估算费用（右下角状态栏 + 常驻左侧栏 + 可选宽屏标签页），并提供跨工作区只读 **会话 Hub** 与 Agent 会话管理。
- 范围边界：只读**本地** Copilot 记录文件（Agent 会话管理仅在用户主动触发 Fork / 移动 / 删除且校验无运行锁时操作）；不联网、不上传、不调用 Copilot 私有 API。
- 硬约束：**必须覆盖 BYOK / 自定义端点**（用户 m00236 原话），这决定了 A 源（agent usage records）为主力。
- 指标口径（三个数不许混用，详见 `README.md` 精度一节）：
  - `rate = outputTokens / (duration/1000)`，端到端，状态栏默认；
  - `decodeRate = (outputTokens-1) / ((duration-ttft)/1000)`，仅在 `genMs >= 500` 且 `rate <= 3000` 时有效；
  - TTFT 仅 A 源有；非流式端点 TTFT ≈ 总耗时，decode rate 显示 `—` 属正常。
- 验收：`npm test` 72 项全过 + `node tools/smoke-activate.js` 通过 + 面板手测（见 `HANDOFF.md` §10）。

## 未决项

- 状态栏是否要更严格的“仅本窗口”语义（失焦即隐藏）——需用户拍板，见 `HANDOFF.md` §9 限制 1。
- Marketplace 上传：publisher `copilot-speedometer`，本机未配置 `VSCE_PAT`，`dist/copilot-speedometer-0.2.2.vsix` 待维护者在 Marketplace 管理后台手动上传。

## 最后更新

- 2026-11-15 / Gemini（同步 0.2.0 发布状态、会话 Hub 与费用统计落地结论）
