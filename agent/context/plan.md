---
status: active
updated: 2026-11-13
---

# 计划与进度

> 由 Agent 追加维护。只记「在做什么 / 卡在哪 / 下一步」，不记流水账。
> 已完成项一律移出本文件（进归档或删掉），否则下次会被重新排进待办。

## 当前阶段

- 创建 / 实现 / 调试 / [x] 优化 / 归档 —— 当前：**优化**（0.4.0 已提交并本地安装，等待发布）

## 当前目标

- 完成 `task.md` 剩余两项（Marketplace 图片问题、功能扩展讨论），产出 0.5.0 的明确范围。

## 进行中

| 事项 | 状态 | 阻塞点 | 负责人 |
| --- | --- | --- | --- |
| Marketplace 介绍图 / 设置图显示异常 | 待定位 | 未复现，需确认是相对路径、尺寸还是缓存问题 | 用户 + Agent |
| 功能扩展①：Copilot 会话管理 hub | 待讨论 | 需调研会话是否可按工作目录聚合、能否稳定读取 | 用户 + Agent |
| 功能扩展②：token 费用统计 | 待讨论 | 需确认 usage record 的 `cost` 字段口径与模型价目来源 | 用户 + Agent |
| 发布 0.4.0 到 Marketplace | 阻塞 | 需用户提供真实 publisher id（现为 `local`） | 用户 |

## 下一步（按优先级）

1. 复现 Marketplace 图片问题：对比 `.vscodeignore` / README 相对路径 / 图片尺寸，给出修复方案（判定：README 在 Marketplace 渲染出图，或明确说明平台限制）。
2. 按 `agent/playbooks/10-create.md` 对两个功能扩展做调研与方案对比，先给结论再动手（判定：每个功能给出“做/不做/怎么做 + 代价”）。
3. 用户确认 publisher id 后跑 `npm run package` 并发布 0.4.0（判定：Marketplace 页面版本 = 0.4.0，状态栏与面板可用）。

## 已完成（只留最近 10 条，更早的走归档）

- 0.4.0：状态栏空闲自动隐藏（`autoHideMinutes`）、图标、改名（提交 `e9f3a9a`）。
- 0.3.1：中英文跟随 VS Code 显示语言（`591d0bb`）。
- 0.3.0：面板内 Settings 页、`statusBarFormat`、写入作用域修复（`26baecc`、`fc19f6a`、`37d4798`）。
- 0.2.3：`Show Diagnostics` 诊断命令。
- 0.2.2：按需深回填 + 目录缓存 key 修复。

## 最后更新

- 2026-11-13 / Claude（依据 `task.md`、`HANDOFF.md` §9、CHANGELOG）
