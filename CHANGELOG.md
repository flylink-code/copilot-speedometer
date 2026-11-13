# Changelog

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
