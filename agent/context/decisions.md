---
status: active
updated: 2026-11-13
---

# 决策索引

> 完整决策写 **`docs/adr/NNNN-slug.md`**（决策 + 上下文 + 后果；Fowler / ADR 约定）。
> 本文件只放**一行索引**和尚未成文的新决策草稿，避免常驻上下文被历史决策撑满。
> 被推翻的决策**不删除**：`status: superseded` + `superseded_by`。**已接受的决策不改写，只 supersede。**
> 新条目加在最上面。

## 索引

| 编号 | 决策 | 状态 | 详情 |
| --- | --- | --- | --- |
| 0008 | 窄栏（`<600px` / 左侧栏）采用单滚动流 + 会话列表/详情钻取切换 + Hero 主卡配对称网格，替代上下双滚动框与孤卡网格；保持零外部 UI 框架依赖 | accepted | `agent/context/research/sidebar-ui-layout.md` |
| 0007 | 会话 Hub 采用纯 JS 只读索引（Agent `events.jsonl` + VS Code `chatSessions/*.jsonl`），不写活窗口 `state.vscdb` / `agent-host.db` | accepted | `agent/context/research/copilot-session-hub.md` |
| 0006 | 模型费用采用离线目录价 + 网关前缀归一化 + 自定义单价/倍率，未命中显示 `--` 不回落默认价 | accepted | `agent/context/research/token-cost-pricing.md` |
| 0005 | 文案跟随 VS Code 显示语言，不单独提供语言设置 | accepted | `CHANGELOG.md`（0.3.1） |
| 0004 | 状态栏按“多久没有新回答”隐藏，不做严格窗口级可见性 | accepted | `HANDOFF.md` §9 限制 1 |
| 0003 | 设置可在面板内修改，并写入已有 override 的作用域 | accepted | `HANDOFF.md` §4 |
| 0002 | 只读本地文件：不联网、不上传、不调用 Copilot 私有 API | accepted | `README.md`「数据来源」 |
| 0001 | 双数据源合并，A（agent usage records）优先，因其覆盖 BYOK 且有 TTFT | accepted | `HANDOFF.md` §3 |

## 草稿（成文后搬进 ADR，这里只留一行）

### 2026-11-13 · 功能扩展先调研再实现

- **决定**：`task.md` 中的会话 hub 与费用统计，先做可行性调研与方案对比，用户确认后再排期。
- **上下文**：两项都可能依赖 Copilot 未公开的本地数据格式，且用户明确要求“先讨论并分析，可以联网查找”。
- **为什么**：避免按猜测实现后发现数据源不可靠，返工成本高于调研成本。
- **放弃的方案 / 代价**：直接照相似插件实现——快，但可能踩到同样的数据口径错误。
- **后果**：影响 `src/usage-events.js` / `src/parser.js` 的数据面；可能新增面板视图。
- **可逆性**：可逆（仅调研，不动代码）。
- **状态**：proposed
