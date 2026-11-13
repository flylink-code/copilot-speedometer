'use strict';

/**
 * Loads the real extension inside a stubbed `vscode` API and exercises the
 * activation path, the polling tick and the dashboard payload. This catches
 * the class of bug the unit tests cannot: a typo in a `vscode.*` call, a
 * missing helper, or a panel payload that throws.
 *
 *   node tools/smoke-activate.js
 */

const Module = require('module');
const path = require('path');

const captured = { handlers: new Map(), webviewMessages: [], posted: [], info: [] };

class MarkdownString {
  constructor() {
    this.value = '';
  }
  appendMarkdown(s) {
    this.value += s;
    return this;
  }
}

const settings = {
  copilotSpeedometer: {
    enabled: true,
    statusBar: true,
    logPath: '',
    pollIntervalMs: 2000,
    historySize: 3000,
    backfillDays: 2,
    includeLegacyWorkspaceLogs: true,
    usageEvents: true,
    usageEventsRoot: '',
    statusBarFormat: 'rate',
  },
  'github.copilot.chat': { 'agentDebugLog.fileLogging.enabled': false },
};

function getConfiguration(ns) {
  return {
    get(key, dflt) {
      const bucket = settings[ns] || {};
      return key in bucket ? bucket[key] : dflt;
    },
    inspect(key) {
      const bucket = settings[ns] || {};
      if (!(key in bucket)) return undefined;
      return { defaultValue: undefined, globalValue: bucket[key], workspaceValue: undefined };
    },
    async update(key, value) {
      settings[ns] = Object.assign({}, settings[ns], { [key]: value });
    },
  };
}

