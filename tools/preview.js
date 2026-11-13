'use strict';

/**
 * Renders the webview to standalone HTML files with synthetic data, so the UI
 * can be previewed in a browser (and screenshotted) without VS Code.
 *
 *   node tools/preview.js  ->  docs/preview.html, docs/preview-settings.html
 */

const fs = require('fs');
const path = require('path');

const { summarize, groupByModel } = require('../src/stats');
const settings = require('../src/settings');
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

/** Stand-in for WorkspaceConfiguration; one value differs so the reset affordance shows. */
function fakeConfig(values) {
  return {
    own: {
      get(key, dflt) {
        return key in values ? values[key] : dflt;
      },
      update() {},
    },
    copilot: {
      inspect() {
        return { defaultValue: false, globalValue: false, workspaceValue: undefined };
      },
      update() {},
    },
  };
}

const settingsPayload = Object.assign(
  settings.describe(fakeConfig({ pollIntervalMs: 3000, statusBarFormat: 'rate-model' })),
  {
    sources: {
      usage: {
        root: 'C:\\Users\\you\\.copilot\\session-state',
        exists: true,
        files: 96,
      },
      logs: {
        roots: ['C:\\Users\\you\\AppData\\Roaming\\Code\\User\\globalStorage\\github.copilot-chat\\debug-logs'],
        files: 1,
        enabled: false,
      },
      captured: { total: records.length, usage: records.length, byok: records.filter((r) => r.byok).length },
    },
  }
);

const nonce = 'previewnonce';
const base = webview.html(nonce, '');

function render(target, initialView) {
  const stub =
    'window.acquireVsCodeApi=function(){return{postMessage:function(){}}};' +
    'setTimeout(function(){' +
    'window.postMessage({type:"data",payload:' + JSON.stringify(payload) + '},"*");' +
    'window.postMessage({type:"settings",payload:' + JSON.stringify(settingsPayload) + '},"*");' +
    (initialView === 'settings'
      ? 'document.querySelector(".tab[data-view=settings]").click();'
      : '') +
    '},0);';
  const html = base.replace(`<script nonce="${nonce}">`, `<script nonce="${nonce}">${stub}</script><script nonce="${nonce}">`);
  fs.writeFileSync(target, html, 'utf8');
  console.log(target);
}

const outDir = path.join(__dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
render(path.join(outDir, 'preview.html'), 'dashboard');
render(path.join(outDir, 'preview-settings.html'), 'settings');
