# 交接文档 / Handoff — Copilot Speedometer

> 写给下一个接手的 agent（或未来的我）。读完这份就能继续干活，不需要翻旧对话。
> 最后更新：2026-11-15，对应 **0.2.0 费用估算 + 跨工作区会话 Hub + 常驻左侧栏重构**（0.1.0 为首个公开发布；内部 0.2.x–0.4.0 为预发布版本），分支 `main`。

---

## 1. 产品是什么

一个 VS Code 扩展，把 **GitHub Copilot Chat 的 tokens/second（tok/s）**、TTFT、token 用量、每次请求耗时显示在状态栏和仪表盘里。

- 用户原话（v1）：`vscode copilot 能不能显示t/s` → `能不能做一个插件来看vscode copilot运行状态呢，主要是t/s统计`
- 关键约束（用户 m00236）：**我的模型都是第三方配置到 VS Code Copilot 的（BYOK），你这种方式可以读？** → 必须能读 BYOK，这决定了数据源设计（见 §3）。
- 全部数据来自本地文件：不联网、不上传、不调用 Copilot 私有 API。

## 2. 仓库 / 目录 / 当前状态

| 项 | 值 |
|---|---|
| 仓库 | `git@github.com:flylink-code/copilot-speedometer.git`（分支 `main`） |
| 本地工作区 | `E:\workspace\copilot-speedometer` |
| 版本 | `package.json` → **0.2.0**（费用估算 + 只读跨工作区会话 Hub） |
| 安装方式 | `code --install-extension dist/copilot-speedometer-0.2.0.vsix --force` |
| 已装实例 | `%USERPROFILE%\.vscode\extensions\copilot-speedometer.copilot-speedometer-0.2.0` |
| 未跟踪文件 | `task.md`（用户自己的待办，**不要提交**） |
| 最近提交 | `7ee880d` release 0.1.0 / `661043f` 介绍图 / `304f888` 代码地图 |

提交历史（从旧到新）：`b554013` 初版 → `7eb568b` 仓库元数据 → `26baecc` 面板设置页 → `fc19f6a` 写入作用域修复 → `37d4798` 主开关 → `591d0bb` 中英切换 + 0.3.1 → `e9f3a9a` 自动隐藏 + 图标 + 0.4.0 → `56161e1` 清理。

## 3. 数据源（设计的核心，别改坏）

两个来源，自动合并去重。**A 是主力**，因为它覆盖 BYOK 且带 TTFT。

| | A. Agent usage records | B. Chat debug logs |
|---|---|---|
| 路径 | `%USERPROFILE%\.copilot\session-state\<sessionId>\events.jsonl` | `%APPDATA%\Code\User\globalStorage\github.copilot-chat\debug-logs\<sid>\main.jsonl` |
| 开关 | 无需开关 | 需要 `github.copilot.chat.agentDebugLog.fileLogging.enabled` |
| BYOK | ✅ `isByok:true`, `byokKind`, `providerType` | 只覆盖 Chat 内请求 |
| TTFT | ✅ `timeToFirstTokenMs` / `outputTtftMs` | ❌ 只有 `dur` |
| 事件 | `session.usage_record` | `llm_request` |

A 的字段（实测一行）：`model, modelDisplayName, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, cost, duration(ms), timeToFirstTokenMs, outputTtftMs, interTokenLatencyMs, isByok, byokKind, modelProvider, providerType, apiEndpoint, transport, apiCallId, initiator, interactionType, finishReason, accounting.sourceSessionId, accounting.sequence`。
**注意：没有窗口 id / workspace 标识** → 窗口归属只能靠会话目录的 `workspace.yaml`（`cwd:`）判断，见 §4 `src/scope.js`。

公式：
- `rate = outputTokens / (duration/1000)`（端到端，状态栏用的就是它）
- `decodeRate = (outputTokens-1) / ((duration-ttft)/1000)`，**仅当** `genMs >= 500` 且 `rate <= 3000`，否则 `null`（显示 `—`）
- 去重：`callKey = rawModel|output|round(ts/5000)`，A 优先（保留 TTFT）

