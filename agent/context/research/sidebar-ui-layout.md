---
status: active
updated: 2026-11-15
topic: VS Code 左侧栏 Webview 信息架构与间距排布规范
---

## 问题

320 px 宽度的 VS Code Primary Sidebar 中，同时塞入顶栏下拉菜单、多行范围提示横幅、7 张奇数双列卡片、以及上下堆叠的双滚动区（会话列表 `max-height: 205px` + 详情阅读器），造成视觉拥挤、孤卡留白、嵌套滚动冲突与操作按钮噪音。如何在纯原生 Webview（零第三方前端框架依赖）前提下做到层级清晰、间距直观？

## 检索词

- `vscode ux guidelines sidebars views webviews`
- `vscode webview ui toolkit deprecation`
- `vscode extension copilot chat history usage analytics sidebar`

## 候选与结论

| 来源 | URL | 日期 | 采纳/否决 | 理由 |
| --- | --- | --- | --- | --- |
| VS Code UX Guidelines — Sidebars & Views | https://code.visualstudio.com/api/ux-guidelines/sidebars · https://code.visualstudio.com/api/ux-guidelines/views | 2026-11-11 | 采纳 | 官方规范：侧边栏使用贴合 `sideBar.background` 的单滚动流、通栏可折叠分组头（Section Header Strip + 计数徽标）与简洁的图标工具栏，次级低频维护操作放入视图 `...` 溢出菜单（`menus["view/title"]`） |
| VS Code UX Guidelines — Webviews | https://code.visualstudio.com/api/ux-guidelines/webviews | 2026-11-11 | 采纳 | 官方规范：全部表面色、边框色与选中态走 `--vscode-*` 主题令牌；窄栏控件避免复杂双栏嵌套 |
| `@vscode/webview-ui-toolkit` 仓库公告 | https://github.com/microsoft/vscode-webview-ui-toolkit | 2025-01-01 | 否决 | 官方已于 2025-01-01 停止维护并归档，引入已弃用依赖违背零运行时依赖原则 |
| Claude-Code-History-VSCode（同类多源会话与用量扩展） | https://github.com/yashagldit/Claude-Code-History-VSCode | 2026-11-06 | 采纳模式（不引代码，MIT） | 成熟做法：会话按时间桶分组（进行中 / 今天 / 昨天 / 近 7 天 / 更早）、窄栏采用「列表 ↔ 单会话钻取（Drill-in）」替代上下双滚、筛选项默认折叠为漏斗按钮 + 激活计数角标 |
| 保留窄栏上下堆叠双滚动区（列表固定 205px + 下方详情） | 本地 0.2.0 初版实测截图 | 2026-11-14 | 否决 | 320×900 视口下会话列表仅能露 2.5 条，内层滚动条与外层页面滚动条互相抢滚轮，信息密度与可读性双输 |

## 结论与落地适配点

1. **顶栏单行化**：左侧 Tab 导航（仪表盘 / 会话 / 设置），右侧仅保留 `↻` 刷新与 `↗` 编辑器标签页弹出两个 24×24 图标按钮，彻底消除顶栏折行；`package.json` 在 `view/title` 溢出菜单提供诊断、导出与清空历史。
2. **仪表盘「1 主卡 + 2×3 对称网格 + 通栏分组头」**：
   - 时间窗口切换改为紧凑分段控件，与窗口范围合并为单行工具条（完整路径收进 Tooltip）。
   - 「最近一次」独立为通栏 Hero 卡（30px 主数值 + 相对时间 + 模型/TTFT），其余 6 项聚合指标组成偶数 2×3 网格（宽屏自动铺为 1×6），消除第 7 张孤卡。
   - 趋势柱状图叠加加权均值虚线；下方「按模型」「最近请求」采用 VS Code 原生风格的通栏 Section Header Strip + 右侧计数徽标，模型行附带输出 Token 占比细条。
3. **会话 Hub「窄栏钻取 + 宽屏双栏」**：
   - `< 600px`（含左侧栏）采用 `mode-list` ↔ `mode-detail` 单流钻取，移除嵌套滚动条；宽屏编辑器标签页自动恢复左右双栏阅读。
   - 列表按「进行中 / 今天 / 昨天 / 近 7 天 / 更早」分组，卡片留出 8px 间距；搜索框右侧用漏斗图标折叠 4 个筛选器并显示激活数量角标。
   - 详情页拆分三层：结构化 `<dl>` 元数据卡片 → 3 列紧凑指标格 → 2×2 常用操作按钮 + 底栏弱化的「管理：移动工作区 / 归档 / 删除」文字链，避免危险按钮与主操作等重。
4. **设置页窄栏对齐**：布尔开关保持 `1fr + auto` 右对齐单行排布，仅路径/JSON/分段项换行展开，纵向空间节省约 35%。