const stub = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { Active: -1, One: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  MarkdownString,
  Uri: {
    file: (p) => ({ fsPath: p, path: p }),
    joinPath: (base, ...parts) => ({ fsPath: path.join(base.fsPath, ...parts) }),
  },
  Disposable: class {
    constructor(fn) {
      this.fn = fn;
    }
    dispose() {
      if (this.fn) this.fn();
    }
  },
  commands: {
    registerCommand(id, fn) {
      captured.handlers.set(id, fn);
      return new stub.Disposable();
    },
    executeCommand(id, arg) {
      captured.command = [id, arg];
      return Promise.resolve();
    },
  },
  workspace: {
    getConfiguration,
    workspaceFolders: undefined,
    onDidChangeConfiguration() {
      return new stub.Disposable();
    },
  },
  window: {
    createStatusBarItem() {
      return {
        text: '',
        tooltip: '',
        color: undefined,
        command: '',
        name: '',
        show() {},
        hide() {},
        dispose() {},
      };
    },
    createWebviewPanel() {
      const panel = {
        webview: {
          html: '',
          cspSource: 'vscode-resource:',
          onDidReceiveMessage(fn) {
            captured.webviewMessages.push(fn);
            return new stub.Disposable();
          },
          postMessage(msg) {
            captured.posted.push(msg);
            return Promise.resolve(true);
          },
        },
        reveal() {},
        dispose() {},
        onDidDispose() {
          return new stub.Disposable();
        },
      };
      return panel;
    },
    async showInformationMessage(msg) {
      captured.info.push(msg);
      return undefined;
    },
    createOutputChannel(name) {
      captured.channel = { name, text: '' };
      return {
        appendLine(s) {
          captured.channel.text += s + '\n';
        },
        clear() {
          captured.channel.text = '';
        },
        show() {},
        dispose() {},
      };
    },
    async showErrorMessage(msg) {
      captured.info.push(`ERROR ${msg}`);
    },
    async showWarningMessage(msg) {
      captured.info.push(`WARN ${msg}`);
      return undefined;
    },
    async showOpenDialog() {
      return undefined;
    },
    async showSaveDialog() {
      return undefined;
    },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return stub;
  return originalLoad.apply(this, arguments);
};

const ext = require('../src/extension.js');

const context = {
  subscriptions: [],
  globalState: {
    get: () => undefined,
    update: async () => undefined,
  },
};

(async () => {
  const failures = [];
  const check = (name, fn) => {
    try {
      fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
      console.error(`  FAIL ${name}\n${err.stack}`);
    }
  };

  const checkAsync = async (name, fn) => {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
      console.error(`  FAIL ${name}\n${err.stack}`);
    }
  };

  console.log('smoke');

  ext.activate(context);
  check('activate registers every command', () => {
    for (const cmd of ['showDashboard', 'refresh', 'enableLogging', 'exportJson', 'clearHistory', 'seedDemo']) {
      if (!captured.handlers.has(`copilotSpeedometer.${cmd}`)) throw new Error(`missing ${cmd}`);
    }
  });

  // Let the first tick (synchronous) run, then open the dashboard.
  check('opening the dashboard creates a webview', () => {
    captured.handlers.get('copilotSpeedometer.showDashboard')();
    if (!captured.webviewMessages.length) throw new Error('no message handler registered');
  });

  const send = (msg) => captured.webviewMessages.forEach((fn) => fn(msg));
  const lastOf = (type) => [...captured.posted].reverse().find((m) => m.type === type);

  check('"today" payload has the expected shape', () => {
    send({ type: 'ready', window: 'today' });
    const msg = lastOf('data');
    if (!msg || msg.type !== 'data') throw new Error('no data message');
    const p = msg.payload;
    if (typeof p.hasData !== 'boolean') throw new Error('hasData missing');
    if (!p.setup || !Array.isArray(p.setup.usageRoots)) throw new Error('setup.usageRoots missing');
    if (typeof p.totalCaptured !== 'number') throw new Error('totalCaptured missing');
    console.log(`       today: hasData=${p.hasData} captured=${p.totalCaptured} usageRoots=${p.setup.usageRoots.length}`);
  });

  check('"all" window triggers a deep backfill and keeps sane numbers', () => {
    send({ type: 'ready', window: 'all' });
    const p = lastOf('data').payload;
    if (p.totalCaptured <= 0) throw new Error('deep backfill produced no records');
    if (!(p.agg.rate > 0)) throw new Error('aggregate rate is not positive');
    console.log(`       all: captured=${p.totalCaptured} weighted=${p.agg.rate.toFixed(2)} tok/s models=${p.models.length}`);
    const bad = p.requests.filter((r) => !(r.rate > 0) || !r.model);
    if (bad.length) throw new Error(`${bad.length} malformed request rows`);
  });

  check('refresh does not throw', () => {
    send({ type: 'refresh' });
  });

  check('settings payload describes sources and every field', () => {
    send({ type: 'tab', view: 'settings' });
    const msg = lastOf('settings');
    if (!msg) throw new Error('no settings message');
    const p = msg.payload;
    if (!Array.isArray(p.fields) || p.fields.length < 8) throw new Error('fields missing');
    if (!p.sources || !p.sources.usage || !p.sources.logs) throw new Error('sources missing');
    if (typeof p.sources.usage.exists !== 'boolean') throw new Error('usage.exists missing');
    const fmt = p.fields.find((f) => f.key === 'statusBarFormat');
    if (!fmt || !fmt.options.includes('rate-model')) throw new Error('statusBarFormat missing');
    console.log(`       settings: fields=${p.fields.length} usageFiles=${p.sources.usage.files} captured=${p.sources.captured.total}`);
  });

  await checkAsync('setConfig writes the setting and acknowledges', async () => {
    send({ type: 'setConfig', key: 'pollIntervalMs', value: 4000 });
    await new Promise((r) => setTimeout(r, 60));
    if (settings.copilotSpeedometer.pollIntervalMs !== 4000) throw new Error('setting not written');
    const res = lastOf('configResult');
    if (!res || !res.ok || res.key !== 'pollIntervalMs') throw new Error('no ok configResult');
  });

  await checkAsync('an out-of-range value is rejected with a message', async () => {
    send({ type: 'setConfig', key: 'historySize', value: 1 });
    await new Promise((r) => setTimeout(r, 60));
    const res = lastOf('configResult');
    if (!res || res.ok) throw new Error('invalid value accepted');
    if (!/Minimum/.test(res.message || '')) throw new Error(`no message: ${res.message}`);
  });

  await checkAsync('resetConfig removes the override', async () => {
    send({ type: 'resetConfig', key: 'pollIntervalMs' });
    await new Promise((r) => setTimeout(r, 60));
    const res = lastOf('configResult');
    if (!res || !res.ok || !res.reset) throw new Error('reset not acknowledged');
  });

  check('diagnostics reports roots and record counts', () => {
    captured.handlers.get('copilotSpeedometer.diagnostics')();
    const text = (captured.channel && captured.channel.text) || '';
    if (!/usage records/.test(text)) throw new Error('no usage section');
    if (!/total records:\s*\d+/.test(text)) throw new Error('no record count');
    console.log('       diagnostics lines: ' + text.trim().split('\n').length);
    if (process.env.SMOKE_DUMP) console.log('\n=== diagnostics ===\n' + text + '=== end ===\n');
  });

  check('enableLogging writes the Copilot setting', () => {
    const before = settings['github.copilot.chat']['agentDebugLog.fileLogging.enabled'];
    captured.handlers.get('copilotSpeedometer.enableLogging')();
    const after = settings['github.copilot.chat']['agentDebugLog.fileLogging.enabled'];
    if (before === after) throw new Error('setting unchanged');
  });

  await new Promise((r) => setTimeout(r, 2000));
  check('timer tick runs without throwing', () => {
    const last = captured.posted[captured.posted.length - 1];
    if (!last) throw new Error('nothing posted');
  });

  if (failures.length) {
    console.error(`\n${failures.length} smoke check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('\nactivate smoke passed');
  }
  process.exit(process.exitCode || 0);
})();
