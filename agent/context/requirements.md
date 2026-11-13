---
status: active
updated: 2026-11-13
---

# 需求摘要卡

> 只写指针与结论。正文留在原位，**不要**复制进来。

## 事实源

| 版本 | 路径 | 状态 |
| --- | --- | --- |
| 用户待办（当前） | `task.md` | 有效（优化 1–4 已实现；问题修复与功能扩展未完成） |
| 交接说明（当前） | `HANDOFF.md` | 有效（对应 0.4.0） |
| 用户 / 安装说明 | `README.md`、`README_en.md` | 有效 |
| 版本变更 | `CHANGELOG.md` | 有效（用户要求每版必记） |

## 当前结论

- 产品：VS Code 扩展，显示 GitHub Copilot Chat 的 **tok/s**、TTFT、token 用量、单次耗时（状态栏 + 面板）。
- 范围边界：只读**本地** Copilot 记录文件；不联网、不上传、不调用 Copilot 私有 API。
- 硬约束：**必须覆盖 BYOK / 自定义端点**（用户 m00236 原话），这决定了 A 源（agent usage records）为主力。
- 指标口径（三个数不许混用，详见 `README.md` 精度一节）：
  - `rate = outputTokens / (duration/1000)`，端到端，状态栏默认；
  - `decodeRate = (outputTokens-1) / ((duration-ttft)/1000)`，仅在 `genMs >= 500` 且 `rate <= 3000` 时有效；
  - TTFT 仅 A 源有；非流式端点 TTFT ≈ 总耗时，decode rate 显示 `—` 属正常。
- 验收：`npm test` 44 项全过 + `node tools/smoke-activate.js` 通过 + 面板手测（见 `HANDOFF.md` §10）。

## 未决项

- 功能扩展是否做、怎么做（用户要求先讨论 + 联网调研）：① Copilot 会话管理 hub；② 读取 token 数据做模型费用统计。见 `task.md`「功能扩展」。
- 状态栏是否要更严格的“仅本窗口”语义（失焦即隐藏）——需用户拍板，见 `HANDOFF.md` §9 限制 1。
- 发布前 publisher id（现为 `local`）由用户提供。
- Marketplace 介绍图显示异常（`task.md`「问题修复」）尚未定位。

## 最后更新

- 2026-11-13 / Claude（依据 HANDOFF 0.4.0、task.md、README、CHANGELOG）