实测数据（2026-11-13，本机）：
- 当天 ~700 条，全量回填 ~2246 条、10 个模型，10 个模型的加权平均 ~20.5 tok/s。
- 用户模型全是 `customendpoint/magpie/...`：`GPT-6.1 Sol`、`DeepSeek V4.1 Flash`、`Claude Sonnet 5.5`、`claude-sonnet-5.5 · Kiro` 等。
- 单条最大 input 382942 tokens，最大 TTFT 229 s。
- **早期结论**：569 条 BYOK 记录里 `duration − TTFT` 中位数只有 18 ms（端点一次性返回全文）→ decode rate 永远是 `—`，这不是 bug。**现在已部分改变**：Claude Sonnet 5.5 等会出现 350 ms–1.4 s 的 TTFT 并且 decode rate 有值（如 61.9 tok/s），所以两个指标都要保留。

## 4. 代码结构（全部 CommonJS，无构建、无运行时依赖）

```
src/usage-events.js  207  A 源：UsageScanner.scan()/readNew() 增量 tail，usageToRecord(), parseUsageLine()
src/parser.js        320  B 源：LogScanner（多编辑器根目录 + legacy workspaceStorage），eventToRecord()
src/scope.js         247  按窗口归属：workspace.yaml / workspace.json 的 cwd 匹配、DirMetadataCache
src/stats.js         120  summarize(), groupByModel(), dayKey(), fmtRate/fmtTokens/fmtDur/fmtTime, quantile(), statusBarWanted()
src/settings.js      212  面板设置模型：FIELDS, describe(), coerce(), apply(), writeTarget()
src/i18n.js          404  DICTS{en,zh}（扁平键）、resolve(), create(language)→{locale,dict,t}
src/webview.js       645  html(nonce, cspSource, locale)：Dashboard + Settings 两个视图，内联 CSS/JS，CSP nonce
src/extension.js     917  activate(), 状态栏, 轮询 tick(), 双源合并, buildPayload(), 面板消息, 命令
test/parser.test.js  240  15 项（解析 + stats + statusBarWanted + 旧版 workspaceStorage 归属）
test/usage.test.js   187  11 项
test/scope.test.js   165  12 项（路径归一、cwd 解析、缓存 TTL、过滤规则、多根工作区）
test/settings.test.js 162 12 项（含与 package.json 的默认值/上下限漂移守卫）
test/i18n.test.js    138  9 项（中英键对齐、占位符、源码键覆盖、%key% 覆盖）
tools/preview.js     131  渲染 4 个预览 HTML（中英 × 仪表盘/设置）
tools/smoke-activate.js 376  用 stub 的 vscode API 真跑一遍 activate/tick/面板 payload/设置写入/窗口作用域
tools/make-icon.py    84  生成 media/icon.png（Pillow，超采样）
```

关键实现点，改动时别踩：
- `UsageScanner.readNew(file)` 从字节偏移增量读；**偏移前一个字节必须是 `0x0a`**，否则从 0 重读；首次最多读 8 MB。目录列表缓存 10 s，**缓存 key 必须含 `backfillDays`**（早期只按时间缓存，导致深扫复用了浅列表，599 vs 2139 条）。
- `deepBackfill()` 在切到 7d / all 时触发，总量预算 `DEEP_BUDGET_BYTES = 64MB`，每个文件只读尾部，约 1 秒。`deepLoaded` 保证只做一次。
- `buildPayload(windowKey='today'|'7d'|'all')` → `{agg, models, series(80), requests(200 倒序), setup{loggingEnabled, roots, usageRoots, counts}}`。
- 状态栏：`copilotSpeedometer.statusBarFormat` = `rate` | `rate-model` | `rate-ttft`；可见性由 `stats.statusBarWanted({enabled,statusBar,autoHideMinutes,lastTs,now})` 决定（纯函数，已单测）；`tick()` 每轮都调 `applyStatusBarVisibility()`，所以静默后会自动隐藏。
- 面板消息协议：宿主→面板 `{type:'data'|'settings'|'configResult'|'error'}`；面板→宿主 `{type:'ready'|'tab'|'filter'|'refresh'|'enableLogging'|'setConfig'|'resetConfig'|'browse'|'revealUsageRoot'|'diagnostics'|'exportJson'|'clearHistory'|'openVsCodeSettings'}`。加消息时两边都要改。
- 设置写入：`writeTarget()` 用 `inspect()` 判断，已有 `workspaceValue` 就写 WORKSPACE(2)，否则 GLOBAL(1)（否则用户"改了没反应"）。

