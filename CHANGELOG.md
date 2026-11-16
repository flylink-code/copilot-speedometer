# Changelog

## 0.2.3 — Slim side bar layout & window-accurate status bar

- **Status bar only shows this window's own conversation (`src/scope.js`, `src/extension.js`)**:
  - A window with no Copilot conversation of its own no longer shows another
    window's tok/s: the item stays hidden until a session whose working
    directory belongs to this window has records or activity. Records with an
    unknown origin, and folder-less windows, no longer count for the status bar
    (the panel keeps its lenient scoping so it is never mysteriously empty).
- **Side bar header (`src/webview.js`)**: removed the duplicated brand row (the
  native view title already names the view); tabs now fill the header height
  and line up with the action icons.
- **Side bar follows its width (`src/webview.js`)**:
  - Layout is recomputed with a `ResizeObserver`, so dragging the side bar
    edge updates the view immediately.
  - Two extra-slim tiers (< 260 px, < 190 px) tighten padding, hide the brand
    text and the "open in editor" button, and make the tabs scrollable instead
    of overlapping.
  - KPI cards pick their column count from the available width; the time
    window buttons fill the row (stacked when extremely slim); scope text,
    hero subtitle and chart legend wrap; long section titles and buttons
    truncate with an ellipsis. KPI cards gained hover titles.
## 0.2.2 — English default README & crisp README screenshots

- **Bilingual README defaults (`README.md`, `README_zh.md`)**:
  - Makes English the default extension overview (`README.md`, shown by VS Code
    and the Marketplace) with a top language switch to `README_zh.md`
    (Simplified Chinese), replacing the previous `README_en.md` split.
- **Documentation & screenshot fixes (`docs/preview*.png`, `tools/preview.js`, `src/webview.js`)**:
  - Re-captured all 8 English/Chinese screenshots (`preview*.png`,
    `preview-sidebar*.png`, `preview-sessions*.png`, `preview-settings*.png`)
    via headless Chrome at exact frame dimensions — eliminating the half-width
    viewport padding and bright white native scrollbars present in the earlier
    captures.
  - Tuned `.kpis` wide-grid column sizing (`minmax(130px, 1fr)`) so all 6 KPI
    cards align in a single row on wide tabs without an orphan card, and styled
    scrollbars using `--vscode-scrollbarSlider-*` theme tokens.
  - Enabled `detailOpen` in wide Sessions Hub previews so the conversation
    pane renders its full turn breakdown in the showcase screenshot.

## 0.2.1 — redesigned status-bar hover card

- **Status-bar hover tooltip overhaul (`src/extension.js`, `src/i18n.js`)**:
  - Replaces the stripe-heavy 7-row Markdown table with a structured 4-section
    hover card using single-row borderless tables, native `<hr>` section rules,
    and VS Code sanitizer-compliant theme colors (`--vscode-charts-blue`,
    `--vscode-descriptionForeground`).
  - Header shows current window scope and relative freshness (`本窗口 · 刚刚`).
  - Hero row highlights end-to-end `tok/s` alongside streaming **decode rate**
    when available, or a `({0}% TTFT wait)` / `（首字占 {0}%）` indicator when
    prefill or a non-streaming endpoint accounts for ≥80% of wall time, paired
    with right-aligned per-request cost.
  - Compact 3-column metric row groups **Duration / TTFT**, **Input / cache hit
    rate**, and **Output tokens** (with reasoning token count when present).
  - Summary row aggregates **Today's** scoped requests (falling back to the last
    20 when today has none), formats output token totals with `k`/`M` suffixes
    instead of raw integers, and displays cumulative USD cost.
  - Bottom action bar adds clickable `command:` links (**Sidebar**, **Editor
    tab**, **Refresh**) directly inside the hover popup.

## 0.2.0 — cost estimation & read-only Sessions Hub

Two major additions built on top of the local session stores (still zero network
calls, zero external runtime dependencies):

- **Model cost estimation (`src/pricing.js`)**:
  - Parses `cacheWriteTokens` and `reasoningTokens` alongside `inputTokens`,
    `outputTokens` and `cacheReadTokens` from `session.usage_record`.
  - Ships an offline catalog of USD per-1M token rates (Claude, GPT / o-series,
    Gemini, DeepSeek, GLM, Qwen) with gateway/vendor prefix normalization for
    BYOK / custom endpoints (`customendpoint/...`, `magpie/...`, `:free`).
  - Unmatched models report `--` instead of silently falling back to a wrong
    default price.
  - Adds an **Est. cost** card on the dashboard, **Cost** columns in the
    by-model and recent-request tables, cost in the status-bar tooltip, plus
    `copilotSpeedometer.pricingMultiplier` and `copilotSpeedometer.customPricing`.
