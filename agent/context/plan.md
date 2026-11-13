---
status: active
updated: 2026-11-13
---

# 计划与进度

> 由 Agent 追加维护。只记「在做什么 / 卡在哪 / 下一步」，不记流水账。
> 已完成项一律移出本文件（进归档或删掉），否则下次会被重新排进待办。

## 当前阶段

- 创建 / 实现 / 调试 / [x] 优化 / 归档 —— 当前：**优化 / 首次发布准备**（0.1.0 已打包，等待用户手动上传）

## 当前目标

- 上传 `dist/copilot-speedometer-0.1.0.vsix` 到 Marketplace，确认介绍图与面板正常。

## 进行中

| 事项 | 状态 | 阻塞点 | 负责人 |
| --- | --- | --- | --- |
| 功能扩展①：Copilot 会话管理 hub | 待讨论 | 需调研会话是否可按工作目录聚合、能否稳定读取 | 用户 + Agent |
| 功能扩展②：token 费用统计 | 待讨论 | 需确认 usage record 的 `cost` 字段口径与模型价目来源 | 用户 + Agent |
| 发布 0.1.0 到 Marketplace | 待上传 | 用户手动上传 `dist/copilot-speedometer-0.1.0.vsix` | 用户 |

## 下一步（按优先级）

1. 用户在 Marketplace 上传 0.1.0（判定：页面版本显示 0.1.0，publisher 为 `copilot-speedometer`）。
2. 上传后复核介绍图（判定：无 `dashboard` / `settings` alt 文本占位）。
3. 按 `agent/playbooks/10-create.md` 对两个功能扩展做调研与方案对比（判定：每个功能给出“做/不做/怎么做 + 代价”）。

## 已完成（只留最近 10 条，更早的走归档）

- Marketplace 图片修复：去掉 `--no-rewrite-relative-links`，包装脚本先建 `dist/`；vsix 从 72 文件/670 KB 降到 17 文件/73 KB（2026-11-13）。
- 0.4.0：状态栏空闲自动隐藏（`autoHideMinutes`）、图标、改名（提交 `e9f3a9a`）。
- 0.3.1：中英文跟随 VS Code 显示语言（`591d0bb`）。
- 0.3.0：面板内 Settings 页、`statusBarFormat`、写入作用域修复（`26baecc`、`fc19f6a`、`37d4798`）。
- 0.2.3：`Show Diagnostics` 诊断命令。
- 0.2.2：按需深回填 + 目录缓存 key 修复。

## 最后更新

- 2026-11-13 / Claude（依据 `task.md`、`HANDOFF.md` §9、CHANGELOG）
