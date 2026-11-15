'use strict';

const i18n = require('./i18n');

/**
 * Dashboard + Settings webview.
 *
 * The host sends fully aggregated payloads; this script only renders and
 * forwards user intent. Two views ('dashboard', 'settings') live in one page so
 * switching tabs costs no extra round trip, and each view keeps its own state.
 */

function html(nonce, cspSource, locale, isSidebar) {
  const style = `
    :root {
      /* Every token carries a dark-theme fallback: the panel must still render
         in a browser preview, and a theme that leaves a variable unset must
         degrade to something visible rather than to no border at all. */
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-foreground, #cccccc);
      --fg-dim: var(--vscode-descriptionForeground, #9d9d9d);
      --fg-section: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground, #cccccc));
      --border: var(--vscode-panel-border, #3c3c3c);
      --border-soft: color-mix(in srgb, var(--border) 60%, transparent);
      --surface: var(--vscode-editorWidget-background, rgba(128,128,128,.07));
      --hover: var(--vscode-list-hoverBackground, rgba(128,128,128,.12));
      --selected: var(--vscode-list-activeSelectionBackground, rgba(0,127,212,.22));
      --accent: var(--vscode-focusBorder, #007fd4);
      --input-bg: var(--vscode-input-background, #313131);
      --input-border: var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c));
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --btn-sec-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --btn-sec-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --btn-sec-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --blue: var(--vscode-charts-blue, #3794ff);
      --green: var(--vscode-testing-iconPassed, #3fb950);
      --red: var(--vscode-errorForeground, #f85149);
      --mono: var(--vscode-editor-font-family, monospace);
      --radius: 6px;
      --h-control: 26px;
      --pad: 20px;
    }
    /* Webview views sit on the side bar surface, not on the editor surface. */
    body.sidebar { --bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #181818)); --pad: 12px; }
    * { box-sizing: border-box; }
    html, body { max-width: 100%; overflow-x: hidden; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(121,121,121,.35)); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(121,121,121,.55)); }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--fg);
      background: var(--bg);
      margin: 0;
      padding: 0 var(--pad) 28px;
    }
    button, select, input { font-family: inherit; font-size: 12px; color: inherit; }
    :focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
    .view[hidden] { display: none !important; }
    .muted { color: var(--fg-dim); }
    .mono { font-family: var(--mono); }
    .num { text-align: right; }
    .rate { color: var(--blue); font-weight: 600; font-variant-numeric: tabular-nums; }
    .spacer { flex: 1; }
    svg.ic { width: 16px; height: 16px; fill: currentColor; flex-shrink: 0; }
    code { font-family: var(--mono); background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.14));
      padding: 1px 5px; border-radius: 3px; }

    /* ── Header: one row, tabs left, icon actions right ──────────────────── */
    header {
      position: sticky; top: 0; z-index: 5;
      display: flex; align-items: center; gap: 8px;
      margin: 0 calc(var(--pad) * -1); padding: 8px var(--pad) 0;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; white-space: nowrap; padding-bottom: 7px; }
    .brand svg { width: 14px; height: 14px; fill: var(--blue); }
    .tabs { display: flex; gap: 2px; min-width: 0; }
    .tab {
      background: none; border: none; border-bottom: 2px solid transparent;
      padding: 6px 10px 7px; margin-bottom: -1px; cursor: pointer;
      color: var(--fg-dim); font-size: 12px; white-space: nowrap;
    }
    .tab:hover { color: var(--fg); }
    .tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
    .head-actions { display: flex; align-items: center; gap: 2px; padding-bottom: 5px; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border: none; border-radius: 5px; padding: 0;
      background: none; color: var(--fg-dim); cursor: pointer;
    }
    .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.18)); color: var(--fg); }

    /* ── Generic controls ────────────────────────────────────────────────── */
    select {
      background: var(--vscode-dropdown-background, var(--input-bg));
      color: var(--vscode-dropdown-foreground, var(--fg));
      border: 1px solid var(--vscode-dropdown-border, var(--border));
      border-radius: 4px; height: var(--h-control); padding: 0 6px; cursor: pointer; min-width: 0;
    }
    .btn {
      display: inline-flex; align-items: center; gap: 5px; justify-content: center;
      background: var(--btn-sec-bg); color: var(--btn-sec-fg);
      border: none; border-radius: 4px; height: var(--h-control); padding: 0 11px;
      cursor: pointer; white-space: nowrap; min-width: 0;
    }
    .btn:hover { background: var(--btn-sec-hover); }
    .btn.primary { background: var(--btn-bg); color: var(--btn-fg); }
    .btn.primary:hover { background: var(--btn-hover); }
    .btn.danger { color: var(--red); border: 1px solid color-mix(in srgb, var(--red) 45%, transparent); background: transparent; }
    .btn.danger:hover { background: color-mix(in srgb, var(--red) 14%, transparent); }
    .btn.ghost { background: transparent; color: var(--fg-dim); border: 1px solid var(--border); }
    .btn.ghost:hover { color: var(--fg); background: var(--hover); }
    .btn.active-pill { background: var(--selected); color: var(--fg); border: 1px solid var(--blue); }
    .btn[disabled] { opacity: .45; cursor: default; }
    .btn.block { width: 100%; }
    .input {
      background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--input-border); border-radius: 4px;
      height: var(--h-control); padding: 0 8px; min-width: 0;
    }
    .input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
    .segmented { display: inline-flex; border: 1px solid var(--border); border-radius: 5px; overflow: hidden; max-width: 100%; }
    .seg {
      background: none; border: none; padding: 0 10px; height: 24px; cursor: pointer;
      color: var(--fg-dim); font-size: 11.5px; border-right: 1px solid var(--border); white-space: nowrap;
    }
    .seg:last-child { border-right: none; }
    .seg:hover { background: var(--hover); color: var(--fg); }
    .seg[aria-pressed="true"] { background: var(--selected); color: var(--fg); font-weight: 600; }
    .seg[disabled] { opacity: .45; cursor: default; }
    .count-badge {
      display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px;
      padding: 0 5px; border-radius: 9px; font-size: 10.5px; font-weight: 600;
      background: var(--badge-bg); color: var(--badge-fg); font-variant-numeric: tabular-nums;
    }
    .badge {
      font-size: 10px; line-height: 15px; padding: 0 5px; border-radius: 3px; white-space: nowrap; flex-shrink: 0;
      border: 1px solid var(--border); color: var(--fg-dim);
    }
    .badge.live { border-color: var(--green); color: var(--green); font-weight: 600; }
    .badge.agent { border-color: color-mix(in srgb, var(--blue) 70%, transparent); color: var(--blue); }
    .badge.archived { opacity: .85; }
    .tag { font-size: 9.5px; letter-spacing: .03em; padding: 0 4px; border-radius: 3px;
      border: 1px solid var(--border); color: var(--fg-dim); white-space: nowrap; flex-shrink: 0; }
    .linkbtn {
      background: none; border: none; padding: 0; cursor: pointer;
      font-size: 11.5px; color: var(--vscode-textLink-foreground, #3794ff);
    }
    .linkbtn:hover { text-decoration: underline; }

    /* ── Section = VS Code pane header: full-bleed strip, chevron, count ── */
    section.block { margin: 20px calc(var(--pad) * -1) 0; }
    .block-head {
      display: flex; align-items: center; gap: 8px; height: 28px;
      padding: 0 var(--pad);
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border-soft);
      background: color-mix(in srgb, var(--fg) 3%, transparent);
    }
    .block-toggle {
      display: inline-flex; align-items: center; gap: 6px; background: none; border: none; padding: 0;
      cursor: pointer; font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .06em; color: var(--fg-section); height: 100%;
    }
    .block-toggle:hover { color: var(--fg); }
    .chevron { display: inline-block; width: 10px; text-align: center; font-size: 10px; color: var(--fg-dim); }
    .block-meta { margin-left: auto; }
    .block-body { padding: 10px var(--pad) 0; }

    /* ── Dashboard ───────────────────────────────────────────────────────── */
    .dash-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 12px; }
    .scope-meta { font-size: 11px; color: var(--fg-dim); white-space: nowrap; }
    .hero {
      margin-top: 12px; padding: 12px 14px; border-radius: var(--radius);
      border: 1px solid var(--border); border-left: 3px solid var(--blue); background: var(--surface);
    }
    .hero-top { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--fg-dim); }
    .hero-label { text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
    .hero-value { font-size: 30px; font-weight: 700; color: var(--blue); line-height: 1.15; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .hero-value small { font-size: 13px; font-weight: 600; margin-left: 2px; }
    .hero-sub { font-size: 12px; color: var(--fg-dim); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-top: 10px; }
    .kpi { padding: 9px 11px; border-radius: var(--radius); border: 1px solid var(--border-soft); background: var(--surface); min-width: 0; }
    .kpi-label { font-size: 11px; color: var(--fg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kpi-value { font-size: 19px; font-weight: 600; margin-top: 3px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .kpi-value small { font-size: 12px; font-weight: 500; color: var(--fg-dim); }
    .kpi-sub { font-size: 11px; color: var(--fg-dim); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chart { display: block; width: 100%; height: 130px; }
    .chart rect { fill: var(--blue); opacity: .8; }
    .chart rect:hover { opacity: 1; }
    .chart .axis { stroke: var(--border); stroke-width: 1; }
    .chart .avg { stroke: var(--fg-dim); stroke-width: 1; stroke-dasharray: 4 3; opacity: .8; }
    .chart-legend { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--fg-dim); margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
    th { text-align: left; font-weight: 600; color: var(--fg-dim); padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
    td { padding: 6px 8px; border-bottom: 1px solid var(--border-soft); }
    tbody tr:hover td { background: var(--hover); }
    .tablewrap { overflow-x: auto; }
    .list { display: flex; flex-direction: column; }
    .list-row { padding: 10px 0; border-bottom: 1px solid var(--border-soft); min-width: 0; }
    .list-row:first-child { padding-top: 2px; }
    .list-row:last-child { border-bottom: none; padding-bottom: 2px; }
    .row-main { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12.5px; }
    .row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .row-sub { display: flex; flex-wrap: wrap; gap: 3px 10px; margin-top: 4px; font-size: 11px; color: var(--fg-dim); font-variant-numeric: tabular-nums; }
    .share { height: 3px; border-radius: 2px; background: var(--border-soft); margin-top: 7px; overflow: hidden; }
    .share > span { display: block; height: 100%; background: var(--blue); opacity: .75; }
    .pager { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
    .empty {
      border: 1px dashed var(--border); border-radius: 8px;
      padding: 16px 18px; margin-top: 16px; line-height: 1.7;
    }
    .empty h2 { color: var(--fg); font-size: 13px; margin: 0 0 6px; }
    .path { font-family: var(--mono); font-size: 11px; color: var(--fg-dim); word-break: break-all; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
    .narrow-only { display: none; }

    /* ── Settings ────────────────────────────────────────────────────────── */
    .settings-wrap { max-width: 820px; padding-top: 16px; }
    .settings-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
    .settings-head h2 { font-size: 15px; font-weight: 600; margin: 0; }
    .settings-head p { margin: 3px 0 0; font-size: 12px; }
    .save-state {
      margin-left: auto; font-size: 11px; color: var(--green); opacity: 0;
      transition: opacity .25s; padding-top: 3px; white-space: nowrap;
    }
    .save-state.show { opacity: 1; }
    .save-state.error { color: var(--red); }
    .sec { border-top: 1px solid var(--border); padding: 4px 0 14px; }
    .sec:first-of-type { border-top: none; }
    .sec-title {
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
      color: var(--fg-section); margin: 16px 0 4px;
    }
    .sec-blurb { margin: 0 0 10px; font-size: 12px; color: var(--fg-dim); max-width: 62ch; line-height: 1.5; }
    .field {
      display: grid; grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px 20px; align-items: center; padding: 10px 0;
    }
    .field + .field { border-top: 1px solid var(--border-soft); }
    .field-text { min-width: 0; }
    .field-label { display: block; font-size: 12.5px; color: var(--fg); }
    .field-hint { margin-top: 3px; font-size: 11px; line-height: 1.5; color: var(--fg-dim); max-width: 66ch; }
    .field-control { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
    .field-error { grid-column: 1 / -1; margin-top: -2px; font-size: 11px; color: var(--red); }
    .field.invalid .input, .field.invalid .segmented { outline: 1px solid var(--red); }
    .input-num { width: 96px; text-align: right; font-variant-numeric: tabular-nums; }
    .input-text { width: 300px; font-family: var(--mono); font-size: 11px; }
    .unit { font-size: 11px; color: var(--fg-dim); min-width: 44px; }
    .switch {
      position: relative; width: 34px; height: 20px; border-radius: 10px; padding: 0; flex-shrink: 0;
      border: 1px solid var(--border); background: var(--input-bg); cursor: pointer;
      transition: background .12s, border-color .12s;
    }
    .switch::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
      border-radius: 50%; background: var(--fg-dim); transition: transform .12s, background .12s;
    }
    .switch[aria-checked="true"] { background: var(--btn-bg); border-color: var(--btn-bg); }
    .switch[aria-checked="true"]::after { transform: translateX(14px); background: var(--btn-fg); }
    .btn-reset {
      background: none; border: none; color: var(--fg-dim); cursor: pointer;
      width: 22px; height: 22px; border-radius: 4px; padding: 0; visibility: hidden; font-size: 13px;
    }
    .field.modified .btn-reset { visibility: visible; }
    .btn-reset:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.16)); color: var(--fg); }
    .source {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--surface); margin-bottom: 8px;
    }
    .status-caption {
      margin: 16px 0 6px; font-size: 10.5px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .07em; color: var(--fg-dim);
    }
    .source:last-of-type { margin-bottom: 0; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
    .dot.off { background: var(--fg-dim); opacity: .5; }
    .dot.warn { background: var(--vscode-editorWarning-foreground, #f5a623); }
    .source-body { min-width: 0; flex: 1; }
    .source-name { font-size: 12px; font-weight: 600; }
    .source-path { font-family: var(--mono); font-size: 11px; color: var(--fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .source-meta { font-size: 11px; color: var(--fg-dim); margin-top: 1px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
    .footnote { margin-top: 16px; font-size: 11px; color: var(--fg-dim); font-style: italic; }

    /* ── Sessions Hub ────────────────────────────────────────────────────── */
    .hub-wrap { padding-top: 12px; }
    .hub-split {
      display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 14px;
      align-items: start;
    }
    .hub-left { min-width: 0; position: sticky; top: 46px; }
    .hub-search-row { display: flex; gap: 6px; align-items: center; }
    .hub-search { flex: 1; min-width: 0; }
    .filter-btn { position: relative; width: var(--h-control); height: var(--h-control); border: 1px solid var(--border); }
    .filter-btn[aria-pressed="true"] { background: var(--selected); color: var(--fg); }
    .filter-btn .dotcount {
      position: absolute; top: -5px; right: -5px; min-width: 14px; height: 14px; border-radius: 7px;
      font-size: 9px; line-height: 14px; text-align: center; background: var(--btn-bg); color: var(--btn-fg); padding: 0 3px;
    }
    .hub-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
    .hub-filters select, .hub-filters .btn { width: 100%; }
    .hub-filters .full { grid-column: 1 / -1; }
    .hub-count { font-size: 11px; color: var(--fg-dim); margin: 10px 0 4px; display: flex; align-items: center; gap: 6px; }
    .sess-list { max-height: calc(100vh - 170px); overflow-y: auto; margin: 0 -4px; padding: 0 4px; }
    .sess-group {
      font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
      color: var(--fg-dim); padding: 14px 2px 6px;
    }
    .sess-group:first-child { padding-top: 4px; }
    .sess-item {
      display: block; width: 100%; text-align: left; background: var(--surface); cursor: pointer;
      border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 10px 12px; margin-bottom: 8px;
    }
    .sess-item:last-child { margin-bottom: 0; }
    .sess-item:hover { background: var(--hover); border-color: var(--border); }
    .sess-item.active { background: var(--selected); border-color: color-mix(in srgb, var(--blue) 60%, transparent); }
    .sess-title {
      display: flex; align-items: flex-start; gap: 6px;
      font-size: 12.5px; font-weight: 600; color: var(--fg); line-height: 1.4;
    }
    .sess-title-text {
      flex: 1; min-width: 0; overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word;
    }
    .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); margin-top: 5px; flex-shrink: 0;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 22%, transparent); }
    .sess-line {
      display: flex; align-items: center; gap: 6px; margin-top: 5px; min-width: 0;
      font-size: 11px; color: var(--fg-dim); font-variant-numeric: tabular-nums;
    }
    .sess-proj { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .sess-time { white-space: nowrap; flex-shrink: 0; }
    .sess-stats { display: flex; flex-wrap: wrap; gap: 2px 10px; }
    .hub-reader {
      border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
      padding: 14px 16px; min-width: 0;
    }
    .back-btn { display: none; }
    .reader-title { font-size: 14px; font-weight: 600; margin: 0; line-height: 1.4; word-break: break-word; }
    .reader-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .kv {
      display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px;
      margin: 12px 0 0; padding: 10px 12px; font-size: 11.5px;
      border-radius: var(--radius); border: 1px solid var(--border-soft); background: var(--bg);
    }
    .kv dt { color: var(--fg-dim); }
    .kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .kv dd.mono { font-size: 11px; }
    .reader-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; margin-top: 12px; }
    .reader-kpis .kpi { padding: 8px 9px; background: var(--bg); }
    .reader-kpis .kpi-value { font-size: 15px; }
    .reader-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .action-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; }
    .manage-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-top: 2px; padding-top: 8px; border-top: 1px solid var(--border-soft); font-size: 11px; color: var(--fg-dim); }
    .manage-row .linkbtn[disabled] { opacity: .45; cursor: default; text-decoration: none; }
    .manage-row .linkbtn.danger { color: var(--red); }
    .detail-toggle {
      display: flex; align-items: center; gap: 6px; width: 100%;
      background: none; border: 1px solid var(--border); border-radius: var(--radius);
      padding: 7px 10px; margin-top: 14px; cursor: pointer;
      color: var(--fg); font-size: 12px; font-weight: 600;
    }
    .detail-toggle:hover { background: var(--hover); }
    .detail-body { margin-top: 10px; }
    .notice { font-size: 11px; color: var(--fg-dim); margin-bottom: 8px; }
    .turn-list { display: flex; flex-direction: column; gap: 10px; }
    .turn { border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 9px 12px; background: var(--bg); min-width: 0; }
    .turn.user { border-left: 3px solid var(--blue); background: color-mix(in srgb, var(--blue) 6%, var(--bg)); }
    .turn.assistant { border-left: 3px solid var(--green); }
    .turn.tools { background: transparent; border-style: dashed; padding: 6px 10px; }
    .turn-head { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: 10.5px; color: var(--fg-dim); margin-bottom: 5px; }
    .turn-role { font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--fg); }
    .turn-body { font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
    .tool-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .tool-chip {
      font-family: var(--mono); font-size: 10.5px; padding: 1px 6px; border-radius: 3px;
      background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.14)); color: var(--fg-dim);
    }

    /* ── Narrow layout (side bar, or a slim editor column) ───────────────────
       The class is set from script so the side bar and a narrow editor tab
       share one rule set instead of two duplicated copies. */
    body.narrow .brand-text { display: none; }
    body.narrow .tabs { flex: 1; }
    body.narrow .tab { flex: 1; padding: 6px 4px 7px; }
    body.narrow .wide-only { display: none; }
    body.narrow .narrow-only { display: block; }
    body.narrow .hero-value { font-size: 26px; }
    body.narrow .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
    body.narrow .kpi { padding: 9px 10px; }
    body.narrow .kpi-value { font-size: 16px; }
    body.narrow .chart { height: 88px; }
    body.narrow section.block { margin-top: 16px; }
    body.narrow .field { grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 10px 0; }
    body.narrow .field.field-boolean { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: start; }
    body.narrow .field.field-boolean .field-control { padding-top: 2px; }
    body.narrow .field-control { justify-content: flex-start; flex-wrap: wrap; }
    body.narrow .input-text { width: 100%; flex: 1; min-width: 120px; }
    body.narrow .segmented { flex-wrap: wrap; }
    body.narrow .source { flex-wrap: wrap; gap: 6px 8px; padding: 8px 10px; }
    body.narrow .source .btn { width: 100%; }
    body.narrow .actions .btn { flex: 1 1 auto; }
    body.narrow .hub-wrap { padding-top: 10px; }
    body.narrow .hub-split { grid-template-columns: minmax(0, 1fr); gap: 0; }
    body.narrow .hub-left { position: static; }
    /* No nested scroller in the side bar: the list flows with the page. */
    body.narrow .sess-list { max-height: none; overflow: visible; margin: 0; padding: 0; }
    body.narrow .hub-split.mode-list .sess-item.active { background: var(--surface); border-color: var(--border-soft); }
    body.narrow .hub-split.mode-list .sess-item.active:hover { background: var(--hover); border-color: var(--border); }
    body.narrow .hub-split.mode-list .hub-reader { display: none; }
    body.narrow .hub-split.mode-detail .hub-left { display: none; }
    body.narrow .hub-reader { border: none; background: none; padding: 0; }
    body.narrow .kv { background: var(--surface); }
    body.narrow .reader-kpis .kpi { background: var(--surface); }
    body.narrow .back-btn { display: inline-flex; margin: 0 0 12px 0; gap: 4px; width: auto; padding: 0 10px; font-size: 12px; color: var(--vscode-textLink-foreground, #3794ff); }
    body:not(.narrow) .filter-btn { display: none; }
    body:not(.narrow) .hub-filters { display: grid !important; }
  `;

  const lang = (locale && locale.locale) || 'en';
  const dictJson = JSON.stringify(locale && locale.dict ? locale.dict : {});
  const tr = i18n.create(lang).t;

  const script = `
    var vscode = acquireVsCodeApi();
    var DICT = ${dictJson};
    var IS_SIDEBAR = ${isSidebar ? 'true' : 'false'};
    var DEFAULT_RECENT_LIMIT = IS_SIDEBAR ? 8 : 15;
    var DEFAULT_TURN_LIMIT = IS_SIDEBAR ? 15 : 50;
    var state = {
      view: 'dashboard',
      data: null,
      settings: null,
      filter: 'today',
      sessions: null,
      sessionDetail: null,
      selectedSessionId: '',
      detailOpen: false,
      loadingDetail: false,
      turnLimit: DEFAULT_TURN_LIMIT,
      dashUi: { recentLimit: DEFAULT_RECENT_LIMIT, open: { chart: true, models: true, recent: true } },
      hubFilter: { q: '', scope: 'all', source: 'all', project: '', showArchived: false },
      /* Narrow layouts show either the list or one session, never both. */
      hubMode: 'list',
      filtersOpen: false,
    };

    var ICON_FILTER = '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3h13l-5 6v4.5l-3 1.5V9z"/></svg>';

    /* 600px is where the two-column hub and the nine-column tables stop
       fitting; below it the side bar layout is used even in an editor tab. */
    var NARROW_PX = 600;
    function applyNarrow() {
      var narrow = IS_SIDEBAR || window.innerWidth < NARROW_PX;
      if (document.body.classList.contains('narrow') === narrow) return;
      document.body.classList.toggle('narrow', narrow);
      if (!narrow) state.hubMode = 'list';
      if (state.sessions) applyHubMode();
    }

    function persistUiState(patch) {
      vscode.postMessage({ type: 'saveUiState', patch: patch });
    }

    /* The host ships one flat dictionary; a missing key falls back to itself so
       a gap shows up as an obvious identifier instead of an empty label. */
    function t(key) {
      var s = DICT[key] !== undefined ? DICT[key] : key;
      for (var i = 1; i < arguments.length; i += 1) {
        s = s.split('{' + (i - 1) + '}').join(String(arguments[i]));
      }
      return s;
    }

    function esc(s) {
      return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function rate(v) {
      if (v === null || v === undefined || !isFinite(v)) return '--';
      if (v >= 100) return String(Math.round(v));
      if (v >= 10) return (Math.round(v * 10) / 10).toFixed(1);
      return v.toFixed(2);
    }
    function toks(v) {
      if (!v && v !== 0) return '--';
      if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
      if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k';
      return String(Math.round(v));
    }
    function dur(ms) {
      if (!isFinite(ms)) return '--';
      if (ms < 1000) return Math.round(ms) + ' ms';
      if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
      return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
    }
    function clock(ts) {
      var d = new Date(ts);
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    }
    function cost(v) {
      if (v === null || v === undefined || !isFinite(v)) return '--';
      if (v === 0) return '$0.00';
      if (v < 0.0001) return '<$0.0001';
      if (v < 0.01) return '$' + v.toFixed(4);
      if (v < 1) return '$' + v.toFixed(3);
      return '$' + v.toFixed(2);
    }
    function stamp(ts) {
      if (!ts) return '--';
      var d = new Date(ts);
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      var day = ('0' + d.getDate()).slice(-2);
      return m + '-' + day + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }
    function unit(u) {
      return u ? t('ui.unit.' + u) : '';
    }

    /* ── Dashboard ──────────────────────────────────────────────────────── */

    function ago(ts) {
      if (!ts) return '--';
      var diff = Math.max(0, Date.now() - ts);
      if (diff < 60000) return t('ui.time.justNow');
      if (diff < 3600000) return t('ui.time.minAgo', Math.floor(diff / 60000));
      if (diff < 86400000) return t('ui.time.hrAgo', Math.floor(diff / 3600000));
      return t('ui.time.dayAgo', Math.floor(diff / 86400000));
    }
    function basename(p) {
      var parts = String(p || '').split(/[\\\\/]/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : String(p || '');
    }

    function kpi(label, value, sub, title) {
      return '<div class="kpi"' + (title ? ' title="' + esc(title) + '"' : '') + '>' +
        '<div class="kpi-label">' + label + '</div>' +
        '<div class="kpi-value">' + value + '</div>' +
        (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
    }

    /* The latest response is what the status bar shows, so it gets the hero
       slot; every other figure is a window aggregate and sits in the grid. */
    function heroAndKpis(a) {
      var last = a.requests && a.requests[0];
      var hero = '<div class="hero">' +
        '<div class="hero-top"><span class="hero-label">' + t('ui.card.last') + '</span>' +
        '<span class="spacer"></span><span>' + (last ? esc(ago(last.ts)) : '') + '</span></div>' +
        '<div class="hero-value">' + rate(a.lastRate) + ' <small>tok/s</small></div>' +
        '<div class="hero-sub" title="' + esc(a.lastModel || '') + '">' + esc(a.lastModel || '--') + ' · ' +
        toks(a.lastOutput) + ' ' + t('ui.card.tokens') +
        (last && last.ttftMs ? ' · TTFT ' + dur(last.ttftMs) : '') + '</div></div>';

      var items = [
        kpi(t('ui.card.avg'), rate(a.agg.rate), toks(a.agg.output) + ' ' + t('ui.card.out') + ' / ' + dur(a.agg.durMs)),
        kpi(t('ui.card.median'), rate(a.agg.medianRate) + ' <small>/ ' + rate(a.agg.p90Rate) + '</small>', t('ui.card.perResponse')),
        kpi(t('ui.card.requests'), String(a.agg.count || 0), toks(a.agg.input) + ' ' + t('ui.card.in') + ' · ' + toks(a.agg.cached) + ' ' + t('ui.card.cached')),
      ];
      if (a.agg.pricedCount > 0 || a.agg.costUsd !== null) {
        items.push(kpi(t('ui.card.cost'), cost(a.agg.costUsd), a.agg.unpricedCount > 0
          ? t('ui.card.costSub', a.agg.pricedCount, a.agg.unpricedCount)
          : t('ui.card.costAllPriced', a.agg.pricedCount || 0)));
      }
      if (a.agg.ttftMs) items.push(kpi(t('ui.card.ttft'), dur(a.agg.ttftMs), t('ui.card.ttftSub')));
      if (a.agg.decodeRate) items.push(kpi(t('ui.card.decode'), rate(a.agg.decodeRate), t('ui.card.decodeSub', dur(a.agg.ttftMs))));
      return hero + '<div class="kpis">' + items.join('') + '</div>';
    }

    function chart(points, avgRate) {
      if (!points.length) return '<div class="muted">' + t('ui.empty.samples') + '</div>';
      var w = 800, h = 130, base = h - 4;
      var max = Math.max.apply(null, points.map(function (p) { return p.rate || 0; }).concat([1]));
      var gap = points.length > 60 ? 1 : 2;
      var bw = Math.max(2, w / points.length - gap);
      var bars = points.map(function (p, i) {
        var bh = Math.max(1, ((p.rate || 0) / max) * (base - 6));
        var x = i * (bw + gap);
        return '<rect rx="1" x="' + x.toFixed(1) + '" y="' + (base - bh).toFixed(1) + '" width="' + bw.toFixed(1) +
          '" height="' + bh.toFixed(1) + '"><title>' + clock(p.ts) + ' \\u2014 ' + rate(p.rate) + ' tok/s \\u2014 ' +
          esc(p.model) + ' (' + p.output + ' tok / ' + dur(p.durMs) + ')</title></rect>';
      }).join('');
      var avgLine = avgRate && isFinite(avgRate)
        ? '<line class="avg" x1="0" x2="' + w + '" y1="' + (base - (avgRate / max) * (base - 6)).toFixed(1) +
          '" y2="' + (base - (avgRate / max) * (base - 6)).toFixed(1) + '"/>'
        : '';
      return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<line class="axis" x1="0" y1="' + base + '" x2="' + w + '" y2="' + base + '"/>' + bars + avgLine + '</svg>' +
        '<div class="chart-legend"><span>' + t('ui.chart.peak', rate(max)) +
        (avgRate ? ' · ' + t('ui.chart.avg', rate(avgRate)) : '') + '</span><span>' + t('ui.chart.last', points.length) + '</span></div>';
    }

    function modelTable(rows) {
      if (!rows.length) return '<div class="muted">' + t('ui.empty.data') + '</div>';
      var head = '<tr><th>' + t('ui.th.model') + '</th><th class="num">' + t('ui.th.req') + '</th><th class="num">' + t('ui.th.rate') + '</th><th class="num">' + t('ui.th.median') + '</th>' +
        '<th class="num">' + t('ui.th.p90') + '</th><th class="num">' + t('ui.th.out') + '</th><th class="num">' + t('ui.th.in') + '</th><th class="num">' + t('ui.th.avgDur') + '</th><th class="num">' + t('ui.th.cost') + '</th></tr>';
      var body = rows.map(function (r) {
        return '<tr><td class="mono">' + esc(r.model) + '</td><td class="num">' + r.count + '</td>' +
          '<td class="num rate">' + rate(r.rate) + '</td><td class="num">' + rate(r.medianRate) + '</td>' +
          '<td class="num">' + rate(r.p90Rate) + '</td><td class="num">' + toks(r.output) + '</td>' +
          '<td class="num">' + toks(r.input) + '</td><td class="num">' + dur(r.durMs / Math.max(1, r.count)) + '</td>' +
          '<td class="num">' + cost(r.costUsd) + '</td></tr>';
      }).join('');
      var totalOut = rows.reduce(function (s, r) { return s + (r.output || 0); }, 0) || 1;
      var compact = rows.map(function (r) {
        var pct = Math.round(((r.output || 0) / totalOut) * 100);
        return '<div class="list-row">' +
          '<div class="row-main"><span class="row-name" title="' + esc(r.model) + '">' + esc(r.model) + '</span>' +
          '<span class="rate">' + rate(r.rate) + ' <span class="muted" style="font-weight:400">tok/s</span></span></div>' +
          '<div class="row-sub">' +
          '<span>' + t('ui.sessions.reqCount', r.count) + '</span>' +
          '<span>p50 ' + rate(r.medianRate) + ' · p90 ' + rate(r.p90Rate) + '</span>' +
          (r.costUsd !== null && r.costUsd !== undefined ? '<span>' + cost(r.costUsd) + '</span>' : '') +
          '</div>' +
          '<div class="share" title="' + esc(t('ui.models.share', pct)) + '"><span style="width:' + pct + '%"></span></div>' +
          '</div>';
      }).join('');
      return '<div class="wide-only tablewrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
        '<div class="narrow-only list">' + compact + '</div>';
    }

    function requestTable(rows) {
      if (!rows.length) return '<div class="muted">' + t('ui.empty.data') + '</div>';
      var limit = Math.min(rows.length, state.dashUi.recentLimit || DEFAULT_RECENT_LIMIT);
      var slice = rows.slice(0, limit);
      var head = '<tr><th>' + t('ui.th.time') + '</th><th>' + t('ui.th.model') + '</th><th class="num">' + t('ui.th.rate') + '</th><th class="num">' + t('ui.th.out') + '</th>' +
        '<th class="num">' + t('ui.th.in') + '</th><th class="num">' + t('ui.th.cached') + '</th><th class="num">' + t('ui.th.duration') + '</th><th class="num">' + t('ui.th.ttft') + '</th><th class="num">' + t('ui.th.cost') + '</th></tr>';
      var body = slice.map(function (r) {
        return '<tr><td class="mono">' + clock(r.ts) + '</td><td class="mono">' + esc(r.model) +
          (r.byok ? ' <span class="tag">BYOK</span>' : '') + '</td>' +
          '<td class="num rate">' + rate(r.rate) + '</td><td class="num">' + r.output + '</td>' +
          '<td class="num">' + toks(r.input) + '</td><td class="num">' + toks(r.cached) + '</td>' +
          '<td class="num">' + dur(r.durMs) + '</td><td class="num">' + (r.ttftMs ? dur(r.ttftMs) : '--') + '</td>' +
          '<td class="num">' + cost(r.costUsd) + '</td></tr>';
      }).join('');
      var compact = slice.map(function (r) {
        return '<div class="list-row">' +
          '<div class="row-main">' +
          '<span class="row-name" title="' + esc(r.model) + '">' + esc(r.model) + '</span>' +
          (r.byok ? '<span class="tag">BYOK</span>' : '') +
          '<span class="rate">' + rate(r.rate) + '</span>' +
          '</div>' +
          '<div class="row-sub">' +
          '<span class="mono">' + clock(r.ts) + '</span>' +
          '<span>' + toks(r.output) + ' ' + t('ui.th.out') + ' · ' + toks(r.input) + ' ' + t('ui.th.in') + '</span>' +
          '<span>' + dur(r.durMs) + '</span>' +
          (r.costUsd !== null && r.costUsd !== undefined ? '<span>' + cost(r.costUsd) + '</span>' : '') +
          '</div></div>';
      }).join('');

      var pager = '';
      if (rows.length > DEFAULT_RECENT_LIMIT) {
        var btns = [];
        if (limit < rows.length) {
          var step = Math.min(20, rows.length - limit);
          btns.push('<button class="btn ghost" data-recent-action="more">' + t('ui.recent.more', step) + '</button>');
          if (rows.length - limit > step) {
            btns.push('<button class="btn ghost" data-recent-action="all">' + t('ui.recent.all', rows.length) + '</button>');
          }
        }
        if (limit > DEFAULT_RECENT_LIMIT) {
          btns.push('<button class="btn ghost" data-recent-action="less">' + t('ui.recent.less') + '</button>');
        }
        if (btns.length) pager = '<div class="pager">' + btns.join('') + '</div>';
      }

      return '<div class="wide-only tablewrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
        '<div class="narrow-only list">' + compact + '</div>' + pager;
    }

    function setup(a) {
      var s = a.setup || {};
      var usageOk = !!(s.usageEnabled && s.usageRoots && s.usageRoots.length);
      var lines = [];
      lines.push('<div class="empty"><h2>' + t('ui.setup.title') + '</h2>');
      if (usageOk) {
        lines.push('<div>' + t('ui.setup.watching') + '</div>');
        lines.push('<div class="row"><button class="btn primary" id="btn-refresh">' + t('ui.refresh') + '</button>' +
          '<button class="btn" id="btn-open-settings">' + t('ui.setup.settings') + '</button></div>');
      }
      if (!s.loggingEnabled) {
        lines.push('<div style="margin-top:10px">' + t('ui.setup.loggingOff') + '</div>');
        lines.push('<div class="row"><button class="btn ' + (usageOk ? '' : 'primary') + '" id="btn-enable">' + t('ui.setup.enable') + '</button></div>');
      }
      if (s.roots && s.roots.length) {
        lines.push('<div style="margin-top:10px" class="muted">' + t('ui.setup.roots') + '</div>');
        lines.push(s.roots.map(function (r) { return '<div class="path">' + esc(r) + '</div>'; }).join(''));
      } else {
        lines.push('<div style="margin-top:10px" class="muted">' + t('ui.setup.noRoots') + '</div>');
        lines.push('<div class="path">%APPDATA%\\\\Code\\\\User\\\\globalStorage\\\\github.copilot-chat\\\\debug-logs</div>');
      }
      if (usageOk) {
        lines.push('<div style="margin-top:10px" class="muted">' + t('ui.setup.usageRoots') + '</div>');
        lines.push(s.usageRoots.map(function (r) { return '<div class="path">' + esc(r) + '</div>'; }).join(''));
      }
      lines.push('<div style="margin-top:10px" class="muted">' + t('ui.setup.note') + '</div>');
      lines.push('</div>');
      return lines.join('');
    }

    /* Time window and window scope both narrow the same numbers, so they share
       one toolbar row instead of a dropdown in the header plus a banner. */
    function dashToolbar(a) {
      var segs = [['today', 'ui.filter.today'], ['7d', 'ui.filter.7d'], ['all', 'ui.filter.all']].map(function (o) {
        return '<button class="seg" data-window="' + o[0] + '" aria-pressed="' + (state.filter === o[0]) + '">' + t(o[1]) + '</button>';
      }).join('');
      var s = a.scope || {};
      var label, tip, link;
      if (s.mode === 'all') {
        label = t('ui.scope.all');
        tip = t('ui.scope.allSummary', a.totalCaptured);
        link = '<button class="linkbtn" data-scope="window">' + t('ui.scope.showWindow') + '</button>';
      } else if (!s.roots || !s.roots.length) {
        label = t('ui.scope.all');
        tip = t('ui.scope.noRoots');
        link = '';
      } else {
        label = t('ui.scope.window') + ' · ' + esc(basename(s.roots[0]));
        tip = s.roots.join(', ') + '\\n' + t('ui.scope.windowSummary', a.totalCaptured, s.otherSessions || 0) + '\\n' + t('ui.scope.hint');
        link = '<button class="linkbtn" data-scope="all">' + t('ui.scope.showAll') + '</button>';
      }
      return '<div class="dash-toolbar">' +
        '<div class="segmented" role="group" aria-label="' + esc(t('ui.filter.title')) + '">' + segs + '</div>' +
        '<span class="scope-meta" title="' + esc(tip) + '">' + label + '</span>' +
        '<span class="spacer"></span>' + link + '</div>';
    }

    function dashBlock(key, title, meta, content) {
      var open = state.dashUi.open[key] !== false;
      var arrow = open ? '&#9662;' : '&#9656;';
      return '<section class="block">' +
        '<div class="block-head">' +
        '<button class="block-toggle" data-toggle-sec="' + key + '" aria-expanded="' + open + '">' +
        '<span class="chevron">' + arrow + '</span>' + esc(title) + '</button>' +
        (meta ? '<span class="block-meta count-badge">' + esc(meta) + '</span>' : '') +
        '</div>' +
        (open ? '<div class="block-body">' + content + '</div>' : '') +
        '</section>';
    }

    function renderDashboard() {
      var a = state.data;
      if (!a) return;
      var root = document.getElementById('view-dashboard');
      var body;
      if (!a.hasData) {
        body = dashToolbar(a) + setup(a);
      } else {
        var shown = Math.min(a.requests.length, state.dashUi.recentLimit || DEFAULT_RECENT_LIMIT);
        var recentMeta = a.requests.length ? (shown < a.requests.length ? shown + ' / ' + a.requests.length : String(a.requests.length)) : '';
        var modelMeta = a.models.length ? String(a.models.length) : '';
        body = dashToolbar(a) + heroAndKpis(a) +
          dashBlock('chart', t('ui.block.series'), '', chart(a.series, a.agg.rate)) +
          dashBlock('models', t('ui.block.models'), modelMeta, modelTable(a.models)) +
          dashBlock('recent', t('ui.block.recent'), recentMeta, requestTable(a.requests));
      }
      root.innerHTML = body;
      var enable = document.getElementById('btn-enable');
      if (enable) enable.onclick = function () { vscode.postMessage({ type: 'enableLogging' }); };
      var refresh = document.getElementById('btn-refresh');
      if (refresh) refresh.onclick = function () { vscode.postMessage({ type: 'refresh' }); };
      var openSettings = document.getElementById('btn-open-settings');
      if (openSettings) openSettings.onclick = function () { setView('settings'); };
    }

    /* ── Settings ───────────────────────────────────────────────────────── */

    var SEG_KEY = {
      'rate': 'ui.seg.rate',
      'rate-model': 'ui.seg.rateModel',
      'rate-ttft': 'ui.seg.rateTtft',
      'window': 'ui.seg.window',
      'all': 'ui.seg.all',
    };

    var CONTROL = {
      text: function (f) {
        return '<div class="field-text"><label class="field-label" for="f-' + f.key + '">' + esc(f.label) + '</label>' +
          (f.hint ? '<div class="field-hint">' + esc(f.hint) + '</div>' : '') + '</div>';
      },
      reset: function (f) {
        return '<button class="btn-reset" data-reset="' + f.key + '" title="' + esc(t('ui.settings.reset')) +
          '" aria-label="' + esc(t('ui.settings.reset')) + '">&#8635;</button>';
      },
    };

    function control(f) {
      if (f.type === 'boolean') {
        return '<button class="switch" role="switch" data-key="' + f.key + '" data-kind="boolean" id="f-' + f.key +
          '" aria-checked="' + (!!f.value) + '" aria-label="' + esc(f.label) + '"></button>';
      }
      if (f.type === 'number') {
        return '<input class="input input-num" type="number" data-key="' + f.key + '" data-kind="number" id="f-' + f.key +
          '" value="' + f.value + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '">' +
          '<span class="unit">' + unit(f.unit) + '</span>';
      }
      if (f.type === 'enum') {
        return '<div class="segmented" role="group" data-key="' + f.key + '" data-kind="enum">' +
          f.options.map(function (o) {
            return '<button class="seg" data-value="' + o + '" aria-pressed="' + (f.value === o) + '">' +
              esc(SEG_KEY[o] ? t(SEG_KEY[o]) : o) + '</button>';
          }).join('') + '</div>';
      }
      if (f.type === 'json') {
        var jsonText = f.value && typeof f.value === 'object' ? JSON.stringify(f.value) : '{}';
        return '<input class="input input-text" type="text" data-key="' + f.key + '" data-kind="json" id="f-' + f.key +
          '" value="' + esc(jsonText) + '" spellcheck="false" placeholder="{}">';
      }
      return '<input class="input input-text" type="text" data-key="' + f.key + '" data-kind="path" id="f-' + f.key +
        '" value="' + esc(f.value) + '" spellcheck="false" placeholder="' + esc(t('ui.settings.placeholder')) + '">' +
        '<button class="btn" data-browse="' + f.key + '" title="' + esc(t('ui.settings.browse')) + '">' +
        esc(t('ui.settings.browse')) + '</button>';
    }

    /* The panel cannot read vscode.workspace, so the host sends the resolved
       scope and the panel only explains what was applied. */
    function scopeDescription(s) {
      var scoping = s.scope || {};
      if (scoping.mode === 'all') return esc(t('ui.settings.scopeAll'));
      if (!scoping.roots || !scoping.roots.length) return esc(t('ui.settings.scopeNoRoots'));
      return esc(scoping.roots.map(function (r) { return r; }).join(', ')) + ' · ' +
        esc(t('ui.settings.scopeWindow', scoping.otherSessions || 0));
    }

    function sourceCard(title, ok, folder, meta, cmd, label) {
      return '<div class="source">' +
        '<span class="dot ' + (ok ? '' : 'off') + '"></span>' +
        '<div class="source-body"><div class="source-name">' + esc(title) + '</div>' +
        '<div class="source-path" title="' + esc(folder) + '">' + esc(folder) + '</div>' +
        '<div class="source-meta">' + esc(meta) + '</div></div>' +
        (cmd ? '<button class="btn" data-cmd="' + cmd + '">' + esc(label) + '</button>' : '') +
        '</div>';
    }

    function renderSettings() {
      var s = state.settings;
      if (!s) return;
      var host = document.getElementById('view-settings');
      var src = s.sources || {};
      var usage = src.usage || { root: '', exists: false, files: 0 };
      var logs = src.logs || { roots: [], files: 0, enabled: false };
      var captured = src.captured || { total: 0, usage: 0, byok: 0 };

      var htmlParts = [];
      var status = '';
      htmlParts.push('<div class="settings-wrap">');
      htmlParts.push('<div class="settings-head"><div><h2>' + t('ui.settings.title') + '</h2>' +
        '<p class="muted">' + t('ui.settings.sub') + '</p></div>' +
        '<span class="save-state" id="save-state"></span></div>');

      s.sections.forEach(function (sec) {
        var fields = s.fields.filter(function (f) { return f.section === sec.id; });
        if (!fields.length) return;
        status = '';
        htmlParts.push('<section class="sec"><div class="sec-title">' + esc(sec.title) + '</div>' +
          (sec.blurb ? '<p class="sec-blurb">' + esc(sec.blurb) + '</p>' : ''));

        if (sec.id === 'sources') {
          status = '<div class="status-caption">' + t('ui.settings.liveStatus') + '</div>' +
            sourceCard(t('ui.settings.usageCard'), usage.exists,
              usage.root || t('ui.settings.notSet'),
              usage.exists
                ? t('ui.settings.usageFiles', usage.files, captured.usage)
                : t('ui.settings.usageMissing'),
              usage.exists ? 'revealUsageRoot' : '', t('ui.settings.reveal')) +
            sourceCard(t('ui.settings.logsCard'), logs.roots.length > 0,
              logs.roots.length ? logs.roots[0] : t('ui.settings.noneFound'),
              logs.roots.length
                ? t('ui.settings.logRoots', logs.roots.length, logs.enabled ? t('ui.settings.logOn') : t('ui.settings.logOff'))
                : t('ui.settings.noLogRoots'),
              '', '') +
            '<div class="status-caption">' + t('ui.settings.scopeCaption') + '</div>' +
            '<p class="sec-blurb">' + scopeDescription(s) + '</p>';
        }

        fields.forEach(function (f) {
          htmlParts.push('<div class="field field-' + f.type + (f.modified ? ' modified' : '') + '" data-field="' + f.key + '">' +
            CONTROL.text(f) + '<div class="field-control">' + control(f) + CONTROL.reset(f) + '</div></div>');
        });
        if (status) htmlParts.push(status);
        htmlParts.push('</section>');
      });

      htmlParts.push('<section class="sec"><div class="sec-title">' + t('ui.settings.maintenance') + '</div>' +
        '<p class="sec-blurb">' + t('ui.settings.maintenanceHint', captured.total, captured.usage, captured.byok) + '</p>' +
        '<div class="actions">' +
        '<button class="btn" data-cmd="refresh">' + t('ui.settings.refreshNow') + '</button>' +
        '<button class="btn" data-cmd="diagnostics">' + t('ui.settings.diagnostics') + '</button>' +
        '<button class="btn" data-cmd="exportJson">' + t('ui.settings.export') + '</button>' +
        '<button class="btn" data-cmd="clearHistory">' + t('ui.settings.clear') + '</button>' +
        '<button class="btn" data-cmd="openVsCodeSettings">' + t('ui.settings.openVsCode') + '</button>' +
        '</div></section>');

      htmlParts.push('<div class="footnote">' + esc(t('ui.settings.footnote')) + '</div>');
      htmlParts.push('</div>');

      host.innerHTML = htmlParts.join('');
      wireSettings(host);
    }

    /** Patch values in place so typing and scrolling survive a host round trip. */
    function syncSettings() {
      var s = state.settings;
      if (!s) return;
      s.fields.forEach(function (f) {
        var field = document.querySelector('[data-field="' + f.key + '"]');
        if (!field) return;
        field.classList.toggle('modified', !!f.modified);

        var ctrl = field.querySelector('[data-key="' + f.key + '"]');
        if (!ctrl) return;
        if (ctrl.getAttribute('data-kind') === 'boolean') {
          ctrl.setAttribute('aria-checked', String(!!f.value));
        } else if (ctrl.getAttribute('data-kind') === 'enum') {
          Array.prototype.forEach.call(ctrl.querySelectorAll('.seg'), function (b) {
            b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === f.value));
          });
        } else if (ctrl.getAttribute('data-kind') === 'json') {
          if (document.activeElement !== ctrl) {
            ctrl.value = f.value && typeof f.value === 'object' ? JSON.stringify(f.value) : '{}';
          }
        } else if (document.activeElement !== ctrl) {
          ctrl.value = f.value;
        }
        field.classList.remove('invalid');
        var err = field.querySelector('.field-error');
        if (err) err.remove();
      });
    }

    function flash(message, isError) {
      var el = document.getElementById('save-state');
      if (!el) return;
      el.textContent = message;
      el.classList.toggle('error', !!isError);
      el.classList.add('show');
      clearTimeout(flash.t);
      flash.t = setTimeout(function () { el.classList.remove('show'); }, 2200);
    }

    function fieldError(key, message) {
      var field = document.querySelector('[data-field="' + key + '"]');
      if (!field) return;
      field.classList.add('invalid');
      var err = field.querySelector('.field-error');
      if (!err) {
        err = document.createElement('div');
        err.className = 'field-error';
        field.appendChild(err);
      }
      err.textContent = message;
    }

    function wireSettings(host) {
      host.addEventListener('click', function (ev) {
        var t = ev.target;
        var cmdBtn = t.closest('[data-cmd]');
        if (cmdBtn) {
          vscode.postMessage({ type: cmdBtn.getAttribute('data-cmd') });
          return;
        }
        var resetBtn = t.closest('[data-reset]');
        if (resetBtn) {
          vscode.postMessage({ type: 'resetConfig', key: resetBtn.getAttribute('data-reset') });
          return;
        }
        var browseBtn = t.closest('[data-browse]');
        if (browseBtn) {
          vscode.postMessage({ type: 'browse', key: browseBtn.getAttribute('data-browse') });
          return;
        }
        var sw = t.closest('.switch');
        if (sw) {
          var next = sw.getAttribute('aria-checked') !== 'true';
          sw.setAttribute('aria-checked', String(next));
          vscode.postMessage({ type: 'setConfig', key: sw.getAttribute('data-key'), value: next });
          return;
        }
        var seg = t.closest('.seg');
        if (seg) {
          var group = seg.parentElement;
          vscode.postMessage({
            type: 'setConfig',
            key: group.getAttribute('data-key'),
            value: seg.getAttribute('data-value'),
          });
        }
      });

      host.addEventListener('change', function (ev) {
        var input = ev.target;
        if (!input.matches('input[data-key]')) return;
        var kind = input.getAttribute('data-kind');
        vscode.postMessage({
          type: 'setConfig',
          key: input.getAttribute('data-key'),
          value: kind === 'number' ? Number(input.value) : input.value,
        });
      });
    }

    /* ── Sessions Hub ───────────────────────────────────────────────────── */

    function filteredSessions() {
      var p = state.sessions;
      if (!p || !Array.isArray(p.sessions)) return [];
      var f = state.hubFilter;
      var q = (f.q || '').trim().toLowerCase();
      return p.sessions.filter(function (s) {
        if (f.showArchived ? !s.archived : s.archived) return false;
        if (f.scope === 'window' && !s.inWindow) return false;
        if (f.source !== 'all' && s.source !== f.source) return false;
        if (f.project && s.project !== f.project) return false;
        if (q && (!s.searchText || s.searchText.indexOf(q) === -1)) return false;
        return true;
      });
    }

    function activeFilterCount() {
      var f = state.hubFilter;
      return (f.scope === 'window' ? 1 : 0) + (f.source !== 'all' ? 1 : 0) + (f.project ? 1 : 0) + (f.showArchived ? 1 : 0);
    }

    /* Grouping follows the order the host already sorts by (live first, then
       most recently updated), so headers only need to be inserted on change. */
    function sessionGroup(s) {
      if (s.active) return 'live';
      var start = new Date(); start.setHours(0, 0, 0, 0);
      var day = start.getTime();
      var ts = s.updatedAt || 0;
      if (ts >= day) return 'today';
      if (ts >= day - 86400000) return 'yesterday';
      if (ts >= day - 6 * 86400000) return 'week';
      return 'older';
    }
    var GROUP_KEY = {
      live: 'ui.sessions.groupLive',
      today: 'ui.sessions.groupToday',
      yesterday: 'ui.sessions.groupYesterday',
      week: 'ui.sessions.groupWeek',
      older: 'ui.sessions.groupOlder',
    };

    function sessionItem(s) {
      var activeCls = s.id === state.selectedSessionId ? ' active' : '';
      var srcBadge = s.source === 'agent'
        ? '<span class="badge agent">' + t('ui.sessions.tagAgent') + '</span>'
        : '<span class="badge">' + t('ui.sessions.tagVscode') + '</span>';
      var archBadge = s.archived ? '<span class="badge archived">' + t('ui.sessions.tagArchived') + '</span>' : '';
      var projText = s.project ? basename(s.project) : basename(s.cwd || s.workspacePath || '');
      var loc = projText + (s.branch ? ' · ' + s.branch : '');
      var stats = [t('ui.sessions.reqCount', s.reqCount || s.userTurns || 0), toks((s.input || 0) + (s.output || 0)) + ' tok'];
      if (s.costUsd !== null && s.costUsd !== undefined) stats.push(cost(s.costUsd));
      return '<button class="sess-item' + activeCls + '" data-session-id="' + esc(s.id) + '">' +
        '<div class="sess-title">' + (s.active ? '<span class="live-dot" title="' + esc(t('ui.sessions.live')) + '"></span>' : '') +
        '<span class="sess-title-text" title="' + esc(s.title) + '">' + esc(s.title) + '</span></div>' +
        '<div class="sess-line">' + srcBadge + archBadge +
        '<span class="sess-proj" title="' + esc(s.project || s.cwd || '') + '">' + esc(loc) + '</span>' +
        '<span class="sess-time" title="' + esc(stamp(s.updatedAt)) + '">' + esc(ago(s.updatedAt)) + '</span></div>' +
        '<div class="sess-line sess-stats">' + stats.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' +
        '</button>';
    }

    function renderSessionList() {
      var listEl = document.getElementById('hub-list');
      var countEl = document.getElementById('hub-count');
      if (!listEl) return;
      var items = filteredSessions();
      if (countEl) countEl.textContent = t('ui.sessions.count', items.length);

      if (!items.length) {
        listEl.innerHTML = '<div class="muted" style="padding:16px 2px;font-size:12px">' + t('ui.sessions.empty') + '</div>';
        return;
      }

      var html = [];
      var current = '';
      items.forEach(function (s) {
        var g = sessionGroup(s);
        if (g !== current) {
          current = g;
          html.push('<div class="sess-group">' + t(GROUP_KEY[g]) + '</div>');
        }
        html.push(sessionItem(s));
      });
      listEl.innerHTML = html.join('');
    }

    function selectedSession() {
      var list = state.sessions && Array.isArray(state.sessions.sessions) ? state.sessions.sessions : [];
      var s = state.selectedSessionId ? list.find(function (x) { return x.id === state.selectedSessionId; }) : null;
      if (!s && state.sessionDetail && state.sessionDetail.session && state.sessionDetail.session.id === state.selectedSessionId) {
        s = state.sessionDetail.session;
      }
      return s || null;
    }

    function readerHead(s) {
      var badges = [];
      if (s.active) badges.push('<span class="badge live">' + t('ui.sessions.live') + '</span>');
      badges.push(s.source === 'agent'
        ? '<span class="badge agent">' + t('ui.sessions.tagAgent') + '</span>'
        : '<span class="badge">' + t('ui.sessions.tagVscode') + '</span>');
      if (s.archived) badges.push('<span class="badge archived">' + t('ui.sessions.tagArchived') + '</span>');

      var kv = [];
      if (s.project) kv.push([t('ui.sessions.fProject'), esc(s.project), '']);
      if (s.cwd || s.workspacePath) kv.push([t('ui.sessions.fFolder'), esc(s.cwd || s.workspacePath), 'mono']);
      if (s.branch) kv.push([t('ui.sessions.fBranch'), esc(s.branch), 'mono']);
      if (s.models && s.models.length) kv.push([t('ui.sessions.fModels'), esc(s.models.join(', ')), '']);
      kv.push([t('ui.sessions.fUpdated'), esc(stamp(s.updatedAt)) + ' <span class="muted">(' + esc(ago(s.updatedAt)) + ')</span>', '']);
      kv.push([t('ui.sessions.fId'), '<code>' + esc(s.rawId) + '</code>', '']);

      var kpis = [
        kpi(t('ui.card.requests'), String(s.reqCount || 0)),
        kpi(t('ui.sessions.kInput'), toks(s.input || 0), s.cached ? toks(s.cached) + ' ' + t('ui.card.cached') : ''),
        kpi(t('ui.sessions.kOutput'), toks(s.output || 0), s.reasoning ? toks(s.reasoning) + ' ' + t('ui.sessions.reasoning') : ''),
      ];
      if (s.rate) kpis.push(kpi('tok/s', rate(s.rate)));
      if (s.costUsd !== null && s.costUsd !== undefined) kpis.push(kpi(t('ui.card.cost'), cost(s.costUsd)));

      return '<button class="btn ghost back-btn" data-hub-back="1">&#8592; ' + t('ui.sessions.back') + '</button>' +
        '<h3 class="reader-title">' + esc(s.title) + '</h3>' +
        '<div class="reader-badges">' + badges.join('') + '</div>' +
        '<dl class="kv">' + kv.map(function (r) { return '<dt>' + r[0] + '</dt><dd class="' + r[2] + '">' + r[1] + '</dd>'; }).join('') + '</dl>' +
        '<div class="reader-kpis">' + kpis.join('') + '</div>';
    }

    /* Everyday actions are buttons; actions that rewrite or remove the
       session on disk are demoted to a quieter link row underneath. */
    function readerActions(s) {
      var id = esc(s.id);
      var main = [];
      if (s.source === 'agent') {
        main.push('<button class="btn primary" data-hub-action="resumeInTerminal" data-id="' + id + '">' + t('ui.sessions.resumeTerminal') + '</button>');
        main.push('<button class="btn" data-hub-action="copyResume" data-id="' + id + '">' + t('ui.sessions.copyResume') + '</button>');
        main.push('<button class="btn" data-hub-action="forkSession" data-id="' + id + '">' + t('ui.sessions.fork') + '</button>');
      }
      if (s.cwd || s.workspacePath) {
        main.push('<button class="btn" data-hub-action="openSessionFolder" data-id="' + id + '">' + t('ui.sessions.openFolder') + '</button>');
      }
      var manage = [];
      if (s.source === 'agent') {
        manage.push('<button class="linkbtn" data-hub-action="moveSession" data-id="' + id + '"' + (s.active ? ' disabled title="' + esc(t('ui.sessions.lockedLive')) + '"' : '') + '>' + t('ui.sessions.move') + '</button>');
      }
      manage.push(s.archived
        ? '<button class="linkbtn" data-hub-action="unarchiveSession" data-id="' + id + '">' + t('ui.sessions.unarchive') + '</button>'
        : '<button class="linkbtn" data-hub-action="archiveSession" data-id="' + id + '">' + t('ui.sessions.archive') + '</button>');
      if (s.source === 'agent') {
        manage.push('<button class="linkbtn danger" data-hub-action="deleteSession" data-id="' + id + '"' + (s.active ? ' disabled title="' + esc(t('ui.sessions.lockedLive')) + '"' : '') + '>' + t('ui.sessions.delete') + '</button>');
      }
      return '<div class="reader-actions">' +
        (main.length ? '<div class="action-grid">' + main.join('') + '</div>' : '') +
        '<div class="manage-row"><span>' + t('ui.sessions.manage') + '</span>' + manage.join('') + '</div>' +
        '</div>';
    }

    function renderSessionReader() {
      var readerEl = document.getElementById('hub-reader');
      if (!readerEl) return;
      var s = selectedSession();
      if (!s) {
        readerEl.innerHTML = '<div class="muted">' + t('ui.sessions.selectHint') + '</div>';
        return;
      }

      var headHtml = readerHead(s) + readerActions(s);
      var msgCount = (s.userTurns || 0) + (s.assistantTurns || 0);
      var arrow = state.detailOpen ? '&#9662;' : '&#9656;';
      var toggleHtml = '<button class="detail-toggle" data-toggle-detail="1" aria-expanded="' + state.detailOpen + '">' +
        '<span class="chevron">' + arrow + '</span>' +
        '<span>' + esc(t('ui.sessions.showConversation')) + '</span>' +
        (msgCount ? '<span class="count-badge" style="margin-left:auto">' + msgCount + '</span>' : '') +
        '</button>';

      if (!state.detailOpen) {
        readerEl.innerHTML = headHtml + toggleHtml;
        return;
      }

      var det = state.sessionDetail;
      if (!det || !det.session || det.session.id !== s.id) {
        if (!state.loadingDetail) {
          state.loadingDetail = true;
          vscode.postMessage({ type: 'sessionDetail', id: s.id });
        }
        readerEl.innerHTML = headHtml + toggleHtml + '<div class="detail-body muted">' + t('ui.sessions.loading') + '</div>';
        return;
      }

      var notices = [];
      if (det.truncated) {
        notices.push('<div class="notice">' + t('ui.sessions.truncated', det.turns.length, det.totalTurns) + '</div>');
      }
      if (det.shutdown && det.shutdown.codeChanges && det.shutdown.codeChanges.filesModifiedCount) {
        var cc = det.shutdown.codeChanges;
        notices.push('<div class="notice">' + t('ui.sessions.codeChanges', cc.filesModifiedCount, cc.linesAdded || 0, cc.linesRemoved || 0) + '</div>');
      }

      var turns = det.turns || [];
      var turnLimit = state.turnLimit || DEFAULT_TURN_LIMIT;
      var hiddenTurns = Math.max(0, turns.length - turnLimit);
      var visibleTurns = hiddenTurns > 0 ? turns.slice(hiddenTurns) : turns;
      var earlierBtn = hiddenTurns > 0
        ? '<button class="btn ghost block" data-load-earlier="1" style="margin-bottom:8px">' +
          t('ui.sessions.loadEarlier', Math.min(20, hiddenTurns)) + ' (' + hiddenTurns + ')</button>'
        : '';
      var bodyHtml = !turns.length
        ? '<div class="muted">' + t('ui.sessions.noTurns') + '</div>'
        : earlierBtn + '<div class="turn-list">' + visibleTurns.map(function (turn) {
          if (turn.role === 'tools') {
            var chips = (turn.tools || []).map(function (tl) {
              return '<span class="tool-chip">' + esc(tl.name) + (tl.count > 1 ? ' ×' + tl.count : '') + '</span>';
            }).join('');
            return '<div class="turn tools"><div class="turn-head"><span class="turn-role">' + t('ui.sessions.roleTools') + '</span>' +
              (turn.ts ? '<span>' + clock(turn.ts) + '</span>' : '') + '</div><div class="tool-chips">' + chips + '</div></div>';
          }
          var cls = turn.role === 'user' ? 'user' : 'assistant';
          var roleLabel = turn.role === 'user' ? t('ui.sessions.roleUser') : t('ui.sessions.roleAssistant');
          var meta = [];
          if (turn.ts) meta.push(clock(turn.ts));
          if (turn.model) meta.push(turn.model);
          if (turn.usage) {
            if (turn.usage.rate) meta.push(rate(turn.usage.rate) + ' tok/s');
            if (turn.usage.output) meta.push(toks(turn.usage.output) + ' ' + t('ui.card.out'));
            if (turn.usage.costUsd !== null && turn.usage.costUsd !== undefined) meta.push(cost(turn.usage.costUsd));
          }
          return '<div class="turn ' + cls + '"><div class="turn-head"><span class="turn-role">' + roleLabel + '</span>' +
            meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') +
            '</div><div class="turn-body">' + esc(turn.text) + '</div></div>';
        }).join('') + '</div>';

      readerEl.innerHTML = headHtml + toggleHtml + '<div class="detail-body">' + notices.join('') + bodyHtml + '</div>';
    }

    function syncHubFilterControls() {
      var qEl = document.getElementById('hub-search');
      if (qEl && document.activeElement !== qEl) qEl.value = state.hubFilter.q || '';
      var scopeEl = document.getElementById('hub-scope');
      if (scopeEl) scopeEl.value = state.hubFilter.scope || 'all';
      var srcEl = document.getElementById('hub-source');
      if (srcEl) srcEl.value = state.hubFilter.source || 'all';
      var projEl = document.getElementById('hub-project');
      if (projEl) projEl.value = state.hubFilter.project || '';
      var archEl = document.getElementById('hub-archived');
      if (archEl) {
        var cnt = state.sessions ? (state.sessions.archivedCount || 0) : 0;
        archEl.textContent = t('ui.sessions.showArchived', cnt);
        archEl.classList.toggle('active-pill', !!state.hubFilter.showArchived);
        archEl.setAttribute('aria-pressed', String(!!state.hubFilter.showArchived));
      }
      var filtersEl = document.getElementById('hub-filters');
      if (filtersEl) filtersEl.style.display = state.filtersOpen ? '' : 'none';
      var fbtn = document.getElementById('hub-filter-btn');
      if (fbtn) {
        var n = activeFilterCount();
        fbtn.setAttribute('aria-pressed', String(!!state.filtersOpen));
        fbtn.innerHTML = ICON_FILTER + (n ? '<span class="dotcount">' + n + '</span>' : '');
      }
    }

    function applyHubMode() {
      var split = document.getElementById('hub-split');
      if (!split) return;
      split.classList.toggle('mode-detail', state.hubMode === 'detail');
      split.classList.toggle('mode-list', state.hubMode !== 'detail');
    }

    function renderSessions() {
      var host = document.getElementById('view-sessions');
      var p = state.sessions;
      if (!p) return;

      if (!document.getElementById('hub-list')) {
        var projOptions = '<option value="">' + t('ui.sessions.allProjects') + '</option>' +
          (p.projects || []).map(function (pr) {
            return '<option value="' + esc(pr) + '">' + esc(pr) + '</option>';
          }).join('');
        host.innerHTML = '<div class="hub-wrap">' +
          '<div class="hub-split mode-list" id="hub-split">' +
          '<div class="hub-left">' +
          '<div class="hub-search-row">' +
          '<input class="input hub-search" id="hub-search" type="search" placeholder="' + esc(t('ui.sessions.searchPlaceholder')) + '" value="' + esc(state.hubFilter.q) + '">' +
          '<button class="icon-btn filter-btn" id="hub-filter-btn" title="' + esc(t('ui.sessions.filters')) + '" aria-label="' + esc(t('ui.sessions.filters')) + '" aria-pressed="false"></button>' +
          '</div>' +
          '<div class="hub-filters" id="hub-filters" style="display:none">' +
          (p.hasWindowRoots
            ? '<select id="hub-scope"><option value="all">' + t('ui.sessions.scopeAll') + '</option><option value="window">' + t('ui.sessions.scopeWindow') + '</option></select>'
            : '') +
          '<select id="hub-source"' + (p.hasWindowRoots ? '' : ' class="full"') + '><option value="all">' + t('ui.sessions.sourceAll') + '</option><option value="agent">' + t('ui.sessions.sourceAgent') + '</option><option value="vscode">' + t('ui.sessions.sourceVscode') + '</option></select>' +
          '<select id="hub-project" class="full">' + projOptions + '</select>' +
          '<button class="btn ghost full" id="hub-archived" aria-pressed="false">' + t('ui.sessions.showArchived', p.archivedCount || 0) + '</button>' +
          '</div>' +
          '<div class="hub-count"><span id="hub-count"></span></div>' +
          '<div class="sess-list" id="hub-list"></div>' +
          '</div>' +
          '<div class="hub-reader" id="hub-reader"></div>' +
          '</div></div>';
      } else {
        var projEl = document.getElementById('hub-project');
        if (projEl) {
          var prevProj = state.hubFilter.project;
          projEl.innerHTML = '<option value="">' + t('ui.sessions.allProjects') + '</option>' +
            (p.projects || []).map(function (pr) {
              return '<option value="' + esc(pr) + '"' + (pr === prevProj ? ' selected' : '') + '>' + esc(pr) + '</option>';
            }).join('');
        }
      }
      syncHubFilterControls();

      var items = filteredSessions();
      if (state.selectedSessionId && !items.some(function (x) { return x.id === state.selectedSessionId; })) {
        state.selectedSessionId = '';
        state.detailOpen = false;
        state.hubMode = 'list';
      }
      if (!state.selectedSessionId && items[0]) {
        state.selectedSessionId = items[0].id;
        state.detailOpen = false;
      }

      applyHubMode();
      renderSessionList();
      renderSessionReader();
    }

    function syncSelectionAfterFilter() {
      var items = filteredSessions();
      if (!items.some(function (x) { return x.id === state.selectedSessionId; })) {
        state.selectedSessionId = items[0] ? items[0].id : '';
        state.detailOpen = false;
        persistUiState({ selectedSessionId: state.selectedSessionId, detailOpen: false });
      }
      renderSessionList();
      renderSessionReader();
    }

    /* ── Shell ──────────────────────────────────────────────────────────── */

    function applyView(view, notifyHost) {
      state.view = view === 'settings' ? 'settings' : (view === 'sessions' ? 'sessions' : 'dashboard');
      document.body.setAttribute('data-view', state.view);
      document.getElementById('view-dashboard').hidden = state.view !== 'dashboard';
      document.getElementById('view-sessions').hidden = state.view !== 'sessions';
      document.getElementById('view-settings').hidden = state.view !== 'settings';
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tabEl) {
        tabEl.setAttribute('aria-selected', String(tabEl.getAttribute('data-view') === state.view));
      });
      if (notifyHost) vscode.postMessage({ type: 'tab', view: state.view });
    }

    function setView(view) {
      applyView(view, true);
    }

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { setView(t.getAttribute('data-view')); });
    });
    window.addEventListener('resize', applyNarrow);
    applyNarrow();
    document.getElementById('refresh').addEventListener('click', function () {
      vscode.postMessage({ type: 'refresh' });
    });
    var openTabBtn = document.getElementById('open-tab');
    if (openTabBtn) {
      openTabBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'openTab' });
      });
    }
    document.getElementById('view-dashboard').addEventListener('click', function (ev) {
      var target = ev.target;
      var winBtn = target && target.closest ? target.closest('[data-window]') : null;
      if (winBtn) {
        state.filter = winBtn.getAttribute('data-window');
        vscode.postMessage({ type: 'filter', window: state.filter });
        Array.prototype.forEach.call(document.querySelectorAll('[data-window]'), function (b) {
          b.setAttribute('aria-pressed', String(b.getAttribute('data-window') === state.filter));
        });
        return;
      }
      var scopeBtn = target && target.closest ? target.closest('[data-scope]') : null;
      if (scopeBtn) {
        vscode.postMessage({ type: 'setScope', value: scopeBtn.getAttribute('data-scope') });
        return;
      }
      var toggleBtn = target && target.closest ? target.closest('[data-toggle-sec]') : null;
      if (toggleBtn) {
        var key = toggleBtn.getAttribute('data-toggle-sec');
        state.dashUi.open[key] = state.dashUi.open[key] === false;
        persistUiState({ dashOpen: state.dashUi.open });
        renderDashboard();
        return;
      }
      var recentBtn = target && target.closest ? target.closest('[data-recent-action]') : null;
      if (recentBtn) {
        var act = recentBtn.getAttribute('data-recent-action');
        var total = state.data && state.data.requests ? state.data.requests.length : 0;
        if (act === 'more') state.dashUi.recentLimit = (state.dashUi.recentLimit || DEFAULT_RECENT_LIMIT) + 20;
        else if (act === 'all') state.dashUi.recentLimit = total || 200;
        else if (act === 'less') state.dashUi.recentLimit = DEFAULT_RECENT_LIMIT;
        persistUiState({ recentLimit: state.dashUi.recentLimit });
        renderDashboard();
      }
    });
    document.getElementById('view-sessions').addEventListener('input', function (ev) {
      if (ev.target && ev.target.id === 'hub-search') {
        state.hubFilter.q = ev.target.value;
        persistUiState({ hubFilter: state.hubFilter });
        renderSessionList();
      }
    });
    document.getElementById('view-sessions').addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el) return;
      if (el.id === 'hub-scope') state.hubFilter.scope = el.value;
      else if (el.id === 'hub-source') state.hubFilter.source = el.value;
      else if (el.id === 'hub-project') state.hubFilter.project = el.value;
      else return;
      persistUiState({ hubFilter: state.hubFilter });
      syncSelectionAfterFilter();
    });
    document.getElementById('view-sessions').addEventListener('click', function (ev) {
      var backBtn = ev.target && ev.target.closest ? ev.target.closest('[data-hub-back]') : null;
      if (backBtn) {
        state.hubMode = 'list';
        applyHubMode();
        renderSessionList();
        window.scrollTo(0, state.listScroll || 0);
        return;
      }
      var filterBtn = ev.target && ev.target.closest ? ev.target.closest('#hub-filter-btn') : null;
      if (filterBtn) {
        state.filtersOpen = !state.filtersOpen;
        syncHubFilterControls();
        return;
      }
      var archBtn = ev.target && ev.target.closest ? ev.target.closest('#hub-archived') : null;
      if (archBtn) {
        state.hubFilter.showArchived = !state.hubFilter.showArchived;
        syncHubFilterControls();
        persistUiState({ hubFilter: state.hubFilter });
        syncSelectionAfterFilter();
        return;
      }
      var toggleDet = ev.target && ev.target.closest ? ev.target.closest('[data-toggle-detail]') : null;
      if (toggleDet) {
        state.detailOpen = !state.detailOpen;
        persistUiState({ detailOpen: state.detailOpen });
        if (state.detailOpen && state.selectedSessionId && (!state.sessionDetail || !state.sessionDetail.session || state.sessionDetail.session.id !== state.selectedSessionId)) {
          state.loadingDetail = true;
          vscode.postMessage({ type: 'sessionDetail', id: state.selectedSessionId });
        }
        renderSessionReader();
        return;
      }
      var earlier = ev.target && ev.target.closest ? ev.target.closest('[data-load-earlier]') : null;
      if (earlier) {
        state.turnLimit = (state.turnLimit || DEFAULT_TURN_LIMIT) + 20;
        persistUiState({ turnLimit: state.turnLimit });
        renderSessionReader();
        return;
      }
      var act = ev.target && ev.target.closest ? ev.target.closest('[data-hub-action]') : null;
      if (act) {
        vscode.postMessage({ type: act.getAttribute('data-hub-action'), id: act.getAttribute('data-id') });
        return;
      }
      var item = ev.target && ev.target.closest ? ev.target.closest('[data-session-id]') : null;
      if (!item) return;
      var id = item.getAttribute('data-session-id');
      state.selectedSessionId = id;
      state.detailOpen = false;
      state.turnLimit = DEFAULT_TURN_LIMIT;
      state.loadingDetail = false;
      persistUiState({ selectedSessionId: id, detailOpen: false, turnLimit: DEFAULT_TURN_LIMIT });
      if (document.body.classList.contains('narrow')) {
        state.listScroll = window.scrollY;
        state.hubMode = 'detail';
        applyHubMode();
        window.scrollTo(0, 0);
      }
      renderSessionList();
      renderSessionReader();
    });

    window.addEventListener('message', function (event) {
      var msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'uiState') {
        var u = msg.payload || {};
        if (u.filter) state.filter = u.filter;
        if (u.dashOpen) state.dashUi.open = u.dashOpen;
        if (u.recentLimit) state.dashUi.recentLimit = u.recentLimit;
        if (u.hubFilter) state.hubFilter = Object.assign({}, state.hubFilter, u.hubFilter);
        if (u.selectedSessionId !== undefined) state.selectedSessionId = u.selectedSessionId || '';
        if (u.detailOpen !== undefined) state.detailOpen = !!u.detailOpen;
        if (u.turnLimit) state.turnLimit = u.turnLimit;
        if (u.view) applyView(u.view, false);
        if (state.data) renderDashboard();
        if (state.sessions) renderSessions();
      } else if (msg.type === 'data') {
        state.data = msg.payload;
        if (msg.payload.window) state.filter = msg.payload.window;
        renderDashboard();
      } else if (msg.type === 'sessions') {
        state.sessions = msg.payload;
        renderSessions();
      } else if (msg.type === 'sessionDetail') {
        state.loadingDetail = false;
        state.sessionDetail = msg.payload;
        renderSessionReader();
      } else if (msg.type === 'settings') {
        state.settings = msg.payload;
        if (!document.querySelector('[data-field]')) renderSettings();
        else syncSettings();
      } else if (msg.type === 'configResult') {
        if (msg.ok) flash(t('ui.settings.saved'));
        else {
          flash(t('ui.settings.notSaved'), true);
          if (msg.key) fieldError(msg.key, msg.message || t('ui.settings.rejected'));
        }
      } else if (msg.type === 'error') {
        flash(msg.message || t('ui.settings.rejected'), true);
      }
    });

    vscode.postMessage({ type: 'ready', view: state.view });
  `;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;" />
<title>Copilot Speedometer</title>
<style>${style}</style>
</head>
<body data-view="dashboard" class="${isSidebar ? 'sidebar' : ''}">
<header>
  <div class="brand" title="Copilot Speedometer">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 1-4.6 1.9l1.06 1.06A5 5 0 1 0 8 3v-1.5z"/><path d="M7.25 3h1.5v4.7l3.1 1.8-.75 1.3-3.85-2.2z"/></svg>
    <span class="brand-text">Copilot Speedometer</span>
  </div>
  <nav class="tabs" role="tablist">
    <button class="tab" role="tab" data-view="dashboard" aria-selected="true">${tr('ui.tab.dashboard')}</button>
    <button class="tab" role="tab" data-view="sessions" aria-selected="false">${tr('ui.tab.sessions')}</button>
    <button class="tab" role="tab" data-view="settings" aria-selected="false">${tr('ui.tab.settings')}</button>
  </nav>
  <span class="spacer"></span>
  <div class="head-actions">
    <button class="icon-btn" id="refresh" title="${tr('ui.refresh')}" aria-label="${tr('ui.refresh')}"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.45 5.17A6 6 0 1 0 14 8h-1.5a4.5 4.5 0 1 1-.9-2.7L9.5 7.5H14V3z"/></svg></button>
    ${isSidebar ? `<button class="icon-btn" id="open-tab" title="${tr('ui.openTab')}" aria-label="${tr('ui.openTab')}"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5h-1.5V4.56L7.53 9.53 6.47 8.47l4.97-4.97H9zM3 4h4v1.5H3.5v7h7V9H12v4H2V4z"/></svg></button>` : ''}
  </div>
</header>
<div id="view-dashboard" class="view"></div>
<div id="view-sessions" class="view" hidden></div>
<div id="view-settings" class="view" hidden></div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

module.exports = { html };