## 5. 设置项（16 个，全部可在面板 Settings 页改）

`enabled`(true) · `statusBar`(true) · `autoHideMinutes`(5) · `statusBarFormat`("rate") · `sessionScope`("window") · `logPath`("") · `pollIntervalMs`(2000, 500–60000) · `historySize`(3000, 100–50000) · `backfillDays`(2, 0–365) · `includeLegacyWorkspaceLogs`(true) · `usageEvents`(true) · `usageEventsRoot`("") · `includeVscodeChats`(true) · `pricingMultiplier`(1, 0–100) · `customPricing`({})（另含跨命名空间的 `github.copilot.chat.agentDebugLog.fileLogging.enabled`）。
加字段四步：`settings.js` FIELDS → `package.json` contributes（描述写 `%config.x.description%`）→ 两个 `package.nls*.json` → `src/i18n.js` 的 `field.<key>.label/hint`（中英各一条）。`test/settings.test.js` 的漂移守卫和 `test/i18n.test.js` 会立刻报错，不会漏。

## 6. 本地化（0.3.1 起）

- 运行时文案：`src/i18n.js` 扁平字典 `DICTS.en` / `DICTS.zh`（285 键，中英各 285，前缀 `status.` `diag.` `msg.` `ui.` `section.` `field.`），`{0}` 占位符，缺失回退 en → 键名。
- 面板：宿主把 `{locale, dict}` 传给 `webview.html(nonce, cspSource, locale, isSidebar)`，客户端 `var DICT=…; function t(k)` 查表；HTML 外壳（tab 名等）在 Node 侧用 `tr()` 翻译。
- 清单文案：`package.nls.json` / `package.nls.zh-cn.json` 覆盖 `package.json` 里全部 `%key%`（视图标题 + 命令标题 + 设置描述 + enumDescriptions）。
- 语言来自 `vscode.env.language`（`zh*` → zh，其余 en），改了界面语言要**重载窗口**。
- 动态键（`ui.unit.<unit>`、`ui.seg.<x>`、`field.<key>.label/hint`、`section.<id>.title`）不在字面量扫描范围内，由 `test/i18n.test.js` 的动态键测试兜底。

## 7. 常用命令（都在仓库根目录）

```powershell
npm test                        # 72 项单测：parser 15 + usage 11 + scope 12 + pricing 8 + sessions 4 + settings 13 + i18n 9
node tools/smoke-activate.js    # stub 的 vscode API 跑 activate/tick/面板/窗口作用域/会话Hub；SMOKE_DUMP=1 打诊断全文
node tools/preview.js           # 生成 docs/preview*.html（11 个，含侧边栏窄屏预览）
npm run package                 # 打包到 dist/copilot-speedometer-<ver>.vsix
code --install-extension dist\copilot-speedometer-0.2.0.vsix --force
```

截图（headless Chrome，PNG 约 10 s 后才出现，要轮询）：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --no-sandbox `
  --hide-scrollbars --virtual-time-budget=3000 --window-size=1180,1560 `
  --screenshot=E:\W-AI_WorkSpace\copilot-speedometer\docs\preview-settings-zh.png `
  --user-data-dir=$env:TEMP\chrome-x "file:///E:/W-AI_WorkSpace/copilot-speedometer/docs/preview-settings-zh.html"
```

## 8. 踩过的坑（别再踩）