- **Read-only cross-workspace Sessions Hub (`src/sessions.js`)**:
  - New **Sessions** tab inside the panel indexing both Agent/CLI sessions
    (`~/.copilot/session-state/*/events.jsonl`) and local VS Code Chat sessions
    (`workspaceStorage/*/chatSessions/*.jsonl`), with PID-verified `LIVE` badges.
  - Search by title, project, branch or model; filter by window scope, source,
    or project; read the full turn-by-turn conversation (prompts, tool-call
    chips, assistant replies, per-turn tok/s & cost) inside the panel without
    opening a new VS Code window.
  - Safe actions: **Resume in terminal** (`copilot --resume=<id>`), **Copy
    resume cmd**, and **Open folder** (never writes to live `state.vscdb` or
    `agent-host.db`).
  - New `copilotSpeedometer.includeVscodeChats` setting.
- **Persistent left sidebar (`copilotSpeedometer.sidebarView`)**:
  - Registers an Activity Bar container + WebviewViewProvider so Dashboard,
    Sessions Hub and Settings live permanently in the VS Code left sidebar
    without opening a new editor tab on click.
  - Clicking the bottom-right status bar focuses the sidebar (`showDashboard`);
    an optional header `↗` button (`openTab`) pops out an editor tab when desired.
  - Responsive narrow-sidebar layout across Dashboard, Sessions, and Settings:
    - Single-row sticky header with tabs and compact icon actions (`↻` refresh,
      `↗` open in editor tab), plus native `view/title` overflow commands.
    - Dashboard pairs a full-width **Last response** hero card with an even
      2×3 KPI grid (1×6 in wide tabs), a single-row time/scope toolbar, a
      dashed weighted-average line on the bar chart, full-bleed collapsible
      pane headers with count badges, and output-share bars per model.
    - Sessions Hub uses single-scroll list-to-detail drill-in on narrow widths
      (side-by-side split in wide tabs), time-bucket grouping (*Running / Today
      / Yesterday / Previous 7 days / Older*), a collapsible filter drawer with
      active-filter badge, structured `<dl>` metadata, and separated primary vs
      management actions.
    - Settings keeps boolean switches right-aligned on a single row in the
      sidebar while stacking path/JSON inputs cleanly.
  - Session management & UI state persistence:
    - Conversation details in the **Sessions** tab are collapsed by default and
      loaded/expanded on demand (`15` turns default in sidebar with `Load earlier`).
    - Agent sessions support **Fork** (clones `events.jsonl`, checkpoints and
      auxiliary folders to a new UUID without copying live locks), **Move
      workspace** (updates `workspace.yaml` with auto-detected git root,
      repository and branch), **Archive / Unarchive** (with an `Archived`
      filter toggle), and **Delete** (with live-PID protection and modal
      confirmation).
    - Panel UI state (active tab, time window, collapsed sections, recent-list
      limit, session filters and selected session) persists per window via
      `workspaceState`.
- **Immediate wake-up for historical Copilot conversations**:
  - Resuming/opening a historical conversation (`session.resume` / `session.start` /
    `user.message`) or focusing the window updates `windowActivityTs` and pulls
    the tail of this window's sessions even if older than `backfillDays`, so
    historical tok/s appears immediately while keeping `autoHideMinutes: 5` on the
    bottom-right status bar only.
- **Dashboard scope toggle fix**: clicking **Show all windows** / **Show this
  window only** now updates an immediate in-memory override (`setScope`) before
  persisting, so switching still works when only the Extension Host restarted.

## 0.1.1 — per-window scope

Copilot writes every VS Code window's sessions into one shared folder and a usage
record carries no window id, so a freshly opened window used to show whatever
another window had just run. The session's working directory now decides.

- New `src/scope.js`: resolves each session's `cwd` from `workspace.yaml`
  (or the `session.start` event for older sessions) and each legacy debug-log
  folder from its `workspace.json` — `folder` for a single-folder window,
  `workspace` for a saved `.code-workspace` file — then compares them with
  `vscode.workspace.workspaceFolders` and `vscode.workspace.workspaceFile`.
- Adding or removing a folder rescopes immediately, without waiting for the next
  captured response.
- The status bar, tooltip, dashboard, export, diagnostics and the Settings live
  status all report this window's numbers only.
