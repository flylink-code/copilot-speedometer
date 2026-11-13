'use strict';

/** Dashboard webview. The host sends fully aggregated payloads; the script only renders. */

function html(nonce, cspSource) {
  const style = `
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 0 18px 24px;
    }
    header {
      position: sticky; top: 0; z-index: 3;
      display: flex; align-items: center; gap: 8px;
      padding: 14px 0 10px; margin-bottom: 2px;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    h1 { font-size: 14px; font-weight: 600; margin: 0; white-space: nowrap; }
    .spacer { flex: 1; }
    button, select {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; border-radius: 3px; padding: 4px 10px;
      font-size: 12px; cursor: pointer; font-family: inherit;
    }
    button:hover, select:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 10px; margin: 16px 0 8px; }
    .card {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px; padding: 10px 12px;
    }
    .card .label { font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
    .card .value { font-size: 22px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .card .sub { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
    .card.accent .value { color: var(--vscode-charts-blue, #3794ff); font-size: 26px; }
    section { margin-top: 18px; }
    h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
         color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
    th { text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground);
         padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    td { padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    tbody tr:hover td { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.15)); }
    .num { text-align: right; }
    .rate { color: var(--vscode-charts-blue, #3794ff); font-weight: 600; }
    .muted { color: var(--vscode-descriptionForeground); }
    .mono { font-family: var(--vscode-editor-font-family); }
    .chart { display: block; width: 100%; height: 150px; }
    .chart rect { fill: var(--vscode-charts-blue, #3794ff); opacity: .85; }
    .chart rect:hover { opacity: 1; }
    .chart .axis { stroke: var(--vscode-panel-border); stroke-width: 1; }
    .empty {
      border: 1px dashed var(--vscode-panel-border); border-radius: 8px;
      padding: 18px 20px; margin-top: 18px; line-height: 1.7;
    }
    .empty h2 { color: var(--vscode-foreground); text-transform: none; letter-spacing: 0; font-size: 13px; }
    code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; }
    .tablewrap { overflow-x: auto; }
    .tag { font-size: 9px; letter-spacing: .04em; padding: 0 4px; border-radius: 3px; margin-left: 6px;
      border: 1px solid var(--vscode-descriptionForeground, #8b8b8b); opacity: .65; vertical-align: 1px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
    .path { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); word-break: break-all; }
  `;

  const script = `
    var vscode = acquireVsCodeApi();
    var state = { data: null, filter: 'today' };

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
        lines.push('<div class="row"><button class="primary" id="btn-refresh">Refresh</button></div>');
      }
      if (!s.loggingEnabled) {
        lines.push('<div style="margin-top:10px">Copilot debug logging is <b>off</b>. It is optional but adds per-call token ' +
          'counts for models whose endpoint reports no usage.</div>');
        lines.push('<div class="row"><button class="' + (usageOk ? '' : 'primary') + '" id="btn-enable">Enable Copilot debug logging</button></div>');
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

    function render() {
      var a = state.data;
      if (!a) return;
      var root = document.getElementById('root');
      var body;
      if (!a.hasData) {
        body = setup(a);
      } else {
        body = '<div class="cards">' + cards(a) + '</div>' +
          '<section><h2>tok/s per response</h2>' + chart(a.series) + '</section>' +
          '<section><h2>By model</h2>' + modelTable(a.models) + '</section>' +
          '<section><h2>Recent requests</h2>' + requestTable(a.requests) + '</section>';
      }
      root.innerHTML = body;
      var enable = document.getElementById('btn-enable');
      if (enable) enable.onclick = function () { vscode.postMessage({ type: 'enableLogging' }); };
      var refresh = document.getElementById('btn-refresh');
      if (refresh) refresh.onclick = function () { vscode.postMessage({ type: 'refresh' }); };
    }

    document.getElementById('filter').addEventListener('change', function (e) {
      state.filter = e.target.value;
      vscode.postMessage({ type: 'filter', window: state.filter });
    });
    document.getElementById('refresh').addEventListener('click', function () {
      vscode.postMessage({ type: 'refresh' });
    });

    window.addEventListener('message', function (event) {
      var msg = event.data;
      if (!msg || msg.type !== 'data') return;
      state.data = msg.payload;
      if (msg.payload.window) {
        state.filter = msg.payload.window;
        document.getElementById('filter').value = msg.payload.window;
      }
      render();
    });
    vscode.postMessage({ type: 'ready', window: state.filter });
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;" />
<title>Copilot Speedometer</title>
<style>${style}</style>
</head>
<body>
<header>
  <h1>Copilot Speedometer</h1>
  <span class="spacer"></span>
  <select id="filter" title="Time window">
    <option value="today">Today</option>
    <option value="7d">Last 7 days</option>
    <option value="all">All captured</option>
  </select>
  <button id="refresh">Refresh</button>
</header>
<div id="root"></div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

module.exports = { html };
