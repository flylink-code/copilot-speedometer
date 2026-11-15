---
status: active
updated: 2026-11-14
topic: Token 获取与内置常用模型费用统计可行性
---

## 问题

能否从本地 Copilot 数据可靠提取 Token 明细，并内置常用模型价目表实现费用统计（同时兼容 BYOK / 自定义端点）？

## 检索词

- `BerriAI/litellm model_prices_and_context_window.json`
- `openrouter.ai/api/v1/models pricing`
- `rajbos/ai-engineering-fluency modelPricing.json validate-model-pricing`

## 候选与结论

| 来源 | URL | 日期 | 采纳/否决 | 理由 |
| --- | --- | --- | --- | --- |
| 本机实测 `events.jsonl`（A 源）+ `session-store.db` | 本机 `~/.copilot/session-state/*/events.jsonl` | 2026-11-14 | 采纳（主数据源） | 已有 `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens`、`model`、`modelDisplayName`、`isByok`；但所有 BYOK 记录里 `cost` 恒为 `0.0` |
| `rajbos/ai-engineering-fluency` | https://github.com/rajbos/ai-engineering-fluency/blob/main/src/modelPricing.json | 2026-11-14 | 采纳（架构参考） | MIT 开源、活跃更新（2026-11）；内置静态价目表 + 区分直接 API 价与 `copilotPricing`；明确指出未命中模型回落到默认价会失真（反面案例） |
| `BerriAI/litellm` 模型价目表 | https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json | 2026-11-14 | 采纳（价格基准源） | MIT 开源、行业事实标准；含 `input_cost_per_token`、`output_cost_per_token`、`cache_read_input_token_cost`、`cache_creation_input_token_cost`、`output_cost_per_reasoning_token` |
| OpenRouter Models API | https://openrouter.ai/api/v1/models | 2026-11-14 | 采纳（新模型核价源） | 实测包含新模型（如 `google/gemini-4-hydrogen`：$1.5/M input、$7.5/M output、$0.075/M cache_read） |

## 结论（标证据等级）

1. **Token 字段已经齐全（事实，本机实测 1750 条）**：现有 `usage-events.js` 只读取了 `inputTokens` / `outputTokens` / `cacheReadTokens`，同一条 `session.usage_record` 里还稳定自带 **`cacheWriteTokens` 和 `reasoningTokens`**（例如 `gemini-4-hydrogen` / `deepseek-v4.1-flash` 均有 `reasoningTokens`），目前尚未解析入库；`cost` 字段对 BYOK 恒为 `0.0`。
2. **自定义端点 / BYOK 模型名必须先做别名归一化（事实，本机实测）**：本机真实模型 ID 形如 `magpie/antigravity/gemini-4-hydrogen`、`magpie/opencode-go/deepseek-v4.1-flash`、`magpie/antigravity/claude-sonnet-5-5`、`AI-Switcher/gpt-6.1-sol`。若直接精确查表必然 100% 失配；必须先剥离供应商/网关前缀（`customendpoint/<gateway>/<provider>/`），再做别名规则匹配与用户自定义覆盖。
3. **严禁对未命中模型静默套用 `gpt-4o-mini` 兜底价（反面案例，`ai-engineering-fluency`）**：`ai-engineering-fluency` 文档承认未命中时回落到 `gpt-4o-mini` 会严重低估 Claude/旗舰模型或高估免费模型；正确做法是「未匹配显示 `--` / `未定价` + 计入待定价提示，允许用户在设置里补充单价（或选按官方目录价估算）」。
4. **费用口径（事实）**：按官方公开目录价做本地估算时，需区分 `未命中缓存输入 (input - cacheRead)` × `inputRate` + `cacheRead` × `cacheReadRate` + `cacheWrite` × `cacheWriteRate` + `output`（含或单列 `reasoning`）× `outputRate`；同时明确标注为「目录参考价估算」，因中转站/套餐折扣与官方按量价不同。

## 与本项目的差异 / 适配点

- 不违反 `DEC-0002`（纯本地不联网）：内置一份精简离线 `pricing.json`（随版本更新）+ 允许用户在 Settings/JSON 中自定义或覆盖单价（含中转站折扣系数 / 免费模型设为 0）。
- **注意本机 `inputTokens` 语义核验**：需确认 A 源的 `inputTokens` 是否已包含 `cacheReadTokens`（即 `uncachedInput = max(0, inputTokens - cacheReadTokens)` 还是两者相加），不同网关/OpenAI vs Anthropic 上报口径可能不同，实现前需用几条带 `cacheReadTokens > 0` 的真实日志核对。

## 未决

- 实现前抽样几条 `cacheReadTokens > 0` 的本机记录，核实 `inputTokens` 与 `cacheReadTokens` 是否重叠（避免缓存输入被算两遍或扣成负）。
- 确认用户更关注「官方目录参考价」还是「按个人中转站倍率/自定义单价表」。
