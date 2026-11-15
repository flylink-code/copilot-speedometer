'use strict';

/**
 * Renders the webview to standalone HTML files with synthetic data, so the UI
 * can be previewed in a browser (and screenshotted) without VS Code. Both
 * languages are emitted because the panel copy comes from the same dictionary
 * the extension host uses.
 *
 *   node tools/preview.js
 *     -> docs/preview.html, docs/preview-settings.html          (English)
 *     -> docs/preview-zh.html, docs/preview-settings-zh.html    (Chinese)
 *     -> docs/preview-sidebar*.html                            (side bar view, ~320 px wide)
 */

const fs = require('fs');
const path = require('path');

const { summarize, groupByModel } = require('../src/stats');
const { estimateCost } = require('../src/pricing');
const settings = require('../src/settings');
const webview = require('../src/webview');
const i18n = require('../src/i18n');

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
  const cached = Math.round(input * between([0, 0.6]));
  const est = estimateCost({ rawModel: m.name, model: m.name, input, cached, output });
  records.push({
    id: `demo-${i}`,
    ts: now - (34 - i) * 47000,
    model: m.name,
    input,
    output,
    cached,
    costUsd: est ? est.costUsd : null,
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
  scope: {
    mode: 'window',
    roots: ['E:\\workspace\\your-project'],
    workspaceFile: '',
    otherSessions: 412,
  },
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

const config = fakeConfig({ pollIntervalMs: 3000, statusBarFormat: 'rate-model' });
const sources = {
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
};

const scopeInfo = { mode: 'window', roots: ['E:\\workspace\\your-project'], workspaceFile: '', otherSessions: 412 };

const sampleSessions = [
  {
    id: 'agent:dc9e5efd-demo',
    rawId: 'dc9e5efd-demo',
    source: 'agent',
    title: 'Per-window tok/s scoping & cost estimation',
    cwd: 'E:\\workspace\\copilot-speedometer',
    workspacePath: '',
    project: 'flylink-code/copilot-speedometer',
    repository: 'flylink-code/copilot-speedometer',
    branch: 'main',
    active: true,
    inWindow: true,
    models: ['Claude Sonnet 5.5', 'DeepSeek V4.1 Flash'],
    userTurns: 4,
    assistantTurns: 4,
    reqCount: 18,
    input: 420000,
    output: 12400,
    cached: 120000,
    cacheWrite: 0,
    reasoning: 2100,
    durMs: 280000,
    rate: 44.3,
    costUsd: 0.96,
    createdAt: now - 3600000,
    updatedAt: now - 120000,
    searchText: 'per-window tok/s scoping cost estimation copilot-speedometer main',
  },
  {
    id: 'agent:ccd1112d-demo',
    rawId: 'ccd1112d-demo',
    source: 'agent',
    title: 'Hardware telemetry framing and UI refresh rate optimization',
    cwd: 'E:\\workspace\\ems_device',
    workspacePath: '',
    project: 'flylink-code/ems_device',
    repository: 'flylink-code/ems_device',
    branch: 'main',
    active: true,
    inWindow: false,
    models: ['Gemini 4 Hydrogen'],
    userTurns: 6,
    assistantTurns: 6,
    reqCount: 47,
    input: 1850000,
    output: 51200,
    cached: 0,
    cacheWrite: 0,
    reasoning: 14000,
    durMs: 920000,
    rate: 55.6,
    costUsd: 3.16,
    createdAt: now - 7200000,
    updatedAt: now - 600000,
    searchText: 'hardware telemetry framing ems_device gemini-4-hydrogen',
  },
  {
    id: 'vscode:9bba4c01-demo',
    rawId: '9bba4c01-demo',
    source: 'vscode',
    title: 'Quick check on webpack bundle size',
    cwd: 'E:\\workspace\\AI-Switcher',
    workspacePath: '',
    project: 'AI-Switcher',
    repository: '',
    branch: '',
    active: false,
    inWindow: false,
    models: ['gpt-4o'],
    userTurns: 2,
    assistantTurns: 2,
    reqCount: 2,
    input: 18000,
    output: 920,
    cached: 0,
    cacheWrite: 0,
    reasoning: 0,
    durMs: 14000,
    rate: 65.7,
    costUsd: 0.054,
    createdAt: now - 86400000,
    updatedAt: now - 86300000,
    searchText: 'webpack bundle size ai-switcher gpt-4o',
  },
  {
    id: 'agent:arch0001-demo',
    rawId: 'arch0001-demo',
    source: 'agent',
    title: 'Archived baseline benchmark',
    cwd: 'E:\\workspace\\copilot-speedometer',
    workspacePath: '',
    project: 'flylink-code/copilot-speedometer',
    repository: 'flylink-code/copilot-speedometer',
    branch: 'main',
    active: false,
    archived: true,
    inWindow: true,
    models: ['gpt-5.1-codex'],
    userTurns: 2,
    assistantTurns: 2,
    reqCount: 4,
    input: 32000,
    output: 1200,
    cached: 0,
    cacheWrite: 0,
    reasoning: 0,
    durMs: 25000,
    rate: 48.0,
    costUsd: 0.08,
    createdAt: now - 172800000,
    updatedAt: now - 172000000,
    searchText: 'archived baseline benchmark copilot-speedometer',
  },
];

const sessionsPayload = {
  sessions: sampleSessions,
  projects: ['AI-Switcher', 'flylink-code/copilot-speedometer', 'flylink-code/ems_device'],
  archivedCount: 1,
  hasWindowRoots: true,
};

const sessionDetailPayload = {
  session: sampleSessions[0],
  turns: [
    { role: 'user', ts: now - 3500000, text: 'Why does a new VS Code window show another window\'s tok/s?' },
    { role: 'tools', ts: now - 3495000, model: 'Claude Sonnet 5.5', tools: [{ name: 'view', count: 3 }, { name: 'powershell', count: 2 }] },
    {
      role: 'assistant',
      ts: now - 3480000,
      model: 'Claude Sonnet 5.5',
      text: 'All windows share ~/.copilot/session-state/<id>/events.jsonl without a window ID. Filtering by workspace.yaml cwd isolates each window.',
      usage: { model: 'Claude Sonnet 5.5', input: 84000, output: 1420, cached: 12000, durMs: 21000, rate: 67.6, costUsd: 0.16 },
    },
  ],
  truncated: false,
  totalTurns: 3,
  shutdown: { codeChanges: { filesModifiedCount: 4, linesAdded: 142, linesRemoved: 19 } },
};

const nonce = 'previewnonce';

function render(target, initialView, locale, isSidebar) {
  const translator = i18n.create(locale);
  const settingsPayload = Object.assign(settings.describe(config, translator.t), { sources, scope: scopeInfo });
  const base = webview.html(nonce, '', { locale: translator.locale, dict: translator.dict }, !!isSidebar);

  const stub =
    'window.acquireVsCodeApi=function(){return{postMessage:function(){}}};' +
    'setTimeout(function(){' +
    'window.postMessage({type:"data",payload:' + JSON.stringify(payload) + '},"*");' +
    'window.postMessage({type:"settings",payload:' + JSON.stringify(settingsPayload) + '},"*");' +
    'window.postMessage({type:"sessions",payload:' + JSON.stringify(sessionsPayload) + '},"*");' +
    'window.postMessage({type:"sessionDetail",payload:' + JSON.stringify(sessionDetailPayload) + '},"*");' +
    'window.postMessage({type:"uiState",payload:{view:' + JSON.stringify(initialView) + ',detailOpen:' + JSON.stringify(initialView === 'sessions' && !isSidebar) + '}},"*");' +
    '},0);';
  const html = base.replace(`<script nonce="${nonce}">`, `<script nonce="${nonce}">${stub}</script><script nonce="${nonce}">`);
  fs.writeFileSync(target, html, 'utf8');
  console.log(target);
}

const outDir = path.join(__dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });

render(path.join(outDir, 'preview.html'), 'dashboard', 'en');
render(path.join(outDir, 'preview-sessions.html'), 'sessions', 'en');
render(path.join(outDir, 'preview-settings.html'), 'settings', 'en');
render(path.join(outDir, 'preview-zh.html'), 'dashboard', 'zh');
render(path.join(outDir, 'preview-sessions-zh.html'), 'sessions', 'zh');
render(path.join(outDir, 'preview-settings-zh.html'), 'settings', 'zh');
render(path.join(outDir, 'preview-sidebar.html'), 'dashboard', 'en', true);
render(path.join(outDir, 'preview-sidebar-sessions.html'), 'sessions', 'en', true);
render(path.join(outDir, 'preview-sidebar-zh.html'), 'dashboard', 'zh', true);
render(path.join(outDir, 'preview-sidebar-sessions-zh.html'), 'sessions', 'zh', true);
render(path.join(outDir, 'preview-sidebar-settings-zh.html'), 'settings', 'zh', true);
