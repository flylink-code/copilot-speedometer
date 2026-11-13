'use strict';

/**
 * Dashboard + Settings webview.
 *
 * The host sends fully aggregated payloads; this script only renders and
 * forwards user intent. Two views ('dashboard', 'settings') live in one page so
 * switching tabs costs no extra round trip, and each view keeps its own state.
 */

function html(nonce, cspSource) {
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
      --blue: var(--vscode-charts-blue, #3794ff);
      --green: var(--vscode-testing-iconPassed, #3fb950);
      --red: var(--vscode-errorForeground, #f85149);
      --mono: var(--vscode-editor-font-family, monospace);
      --radius: 6px;
      --h-control: 26px;
    }
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      margin: 0;
      padding: 0 20px 28px;
    }
    button, select, input { font-family: inherit; font-size: 12px; color: inherit; }
    :focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }

    header {
      position: sticky; top: 0; z-index: 3;
      display: flex; align-items: center; gap: 10px;
      padding: 12px 0 0;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; white-space: nowrap; }
    .brand svg { width: 14px; height: 14px; fill: var(--blue); }
    .tabs { display: flex; gap: 2px; margin-left: 4px; }
    .tab {
      background: none; border: none; border-bottom: 2px solid transparent;
      padding: 7px 10px 6px; margin-bottom: -1px; cursor: pointer;
      color: var(--fg-dim); font-size: 12px;
    }
    .tab:hover { color: var(--fg); }
    .tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
    .spacer { flex: 1; }
    select {
      background: var(--vscode-dropdown-background, var(--input-bg));
      color: var(--vscode-dropdown-foreground, var(--fg));
      border: 1px solid var(--vscode-dropdown-border, var(--border));
      border-radius: 4px; height: var(--h-control); padding: 0 6px; cursor: pointer;
    }
    .btn {
      display: inline-flex; align-items: center; gap: 5px; justify-content: center;
      background: var(--btn-sec-bg); color: var(--btn-sec-fg);
      border: none; border-radius: 4px; height: var(--h-control); padding: 0 11px;
      cursor: pointer; white-space: nowrap;
    }
    .btn:hover { background: var(--btn-sec-hover); }
    .btn.primary { background: var(--btn-bg); color: var(--btn-fg); }
    .btn.primary:hover { background: var(--btn-hover); }
    .btn[disabled] { opacity: .5; cursor: default; }
    .view[hidden] { display: none !important; }

    /* ── Dashboard ───────────────────────────────────────────────────────── */
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(152px, 1fr)); gap: 10px; margin: 16px 0 8px; }
    .card {
      background: var(--vscode-editorWidget-background, rgba(128,128,128,.07));
      border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px;
    }
    .card .label { font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--fg-dim); }
    .card .value { font-size: 22px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .card .sub { font-size: 11px; color: var(--fg-dim); margin-top: 3px; }
    .card.accent .value { color: var(--blue); font-size: 26px; }
    section.block { margin-top: 20px; }
    h2.block-title {
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
      color: var(--fg-dim); margin: 0 0 8px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
    th { text-align: left; font-weight: 600; color: var(--fg-dim); padding: 5px 8px; border-bottom: 1px solid var(--border); }
    td { padding: 5px 8px; border-bottom: 1px solid var(--border); }
    tbody tr:hover td { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.12)); }
    .num { text-align: right; }
    .rate { color: var(--blue); font-weight: 600; }
    .muted { color: var(--fg-dim); }
    .mono { font-family: var(--mono); }
    .chart { display: block; width: 100%; height: 150px; }
    .chart rect { fill: var(--blue); opacity: .85; }
    .chart rect:hover { opacity: 1; }
    .chart .axis { stroke: var(--border); stroke-width: 1; }
    .tablewrap { overflow-x: auto; }
    .tag { font-size: 9px; letter-spacing: .04em; padding: 0 4px; border-radius: 3px; margin-left: 6px;
      border: 1px solid var(--fg-dim); opacity: .7; vertical-align: 1px; }
    .empty {
      border: 1px dashed var(--border); border-radius: 8px;
      padding: 18px 20px; margin-top: 18px; line-height: 1.7;
    }
    .empty h2 { color: var(--fg); text-transform: none; letter-spacing: 0; font-size: 13px; margin: 0 0 6px; }
    code { font-family: var(--mono); background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.14));
      padding: 1px 5px; border-radius: 3px; }
    .path { font-family: var(--mono); font-size: 11px; color: var(--fg-dim); word-break: break-all; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }

    /* ── Settings ────────────────────────────────────────────────────────── */
    .settings-wrap { max-width: 820px; padding-top: 18px; }
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
    .sec-blurb { margin: 0 0 10px; font-size: 12px; color: var(--fg-dim); max-width: 62ch; }
    .field {
      display: grid; grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px 20px; align-items: center;
      padding: 9px 0; border-bottom: 1px solid transparent;
    }
    .field + .field { border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent); }
    .field-text { min-width: 0; }
    .field-label { display: block; font-size: 12px; color: var(--fg); }
    .field-hint { margin-top: 2px; font-size: 11px; line-height: 1.45; color: var(--fg-dim); max-width: 66ch; }
    .field-control { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
    .field-error { grid-column: 1 / -1; margin-top: -2px; font-size: 11px; color: var(--red); }
    .field.invalid .input, .field.invalid .segmented { outline: 1px solid var(--red); }
    .input {
      background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--input-border); border-radius: 4px;
      height: var(--h-control); padding: 0 8px; min-width: 0;
    }
    .input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
    .input-num { width: 96px; text-align: right; font-variant-numeric: tabular-nums; }
    .input-text { width: 300px; font-family: var(--mono); font-size: 11px; }
    .unit { font-size: 11px; color: var(--fg-dim); min-width: 44px; }
    .switch {
      position: relative; width: 34px; height: 20px; border-radius: 10px; padding: 0;
      border: 1px solid var(--border); background: var(--input-bg); cursor: pointer;
      transition: background .12s, border-color .12s;
    }
    .switch::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
      border-radius: 50%; background: var(--fg-dim); transition: transform .12s, background .12s;
    }
    .switch[aria-checked="true"] { background: var(--btn-bg); border-color: var(--btn-bg); }
    .switch[aria-checked="true"]::after { transform: translateX(14px); background: var(--btn-fg); }
    .segmented {
      display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden;
    }
    .seg {
      background: none; border: none; padding: 0 10px; height: 24px; cursor: pointer;
      color: var(--fg-dim); font-size: 11.5px; border-right: 1px solid var(--border);
    }
    .seg:last-child { border-right: none; }
    .seg:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.12)); }
    .seg[aria-pressed="true"] { background: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,.22)); color: var(--fg); font-weight: 600; }
    .btn-reset {
      background: none; border: none; color: var(--fg-dim); cursor: pointer;
      width: 22px; height: 22px; border-radius: 4px; padding: 0; visibility: hidden; font-size: 13px;
    }
    .field.modified .btn-reset { visibility: visible; }
    .btn-reset:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.16)); color: var(--fg); }
    .source {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--vscode-editorWidget-background, rgba(128,128,128,.05)); margin-bottom: 8px;
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
  `;

  const script = `
    var vscode = acquireVsCodeApi();
    var state = { view: 'dashboard', data: null, settings: null, filter: 'today' };

    function esc(s) {
      return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function n(v, d) {
      if (v === null || v === undefined || !isFinite(v)) return '--';
      return Number(v).toFixed(d === undefined ? 1 : d);
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

    /* ── Dashboard ──────────────────────────────────────────────────────── */

    function cards(a) {
      return '' +
        '<div class="card accent"><div class="label">Last response</div>' +
        '<div class="value">' + rate(a.lastRate) + ' <span style="font-size:12px">tok/s</span></div>' +
        '<div class="sub">' + esc(a.lastModel || '--') + ' \\u00b7 ' + toks(a.lastOutput) + ' tokens</div></div>' +
        '<div class="card"><div class="label">Average (weighted)</div>' +
        '<div class="value">' + rate(a.agg.rate) + '</div>' +
        '<div class="sub">' + toks(a.agg.output) + ' out / ' + dur(a.agg.durMs) + '</div></div>' +
        '<div class="card"><div class="label">Median / p90</div>' +
        '<div class="value">' + rate(a.agg.medianRate) + ' <span style="font-size:12px" class="muted">/ ' + rate(a.agg.p90Rate) + '</span></div>' +
        '<div class="sub">per-response tok/s</div></div>' +
        '<div class="card"><div class="label">Requests</div>' +
        '<div class="value">' + (a.agg.count || 0) + '</div>' +
        '<div class="sub">' + toks(a.agg.input) + ' in \\u00b7 ' + toks(a.agg.cached) + ' cached</div></div>' +
        (a.agg.ttftMs
          ? '<div class="card"><div class="label">TTFT (avg)</div><div class="value">' + dur(a.agg.ttftMs) +
            '</div><div class="sub">first token latency</div></div>'
          : '') +
        (a.agg.decodeRate
          ? '<div class="card"><div class="label">Decode rate</div><div class="value">' + rate(a.agg.decodeRate) +
            '</div><div class="sub">TTFT ' + dur(a.agg.ttftMs) + ' excluded</div></div>'
          : '');
    }

    function chart(points) {
      if (!points.length) return '<div class="muted">No samples in this window.</div>';
      var w = 800, h = 150, pad = 6;
      var max = Math.max.apply(null, points.map(function (p) { return p.rate || 0; }).concat([1]));
      var bw = Math.max(2, (w - pad * 2) / points.length - 1);
      var bars = points.map(function (p, i) {
        var bh = Math.max(1, ((p.rate || 0) / max) * (h - 24));
        var x = pad + i * (bw + 1);
        return '<rect x="' + x.toFixed(1) + '" y="' + (h - 18 - bh).toFixed(1) + '" width="' + bw.toFixed(1) +
          '" height="' + bh.toFixed(1) + '"><title>' + clock(p.ts) + ' \\u2014 ' + rate(p.rate) + ' tok/s \\u2014 ' +
          esc(p.model) + ' (' + p.output + ' tok / ' + dur(p.durMs) + ')</title></rect>';
      }).join('');
      return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<line class="axis" x1="0" y1="' + (h - 18) + '" x2="' + w + '" y2="' + (h - 18) + '"/>' + bars + '</svg>' +
        '<div class="muted" style="font-size:11px;display:flex;justify-content:space-between">' +
        '<span>peak ' + rate(max) + ' tok/s</span><span>last ' + points.length + ' responses</span></div>';
    }

    function modelTable(rows) {
      if (!rows.length) return '<div class="muted">No data.</div>';
      var head = '<tr><th>Model</th><th class="num">Req</th><th class="num">tok/s</th><th class="num">median</th>' +
        '<th class="num">p90</th><th class="num">out</th><th class="num">in</th><th class="num">avg dur</th></tr>';
      var body = rows.map(function (r) {
        return '<tr><td class="mono">' + esc(r.model) + '</td><td class="num">' + r.count + '</td>' +
          '<td class="num rate">' + rate(r.rate) + '</td><td class="num">' + rate(r.medianRate) + '</td>' +
          '<td class="num">' + rate(r.p90Rate) + '</td><td class="num">' + toks(r.output) + '</td>' +
          '<td class="num">' + toks(r.input) + '</td><td class="num">' + dur(r.durMs / Math.max(1, r.count)) + '</td></tr>';
      }).join('');
      return '<div class="tablewrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    }

    function requestTable(rows) {
      if (!rows.length) return '<div class="muted">No data.</div>';
      var head = '<tr><th>Time</th><th>Model</th><th class="num">tok/s</th><th class="num">out</th>' +
        '<th class="num">in</th><th class="num">cached</th><th class="num">duration</th><th class="num">ttft</th></tr>';
      var body = rows.map(function (r) {
        return '<tr><td class="mono">' + clock(r.ts) + '</td><td class="mono">' + esc(r.model) +
          (r.byok ? ' <span class="tag">BYOK</span>' : '') + '</td>' +
          '<td class="num rate">' + rate(r.rate) + '</td><td class="num">' + r.output + '</td>' +
          '<td class="num">' + toks(r.input) + '</td><td class="num">' + toks(r.cached) + '</td>' +
          '<td class="num">' + dur(r.durMs) + '</td><td class="num">' + (r.ttftMs ? dur(r.ttftMs) : '--') + '</td></tr>';
      }).join('');
      return '<div class="tablewrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    }

    function setup(a) {
      var s = a.setup || {};
      var usageOk = !!(s.usageEnabled && s.usageRoots && s.usageRoots.length);
      var lines = [];
      lines.push('<div class="empty"><h2>No model calls captured yet</h2>');
      if (usageOk) {
        lines.push('<div>Watching the Copilot agent usage records - one is written as soon as a request finishes. ' +
          'Send a message in Copilot Chat, then press Refresh.</div>');
        lines.push('<div class="row"><button class="btn primary" id="btn-refresh">Refresh</button>' +
          '<button class="btn" id="btn-open-settings">Settings</button></div>');
      }
      if (!s.loggingEnabled) {
        lines.push('<div style="margin-top:10px">Copilot debug logging is <b>off</b>. It is optional but adds per-call token ' +
          'counts for models whose endpoint reports no usage.</div>');
        lines.push('<div class="row"><button class="btn ' + (usageOk ? '' : 'primary') + '" id="btn-enable">Enable Copilot debug logging</button></div>');
      }
      if (s.roots && s.roots.length) {
        lines.push('<div style="margin-top:10px" class="muted">Watched debug-log roots:</div>');
        lines.push(s.roots.map(function (r) { return '<div class="path">' + esc(r) + '</div>'; }).join(''));
      } else {
        lines.push('<div style="margin-top:10px" class="muted">No Copilot debug-log directory found. Expected something like:</div>');
        lines.push('<div class="path">%APPDATA%\\\\Code\\\\User\\\\globalStorage\\\\github.copilot-chat\\\\debug-logs</div>');
      }
      if (usageOk) {
        lines.push('<div style="margin-top:10px" class="muted">Watched usage-event roots:</div>');
        lines.push(s.usageRoots.map(function (r) { return '<div class="path">' + esc(r) + '</div>'; }).join(''));
      }
      lines.push('<div style="margin-top:10px" class="muted">tok/s = outputTokens / (duration / 1000). Usage records from the ' +
        'agent also carry TTFT, so BYOK / custom-endpoint models show up there even when debug logs are off.</div>');
      lines.push('</div>');
      return lines.join('');
    }

    function renderDashboard() {
      var a = state.data;
      if (!a) return;
      var root = document.getElementById('view-dashboard');
      var body;
      if (!a.hasData) {
        body = setup(a);
      } else {
        body = '<div class="cards">' + cards(a) + '</div>' +
          '<section class="block"><h2 class="block-title">tok/s per response</h2>' + chart(a.series) + '</section>' +
          '<section class="block"><h2 class="block-title">By model</h2>' + modelTable(a.models) + '</section>' +
          '<section class="block"><h2 class="block-title">Recent requests</h2>' + requestTable(a.requests) + '</section>';
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

    var COPY = {
      enabled: ['Enable Copilot Speedometer', 'Turn collection and the status-bar item off without uninstalling the extension.'],
      usageEvents: ['Read agent usage records', 'Per-request token counts from Copilot agent sessions. Covers BYOK and custom endpoints with no extra setup.'],
      usageEventsRoot: ['Usage records folder', 'Leave empty to auto-discover. Override only if Copilot stores sessions elsewhere.'],
      logPath: ['Chat debug-log folder', 'Optional. Leave empty to search the usual Visual Studio Code globalStorage paths.'],
      includeLegacyWorkspaceLogs: ['Scan legacy workspace logs', 'Older Copilot builds wrote debug logs per workspace instead of per user.'],
      copilotDebugLogging: ['Copilot chat debug logging', 'Writes one llm_request line per call. Useful for models whose endpoint reports no token usage.'],
      pollIntervalMs: ['Poll interval', 'How often the session files are tailed for new records.'],
      historySize: ['History size', 'Requests kept in memory. Older records are dropped first.'],
      backfillDays: ['Startup backfill', 'Days of history read on activation. The All window always triggers a deep scan.'],
      statusBar: ['Show status-bar item', 'Live tok/s next to the clock, refreshed after every captured response.'],
      statusBarFormat: ['Status-bar content', ''],
    };
    var SEG_LABEL = {
      'rate': 'value',
      'rate-model': 'value + model',
      'rate-ttft': 'value + TTFT',
    };

    var CONTROL = {
      key: function (f) {
        var c = COPY[f.key] || [f.key, ''];
        return '<div class="field-text"><label class="field-label" for="f-' + f.key + '">' + esc(c[0]) + '</label>' +
          (c[1] ? '<div class="field-hint">' + esc(c[1]) + '</div>' : '') + '</div>';
      },
      reset: function (f) {
        return '<button class="btn-reset" data-reset="' + f.key + '" title="Reset to default" aria-label="Reset to default">&#8635;</button>';
      },
    };

    function control(f) {
      if (f.type === 'boolean') {
        return '<button class="switch" role="switch" data-key="' + f.key + '" data-kind="boolean" id="f-' + f.key +
          '" aria-checked="' + (!!f.value) + '" aria-label="' + esc((COPY[f.key] || [f.key])[0]) + '"></button>';
      }
      if (f.type === 'number') {
        return '<input class="input input-num" type="number" data-key="' + f.key + '" data-kind="number" id="f-' + f.key +
          '" value="' + f.value + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '">' +
          '<span class="unit">' + (f.unit || '') + '</span>';
      }
      if (f.type === 'enum') {
        return '<div class="segmented" role="group" data-key="' + f.key + '" data-kind="enum">' +
          f.options.map(function (o) {
            return '<button class="seg" data-value="' + o + '" aria-pressed="' + (f.value === o) + '">' +
              esc(SEG_LABEL[o] || o) + '</button>';
          }).join('') + '</div>';
      }
      return '<input class="input input-text" type="text" data-key="' + f.key + '" data-kind="path" id="f-' + f.key +
        '" value="' + esc(f.value) + '" spellcheck="false" placeholder="(auto-discover)">' +
        '<button class="btn" data-browse="' + f.key + '" title="Browse">Browse</button>';
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
      htmlParts.push('<div class="settings-head"><div><h2>Settings</h2>' +
        '<p class="muted">Changes are written to your user settings and apply immediately.</p></div>' +
        '<span class="save-state" id="save-state"></span></div>');

      s.sections.forEach(function (sec) {
        if (sec.id === 'general') return;
        var fields = s.fields.filter(function (f) { return f.section === sec.id; });
        if (!fields.length) return;
        status = '';
        htmlParts.push('<section class="sec"><div class="sec-title">' + esc(sec.title) + '</div>' +
          (sec.blurb ? '<p class="sec-blurb">' + esc(sec.blurb) + '</p>' : ''));

        if (sec.id === 'sources') {
          status = '<div class="status-caption">Live status</div>' +
            sourceCard('Agent usage records', usage.exists,
              usage.root || '(not set)',
              usage.exists
                ? usage.files + ' session file(s) \\u00b7 ' + captured.usage + ' records captured'
                : 'Folder not found - runs are only recorded while Copilot agent sessions exist',
              usage.exists ? 'revealUsageRoot' : '', 'Reveal') +
            sourceCard('Chat debug logs', logs.roots.length > 0,
              logs.roots.length ? logs.roots[0] : '(none found)',
              logs.roots.length
                ? logs.roots.length + ' root(s) \\u00b7 logging ' + (logs.enabled ? 'on' : 'off')
                : 'Optional source - enable Copilot debug logging below',
              '', '');
        }

        fields.forEach(function (f) {
          htmlParts.push('<div class="field' + (f.modified ? ' modified' : '') + '" data-field="' + f.key + '">' +
            CONTROL.key(f) + '<div class="field-control">' + control(f) + CONTROL.reset(f) + '</div></div>');
        });
        if (status) htmlParts.push(status);
        htmlParts.push('</section>');
      });

      htmlParts.push('<section class="sec"><div class="sec-title">Maintenance</div>' +
        '<p class="sec-blurb">' + captured.total + ' request(s) in memory (usage ' + captured.usage +
        ' \\u00b7 BYOK ' + captured.byok + ').</p>' +
        '<div class="actions">' +
        '<button class="btn" data-cmd="refresh">Refresh now</button>' +
        '<button class="btn" data-cmd="diagnostics">Diagnostics</button>' +
        '<button class="btn" data-cmd="exportJson">Export JSON</button>' +
        '<button class="btn" data-cmd="clearHistory">Clear captured history</button>' +
        '<button class="btn" data-cmd="openVsCodeSettings">Open VS Code settings</button>' +
        '</div></section>');

      htmlParts.push('<div class="footnote">tok/s = output tokens / duration. Settings are stored under ' +
        '<code>copilotSpeedometer.*</code> in your global settings.json.</div>');
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

    /* ── Shell ──────────────────────────────────────────────────────────── */

    function setView(view) {
      state.view = view === 'settings' ? 'settings' : 'dashboard';
      document.body.setAttribute('data-view', state.view);
      document.getElementById('view-dashboard').hidden = state.view !== 'dashboard';
      document.getElementById('view-settings').hidden = state.view !== 'settings';
      document.getElementById('filter').style.display = state.view === 'dashboard' ? '' : 'none';
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
        t.setAttribute('aria-selected', String(t.getAttribute('data-view') === state.view));
      });
      vscode.postMessage({ type: 'tab', view: state.view });
    }

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { setView(t.getAttribute('data-view')); });
    });
    document.getElementById('filter').addEventListener('change', function (e) {
      state.filter = e.target.value;
      vscode.postMessage({ type: 'filter', window: state.filter });
    });
    document.getElementById('refresh').addEventListener('click', function () {
      vscode.postMessage({ type: 'refresh' });
    });

    window.addEventListener('message', function (event) {
      var msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'data') {
        state.data = msg.payload;
        if (msg.payload.window) {
          state.filter = msg.payload.window;
          document.getElementById('filter').value = msg.payload.window;
        }
        renderDashboard();
      } else if (msg.type === 'settings') {
        state.settings = msg.payload;
        if (!document.querySelector('[data-field]')) renderSettings();
        else syncSettings();
      } else if (msg.type === 'configResult') {
        if (msg.ok) flash('Saved');
        else {
          flash('Not saved', true);
          if (msg.key) fieldError(msg.key, msg.message || 'Rejected.');
        }
      } else if (msg.type === 'error') {
        flash(msg.message || 'Error', true);
      }
    });

    vscode.postMessage({ type: 'ready', view: state.view });
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;" />
<title>Copilot Speedometer</title>
<style>${style}</style>
</head>
<body data-view="dashboard">
<header>
  <div class="brand">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 1-4.6 1.9l1.06 1.06A5 5 0 1 0 8 3v-1.5z"/><path d="M7.25 3h1.5v4.7l3.1 1.8-.75 1.3-3.85-2.2z"/></svg>
    Copilot Speedometer
  </div>
  <nav class="tabs" role="tablist">
    <button class="tab" role="tab" data-view="dashboard" aria-selected="true">Dashboard</button>
    <button class="tab" role="tab" data-view="settings" aria-selected="false">Settings</button>
  </nav>
  <span class="spacer"></span>
  <select id="filter" title="Time window">
    <option value="today">Today</option>
    <option value="7d">Last 7 days</option>
    <option value="all">All captured</option>
  </select>
  <button class="btn" id="refresh">Refresh</button>
</header>
<div id="view-dashboard" class="view"></div>
<div id="view-settings" class="view" hidden></div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

module.exports = { html };