- A scope strip at the top of the dashboard states what is shown ("N requests ·
  M from other windows hidden") and switches to all windows in one click.
- New `copilotSpeedometer.sessionScope`: `window` (default) or `all`.
- Records whose origin cannot be resolved are kept rather than dropped, and a
  window with no folder open is not scoped — an empty panel is worse than a
  merged number.
- New `test/scope.test.js` (12 cases) plus scanner attribution tests; the
  activation smoke test now asserts that switching scope changes the payload,
  that a multi-root `.code-workspace` window is recognised, and that opening a
  folder rescopes without waiting for a new record.

## 0.1.0 — first public release

The first Marketplace release. It bundles everything built in the internal 0.2.x–0.4.0
iterations:

- Status bar and dashboard showing tokens/second, TTFT, token usage and per-request
  duration for GitHub Copilot Chat, including BYOK / custom-endpoint models.
- Two local data sources merged: agent usage records (TTFT + BYOK) and Copilot Chat
  debug logs. Nothing leaves the machine.
- In-panel Settings, English / Simplified Chinese UI, auto-hide when idle, extension
  icon, diagnostics, export / clear history and a demo preview.
- `npm run package` writes `dist/copilot-speedometer-0.1.0.vsix`.

> 0.2.2–0.4.0 were internal builds only (never published). Their notes are kept
> below as history; the public version line starts at 0.1.0.

## 0.4.0

- The status-bar item now hides itself when no new Copilot response has arrived for
  a while (new `copilotSpeedometer.autoHideMinutes`, default 5, 0 = never), so a
  window you are not chatting in no longer shows a stale number. The decision is a
  pure helper in `src/stats.js` and is unit-tested.
- Extension icon (`media/icon.png`, 256x256 speedometer dial) and a plain
  `displayName` of "Copilot Speedometer", ready for the Marketplace.
- `tools/make-icon.py` regenerates the icon from code.

## 0.3.1

- The whole extension now follows the VS Code display language: panel, status bar,
  output channel, notifications and the Command Palette titles are translated in
  English and Simplified Chinese (new `src/i18n.js`, `package.nls.json`,
  `package.nls.zh-cn.json`). Switching the display language is enough - no setting.
- Packaging writes to `dist/` (`npm run package`), and the built `.vsix` is ignored
  by git and by the package itself.
- Two READMEs: `README.md` (Chinese, with Chinese screenshots) and `README_en.md`.
- New `test/i18n.test.js` (dictionary alignment, placeholder parity, every literal
  key used by the host and the panel, `%key%` coverage in both `package.nls` files).

## 0.3.0

- An in-panel **Settings** page: switches, numbers, paths (with Browse) and the
  status-bar mode are editable inside the webview, apply immediately, and each
  overridden row offers a reset button to restore its default. Values are written to
  the scope that already holds an override, so edits never look ignored.
- New `copilotSpeedometer.statusBarFormat`: `rate`, `rate-model` or `rate-ttft`.
- `Clear Captured History` now asks for confirmation; the master switch is also
  reachable from the Settings page.
- Panel CSS carries dark fallbacks for every theme variable, so controls stay
  visible on themes that do not define the optional `--vscode-input-*` colours.

## 0.2.3

- New `Copilot Speedometer: Show Diagnostics` command: an output channel listing the
  settings in force, every root that was scanned, the files found and the per-source
  record counts - so "why is it empty" is answerable without guessing.
- Refresh now invalidates the usage-records directory cache too (it only did the debug-log one).

## 0.2.2

- Deep backfill on demand: choosing the "7d" or "all" window now reads the tail of every
  session file (byte-budgeted), instead of only what the 2-day startup pass collected.
- Fix: the directory cache was keyed only by time, so the deeper scan reused the shallow
  file list and returned nothing extra.
- New activation smoke test (`tools/smoke-activate.js`) that runs the real extension
  against a stubbed `vscode` API.

## 0.2.1

- Decode rate is dropped below a 500 ms generation window or above 3000 tok/s.
- No setup nudge when usage records exist (BYOK users need no debug logging).

## 0.2.0

- Second data source: Copilot agent usage records (`~/.copilot/session-state/*/events.jsonl`,
  `session.usage_record`). Works for **BYOK / custom-endpoint models** and needs no debug-logging switch.
- Real TTFT (`timeToFirstTokenMs`) and a TTFT card.
- `BYOK` badge in the request table, provider row in the status bar tooltip.
- Dedupe between the two sources so one call is counted once (usage record wins, it has TTFT).
- New settings: `copilotSpeedometer.usageEvents`, `copilotSpeedometer.usageEventsRoot`.
- Tests for the usage-event parser and scanner.

## 0.1.0

- Status bar item showing tokens/second of the last Copilot Chat response.
- Dashboard webview: summary cards, per-response tok/s chart, per-model table, recent request table.
- Incremental tailing of `main.jsonl` with partial-line buffering and truncation/rewrite recovery.
- Auto-discovery of the `globalStorage` layout and the legacy `workspaceStorage` layout.
- Commands: show dashboard, refresh, enable Copilot debug logging, export JSON, clear history, demo preview.
- Settings for log path override, poll interval, history size and backfill window.