1. **"只有 t/s 没有数据"**：VS Code 还跑着旧版本，同时存在两个扩展目录 → 删旧目录 + `Developer: Reload Window`。装新版后务必确认只有一个 `local.copilot-speedometer-*` 目录。
2. `vsce package` 必须带 `--allow-missing-repository --no-dependencies`，**不要**加 `--no-rewrite-relative-links`：Marketplace 不会解析 vsix 内的相对图片路径，会显示 alt 文本（曾表现为“只有 dashboard / settings 字样”）。让 vsce 把 README 相对链接改写成 GitHub raw 绝对地址。
3. `.vscodeignore` 必须排除 `dist/**`、`docs/preview*.html`、`tools/**`、`test/**`、`*.vsix`；`media/icon.png` 要**打进去**。
4. 本机 `edit`/`write` 工具偶尔报 `ReplaceFileW EIO (Win32 1175)`（文件被占用）：等 2–3 秒重试，或改用 `pwsh` + Node 脚本写文件。
5. PowerShell `Set-Content` 会写成 CRLF；仓库 `.gitattributes` 是 `* text=auto eol=lf`，git 会归一化，但别惊讶于 warning。
6. 面板 CSS **每个 `--vscode-*` 变量都要有暗色兜底**，否则在浏览器预览和未定义主题下开关/输入框/分隔线会隐形（曾因此以为渲染坏了）。
7. 面板文案有 `t()` 动态拼接时，`test/i18n.test.js` 的 `usedKeys()` 会把 `t('ui.unit.' + u)` 解析成尾随点的前缀，已过滤 `endsWith('.')` 的键。

## 9. 已知限制 / 待办

1. **窗口作用域靠 `cwd` 推断，不是硬边界**（0.1.1 起）：usage 记录没有窗口 id，只能读会话目录的 `workspace.yaml`（老会话读首行 `session.start` 的 `context.cwd`）与本窗口 `workspaceFolders` 比对。已知边界：① 本窗口没打开任何文件夹 → 不做过滤，显示全部；② 同一目录开两个窗口 → 无法区分，两个窗口都会显示（同一项目的两条会话本来也不该分）；③ `cwd` 解析不出来的记录保留而不是丢弃（否则面板会莫名空白）；④ 目录元数据缓存 10 s，新建会话的 `workspace.yaml` 可能滞后一轮轮询。想完全合并时设 `copilotSpeedometer.sessionScope = "all"`。
2. **发布**：publisher 已设为 `copilot-speedometer`；`0.2.0` 已打包为 `dist/copilot-speedometer-0.2.0.vsix` 并推送源码与截图至 GitHub（本机未配置 Marketplace PAT，由维护者在 Marketplace 管理页手动上传 VSIX）；`repository`/`bugs` 指向 GitHub；截图 8 张在 `docs/`；图标 256×256 已就位；`CHANGELOG.md` 逐版本记录（用户明确要求"每次版本更新需要记录更新内容"）。
3. 可选增强：marketplace 用的 GIF 演示、远程/WSL 场景提示、p90 之外的时序图（按天趋势）、把 `task.md` 内容转进 GitHub Issues。
4. 精度口径（README 已写，别再混）：大上下文时"平均吞吐"≈ prefill 速度；非流式端点 TTFT≈总时长；reasoning token 计入 output；跨厂商 tokenizer 不同，tok/s 不完全可比。

## 10. 验证"一切正常"的最小清单

```powershell
npm test                                    # 期望 15/11/12/8/4/13/9 共 72 项全过
node tools/smoke-activate.js                # 期望 "activate smoke passed"，captured > 0
node -e "console.log(require('./src/settings').describe({own:{get:(k,d)=>d,update(){}},copilot:{inspect:()=>({defaultValue:false}),update(){}}}).fields.length)"  # 期望 16
```

面板手测：命令 `Copilot Speedometer: Show Dashboard` → 卡片/柱状图/按模型/最近请求有数；Settings 页改 `Poll interval` 立刻生效且出现 ↻；`Show Diagnostics` 输出通道里能看到 A/B 两个源的根目录与记录数。
