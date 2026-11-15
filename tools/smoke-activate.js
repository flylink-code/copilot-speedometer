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
    sessionScope: 'window',
  },
  'github.copilot.chat': { 'agentDebugLog.fileLogging.enabled': false },
};

let rejectSessionScopeWrite = false;

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
      if (rejectSessionScopeWrite && key === 'sessionScope') {
        throw new Error('Unable to write to User Settings because copilotSpeedometer.sessionScope is not a registered configuration.');
      }
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
    workspaceFile: undefined,
    onDidChangeConfiguration() {
      return new stub.Disposable();
    },
    onDidChangeWorkspaceFolders(fn) {
      captured.folderListeners = captured.folderListeners || [];
      captured.folderListeners.push(fn);
      return new stub.Disposable();
    },
  },
  window: {
    registerWebviewViewProvider(id, provider) {
      captured.viewProviders = captured.viewProviders || new Map();
      captured.viewProviders.set(id, provider);
      return new stub.Disposable();
    },
    onDidChangeWindowState(fn) {
      captured.windowStateListeners = captured.windowStateListeners || [];
      captured.windowStateListeners.push(fn);
      return new stub.Disposable();
    },
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

const memGlobal = new Map();
const memWorkspace = new Map();
const context = {
  subscriptions: [],
  globalState: {
    get: (k) => memGlobal.get(k),
    update: async (k, v) => { memGlobal.set(k, v); },
  },
  workspaceState: {
    get: (k) => memWorkspace.get(k),
    update: async (k, v) => { memWorkspace.set(k, v); },
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
  check('activate registers every command and the sidebar view provider', () => {
    for (const cmd of ['showDashboard', 'openTab', 'refresh', 'enableLogging', 'exportJson', 'clearHistory', 'seedDemo']) {
      if (!captured.handlers.has(`copilotSpeedometer.${cmd}`)) throw new Error(`missing ${cmd}`);
    }
    if (!captured.viewProviders || !captured.viewProviders.has('copilotSpeedometer.sidebarView')) {
      throw new Error('sidebarView provider not registered');
    }
  });

  check('sidebar view resolves as always-available sidebar layout and showDashboard focuses it', () => {
    const provider = captured.viewProviders.get('copilotSpeedometer.sidebarView');
    const fakeView = {
      visible: true,
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
      onDidDispose() {
        return new stub.Disposable();
      },
      onDidChangeVisibility() {
        return new stub.Disposable();
      },
    };
    provider.resolveWebviewView(fakeView);
    if (!fakeView.webview.html.includes('class="sidebar"')) throw new Error('sidebar class missing');
    if (!fakeView.webview.html.includes('id="open-tab"')) throw new Error('open-tab button missing');

    captured.handlers.get('copilotSpeedometer.showDashboard')();
    if (!captured.command || captured.command[0] !== 'copilotSpeedometer.sidebarView.focus') {
      throw new Error('showDashboard did not focus sidebarView');
    }
  });

  // Also test the optional editor tab pop-out.
  check('openTab opens an editor webview panel', () => {
    captured.handlers.get('copilotSpeedometer.openTab')();
    if (captured.webviewMessages.length < 2) throw new Error('editor panel message handler missing');
  });

  const send = (msg) => captured.webviewMessages.forEach((fn) => fn(msg));
  const lastOf = (type) => [...captured.posted].reverse().find((m) => m.type === type);

  check('"today" payload has the expected shape and uiState is restored', () => {
    send({ type: 'ready' });
    const uiMsg = lastOf('uiState');
    if (!uiMsg || uiMsg.payload.detailOpen !== false) throw new Error('uiState missing or detailOpen not false by default');
    const msg = lastOf('data');
    if (!msg || msg.type !== 'data') throw new Error('no data message');
    const p = msg.payload;
    if (typeof p.hasData !== 'boolean') throw new Error('hasData missing');
    if (!p.setup || !Array.isArray(p.setup.usageRoots)) throw new Error('setup.usageRoots missing');
    if (typeof p.totalCaptured !== 'number') throw new Error('totalCaptured missing');
    console.log(`       today: hasData=${p.hasData} captured=${p.totalCaptured} usageRoots=${p.setup.usageRoots.length}`);
  });

  check('"all" window triggers a deep backfill and keeps sane numbers', () => {
    send({ type: 'filter', window: 'all' });
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

  await checkAsync('sessions hub lists sessions, supports archive/unarchive, and persists uiState', async () => {
    send({ type: 'tab', view: 'sessions' });
    const msg = lastOf('sessions');
    if (!msg || !msg.payload || !Array.isArray(msg.payload.sessions)) throw new Error('sessions payload missing');
    if (!msg.payload.sessions.length) throw new Error('expected at least one local session');
    const first = msg.payload.sessions[0];
    send({ type: 'sessionDetail', id: first.id });
    const det = lastOf('sessionDetail');
    if (!det || !det.payload || !det.payload.session) throw new Error('sessionDetail missing');

    send({ type: 'archiveSession', id: first.id });
    await new Promise((r) => setTimeout(r, 30));
    const afterArch = lastOf('sessions').payload;
    if (!afterArch.sessions.find((s) => s.id === first.id && s.archived)) throw new Error('archive flag not set');
    send({ type: 'unarchiveSession', id: first.id });
    await new Promise((r) => setTimeout(r, 30));
    const afterUnarch = lastOf('sessions').payload;
    if (!afterUnarch.sessions.find((s) => s.id === first.id && !s.archived)) throw new Error('unarchive flag not cleared');

    send({ type: 'saveUiState', patch: { selectedSessionId: first.id, detailOpen: false, dashOpen: { chart: false } } });
    send({ type: 'ready' });
    const restored = lastOf('uiState').payload;
    if (restored.view !== 'sessions' || restored.selectedSessionId !== first.id || restored.dashOpen.chart !== false) {
      throw new Error('uiState did not persist across ready');
    }

    console.log(`       sessions: count=${msg.payload.sessions.length} topTurns=${det.payload.turns.length}`);
    send({ type: 'tab', view: 'dashboard' });
  });

  /*
   * The bug this suite exists to prevent: Copilot writes every window's
   * sessions into one shared folder, so without scoping a fresh window shows
   * whatever another window happened to run. Point the fake window at a real
   * project folder and the payload must shrink to that folder's sessions.
   */
  await checkAsync('scoping hides other windows\' sessions and can be turned off', async () => {
    const all = lastOf('data').payload;
    const allCount = all.totalCaptured;

    stub.workspace.workspaceFolders = [{ uri: { fsPath: 'E:\\workspace\\copilot-speedometer' } }];
    send({ type: 'refresh' });
    await new Promise((r) => setTimeout(r, 80));
    const mine = lastOf('data').payload;

    if (mine.scope.mode !== 'window') throw new Error(`scope mode is ${mine.scope.mode}`);
    if (mine.totalCaptured >= allCount) {
      throw new Error(`window scope captured ${mine.totalCaptured} of ${allCount} - nothing was filtered`);
    }
    if (mine.scope.otherSessions <= 0) throw new Error('otherSessions is not positive');
    const foreign = mine.requests.filter((r) => r.cwd && !/copilot-speedometer/i.test(r.cwd));
    if (foreign.length) throw new Error(`${foreign.length} requests from another workspace leaked in`);
    console.log(`       scoped: ${mine.totalCaptured} of ${allCount} records, ${mine.scope.otherSessions} hidden`);

    settings.copilotSpeedometer.sessionScope = 'all';
    send({ type: 'refresh' });
    await new Promise((r) => setTimeout(r, 80));
    const merged = lastOf('data').payload;
    if (merged.scope.mode !== 'all') throw new Error('sessionScope=all was not honoured');
    if (merged.totalCaptured !== allCount) {
      throw new Error(`all mode captured ${merged.totalCaptured}, expected ${allCount}`);
    }

    settings.copilotSpeedometer.sessionScope = 'window';
    stub.workspace.workspaceFolders = undefined;
    send({ type: 'refresh' });
    await new Promise((r) => setTimeout(r, 80));
    const unscoped = lastOf('data').payload;
    if (unscoped.totalCaptured !== allCount) throw new Error('no folder open should keep every record');
  });

  await checkAsync('opening a folder rescopes without waiting for a new record', async () => {
    // The window had no folder, so everything was counted. Opening one must
    // rebuild the payload immediately; otherwise the stale merged number stays
    // on screen until Copilot happens to answer again.
    const before = lastOf('data').payload;
    if (before.scope.roots.length !== 0) throw new Error('test starts with no folder open');

    stub.workspace.workspaceFolders = [{ uri: { fsPath: 'E:\\workspace\\copilot-speedometer' } }];
    for (const fn of captured.folderListeners || []) fn();
    const after = lastOf('data').payload;

    if (after === before) throw new Error('nothing was pushed');
    if (after.scope.roots.length !== 1) throw new Error('the new folder was not picked up');
    if (after.totalCaptured >= before.totalCaptured) {
      throw new Error(`still counting ${after.totalCaptured} of ${before.totalCaptured} records`);
    }
    console.log(`       refoldered: ${after.totalCaptured} of ${before.totalCaptured} records`);
    stub.workspace.workspaceFolders = undefined;

    // Clicking the panel's scope strip must repaint without an extra refresh.
    settings.copilotSpeedometer.sessionScope = 'window';
    stub.workspace.workspaceFolders = [{ uri: { fsPath: 'E:\\workspace\\copilot-speedometer' } }];
    send({ type: 'setScope', value: 'all' });
    await new Promise((r) => setTimeout(r, 80));
    const swapped = lastOf('data').payload;
    if (swapped.scope.mode !== 'all') throw new Error('scope strip did not repaint');
    if (swapped.totalCaptured !== before.totalCaptured) {
      throw new Error(`all mode shows ${swapped.totalCaptured}, expected ${before.totalCaptured}`);
    }

    // Even if VS Code rejects writing the new setting (e.g. only Extension Host
    // restarted without reloading the manifest), the runtime override must still
    // switch the dashboard and settings state cleanly.
    send({ type: 'setScope', value: 'window' });
    await new Promise((r) => setTimeout(r, 40));
    rejectSessionScopeWrite = true;
    send({ type: 'setScope', value: 'all' });
    await new Promise((r) => setTimeout(r, 80));
    const fallback = lastOf('data').payload;
    if (fallback.scope.mode !== 'all') throw new Error('setScope fallback failed when update threw');
    if (fallback.totalCaptured !== before.totalCaptured) {
      throw new Error(`fallback all mode shows ${fallback.totalCaptured}, expected ${before.totalCaptured}`);
    }
    const fallbackSettings = lastOf('settings').payload.fields.find((f) => f.key === 'sessionScope');
    if (!fallbackSettings || fallbackSettings.value !== 'all') {
      throw new Error('settings field did not reflect runtime scope override');
    }
    rejectSessionScopeWrite = false;
    send({ type: 'setScope', value: 'window' });
    await new Promise((r) => setTimeout(r, 40));
    settings.copilotSpeedometer.sessionScope = 'window';
    stub.workspace.workspaceFolders = undefined;
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
