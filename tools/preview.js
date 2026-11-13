'use strict';

/**
 * Renders the dashboard webview to a standalone HTML file with synthetic data,
 * so the UI can be previewed in a browser (and screenshotted) without VS Code.
 *
 *   node tools/preview.js  ->  docs/preview.html
 */

const fs = require('fs');
const path = require('path');

const { summarize, groupByModel } = require('../src/stats');
const webview = require('../src/webview');

const now = Date.now();
// BYOK / custom-endpoint flavoured sample: large contexts make TTFT dominate,
// which is exactly what the usage records of a custom endpoint look like.
const models = [
  { name: 'GPT-6.1 Sol \u00b7 gpt', byok: true, input: [3000, 220000], decode: [45, 80], out: [80, 700] },
  { name: 'DeepSeek V4.1 Flash (latest)', byok: true, input: [20000, 120000], decode: [60, 110], out: [120, 900] },
  { name: 'claude-sonnet-5.5 \u00b7 Kiro', byok: true, input: [40000, 90000], decode: [35, 55], out: [100, 600] },
  { name: 'Claude Sonnet 5.5', byok: false, input: [2000, 12000], decode: [50, 75], out: [150, 500] },
];

function between([lo, hi]) {
  return lo + Math.random() * (hi - lo);
}

const records = [];
for (let i = 0; i < 34; i += 1) {
  const m = models[i % models.length];
  const input = Math.round(between(m.input));
  const output = Math.round(between(m.out));
  // prefill speed ~6k tok/s: big contexts spend most of the wall clock before the first token
  const ttft = Math.round(Math.max(350, (input / between([5000, 8000])) * 1000));
  const decodeMs = (output / between(m.decode)) * 1000;
  const durMs = Math.round(ttft + decodeMs);
  records.push({
    id: `demo-${i}`,
    ts: now - (34 - i) * 47000,
    model: m.name,
    input,
    output,
    cached: Math.round(input * between([0, 0.6])),
    durMs,
    ttftMs: ttft,
    rate: output / (durMs / 1000),
    decodeRate: (output - 1) / ((durMs - ttft) / 1000),
    source: 'usage',
    byok: m.byok,
  });
}

const last = records[records.length - 1];
const payload = {
  window: 'today',
  hasData: true,
  agg: summarize(records),
  lastRate: last.rate,
  lastModel: last.model,
  lastOutput: last.output,
  models: groupByModel(records),
  series: records.slice(-80),
  requests: records.slice(-200).reverse(),
  totalCaptured: records.length,
  demo: true,
  setup: {
    loggingEnabled: false,
    loggingKnown: true,
    roots: [],
    logPathSetting: '',
    usageRoots: ['C:\\Users\\you\\.copilot\\session-state'],
    usageEnabled: true,
    counts: { total: records.length, usage: records.length, byok: records.filter((r) => r.byok).length },
  },
};

const nonce = 'previewnonce';
let html = webview.html(nonce, '');
const stub =
  'window.acquireVsCodeApi=function(){return{postMessage:function(){}}};' +
  'setTimeout(function(){window.postMessage({type:"data",payload:' +
  JSON.stringify(payload) +
  '},"*")},0);';
html = html.replace(`<script nonce="${nonce}">`, `<script nonce="${nonce}">${stub}</script><script nonce="${nonce}">`);

const outDir = path.join(__dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'preview.html');
fs.writeFileSync(out, html, 'utf8');
console.log(out);
