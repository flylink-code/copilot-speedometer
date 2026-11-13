# copilot-speedometer · Agent 主路由

本文件只做**路由**，不放细节。细节在 `agent/` 下按需读取。用户本轮指令优先；分片冲突时以更具体者为准，并在结论里写明依据。

## 0. 每次会话先做三件事

1. 读 `agent/context/plan.md`：现在在哪个阶段、卡在哪、上一步结论是什么。
2. 任务若可能是「以前做过的」→ 先查 `agent/context/archive/ARCHIVE_INDEX.md`，**避免重做已完成的事**。
3. 不熟悉代码 → 按下一节的代码地图定位，不要全仓盲扫。

## 1. 代码地图（所有代码任务必须先做）

- 不知道从哪下手：`node doc/codemap.mjs --map` 或 `doc/codemap/hubs.md`。
- 知道符号名：`node doc/codemap.mjs --find <名字>` → 直接拿 `路径:行号`。
- 知道文件：`node doc/codemap.mjs --outline <文件>`。
- 都没有才走模块页：`doc/CODE_MAP_INDEX.md` → `doc/codemap/<模块>.md`。
- 改完任何代码：`node doc/codemap.mjs` → `--check` 必须零漂移；`doc/CODE_MAP_INDEX.md`、`doc/codemap/**` 禁止手改。
- 本仓全是 CommonJS，引用图只识别 ESM `import`，边数为 0 是已知限制；真实依赖用 `rg "require\("` 确认。详见 `doc/CODE_MAP.md`。

## 2. 阶段路由（工程全流程）

- 创建 / 立项 → `agent/playbooks/10-create.md`
- 实现 / 编码 → `agent/playbooks/20-implement.md`
- 调试 / 定位 → `agent/playbooks/30-debug.md`
- 优化 / 调参 → `agent/playbooks/40-optimize.md`
- 归档 / 交接 → `agent/playbooks/50-archive.md`

## 3. 规则路由（约束，不是流程）

| 需要什么 | 读这里 |
| --- | --- |
| 语言 / 证据分级 / 输出形状 | `agent/rules/00-global.md` |
| 改代码纪律 | `agent/rules/10-code.md` |
| UI 文案 / 注释 / TODO 的措辞（写给谁） | `agent/rules/15-audience.md` |
| 提交 / 分支 / 回滚 | `agent/rules/20-git.md` |
| 写文档 / 摘要卡 | `agent/rules/30-docs.md` |
| 排查铁律 | `agent/rules/40-debug.md` |
| 网上调研（需求 / 选型 / 疑难） | `agent/rules/50-research.md` |
| 归档与状态 | `agent/rules/60-archive.md` |
| 多工程隔离 | `agent/rules/70-isolation.md` |

## 4. 事实卡（摘要 + 指针，正文留在原位）

需求 `agent/context/requirements.md` · 软件 `agent/context/software.md` · 进度 `agent/context/plan.md` · 决策 `agent/context/decisions.md` · 历史 `agent/context/archive/ARCHIVE_INDEX.md` · 调研 `agent/context/research/RESEARCH_INDEX.md` · 硬件 `agent/context/hardware.md`（本工程不适用）。

## 5. 三条硬规则

1. **事实 / 推断 / 假设分开写**，每条结论标证据等级。
2. **每轮收尾给 ≥3 条下一步**，带判定标准；不以「证据不足，无法确定」收尾。
3. **引用任何结论前先确认 `status`**：`archived` / `superseded` 的内容只能当历史背景，**不得当作现状**。

## 6. 预算与维护

本文件 ≤ 60 行（路由预算）；`agent/index.md` ≤ 120 行；单个 rules/playbooks/context 文件 ≤ 200 行。超了拆文件，**不要**继续往主文件里加行。
结构由 `agent-scaffold` 生成；加规则用 `extend`，加新能力用 `skill-author`。
