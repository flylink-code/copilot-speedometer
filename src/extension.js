'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { LogScanner, parseEventLine } = require('./parser');
const { UsageScanner, parseUsageLine } = require('./usage-events');
const { summarize, groupByModel, fmtRate, fmtTokens, fmtDur, fmtCost } = require('./stats');
const { statusBarWanted: statsStatusBarWanted } = require('./stats');
const { estimateCost } = require('./pricing');
const {
  SessionHubScanner,
  sessionMatchesScope,
  forkAgentSession,
  moveAgentSession,
  deleteAgentSession,
} = require('./sessions');
const scope = require('./scope');
const webview = require('./webview');
const settings = require('./settings');
const i18n = require('./i18n');

const P = 'copilotSpeedometer';
const COPILOT_CONFIG = 'github.copilot.chat';
const FILE_LOGGING_KEY = 'agentDebugLog.fileLogging.enabled';
const WARNED_KEY = 'copilotSpeedometer.setupNotificationShown';
const ARCHIVED_KEY = 'copilotSpeedometer.archivedSessions';
const UI_STATE_KEY = 'copilotSpeedometer.uiState';

let extensionContext = null;

let records = [];
let seen = new Set();
let deepLoaded = false;
let windowBackfillDone = false;
let windowActivityTs = 0;
let scanner = null;
let usageScanner = null;
let hubScanner = null;
let cachedSessions = [];
let timer = null;
let statusBar = null;
let panel = null;
let sidebarView = null;
let demoMode = false;
let output = null;
let translator = null;
let sessionScopeOverride = null;

/** The panel and the notifications follow the VS Code display language. */
function tr() {
  if (!translator) {
    const language = vscode.env && vscode.env.language ? vscode.env.language : i18n.DEFAULT;
    translator = i18n.create(language);
  }
  return translator.t;
}

/** The flat dictionary the webview renders its own copy from. */
function panelLocale() {
  if (!translator) tr();
  return { locale: translator.locale, dict: translator.dict };
}

function config() {
  return vscode.workspace.getConfiguration(P);
}

/**
 * Which requests belong to *this* window.
 *
 * Copilot keeps every window's sessions in one shared directory and a usage
 * record carries no window id, so the only honest signal is the session's
 * working directory (`workspace.yaml` next to its events). Comparing it with
 * this window's folders is the fix for "a new window shows another window's
 * tok/s". A window with no folder open cannot be scoped, and a record with an
 * unknown origin is kept rather than silently dropped.
 */
function windowScope() {
  const raw = sessionScopeOverride !== null ? sessionScopeOverride : config().get('sessionScope', 'window');
  const mode = raw === 'all' ? 'all' : 'window';
  const folders = vscode.workspace.workspaceFolders || [];
  const roots = folders.map((f) => (f && f.uri && f.uri.fsPath ? f.uri.fsPath : '')).filter(Boolean);
  const workspaceFile = vscode.workspace.workspaceFile ? vscode.workspace.workspaceFile.fsPath || '' : '';
  return { mode, roots, workspaceFile };
}

/**
 * The records the status bar, the tooltip and the panel are allowed to see.
 * Recomputed only when the history or the window's folders change, so the cost
 * stays flat while the history grows.
 */
let scopeCache = null;
let recordsRevision = 0;

function scopedRecords() {
  const scoping = windowScope();
  const key = `${recordsRevision}|${scoping.mode}|${scoping.roots.join('|')}|${scoping.workspaceFile}`;
  if (scopeCache && scopeCache.key === key) return scopeCache.list;
  const list = scope.filterToWindow(records, scoping);
  scopeCache = { key, list };
  return list;
}

function scopeCacheInvalidate() {
  scopeCache = null;
  recordsRevision += 1;
}

function activate(context) {
  extensionContext = context;
  const savedUi = getUiState();
  currentWindow = savedUi.filter;
  currentView = savedUi.view;

  context.subscriptions.push(
    vscode.commands.registerCommand(`${P}.showDashboard`, () => showSidebar(context)),
    vscode.commands.registerCommand(`${P}.openTab`, () => showDashboard(context)),
    vscode.commands.registerCommand(`${P}.refresh`, () => {
      dirCacheInvalidate();
      tick(true);
    }),
    vscode.commands.registerCommand(`${P}.enableLogging`, () => enableLogging(context)),
    vscode.commands.registerCommand(`${P}.exportJson`, () => exportJson()),
    vscode.commands.registerCommand(`${P}.clearHistory`, () => clearHistory()),
    vscode.commands.registerCommand(`${P}.seedDemo`, () => seedDemo()),
    vscode.commands.registerCommand(`${P}.diagnostics`, () => showDiagnostics())
  );

  if (typeof vscode.window.registerWebviewViewProvider === 'function') {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        `${P}.sidebarView`,
        {
          resolveWebviewView(view) {
            sidebarView = view;
            view.webview.options = { enableScripts: true, localResourceRoots: [] };
            view.webview.html = webview.html(makeNonce(), view.webview.cspSource, panelLocale(), true);
            wireWebview(view.webview, context);
            view.onDidDispose(() => {
              if (sidebarView === view) sidebarView = null;
            });
            view.onDidChangeVisibility(() => {
              if (view.visible) {
                tick(false);
                pushData();
                pushSettings();
                if (currentView === 'sessions') pushSessions();
              }
            });
            pushData();
            pushSettings();
          },
        },
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );
  }

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.command = `${P}.showDashboard`;
  statusBar.name = tr()('status.name');
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(P)) {
        if (e.affectsConfiguration(`${P}.sessionScope`)) {
          sessionScopeOverride = null;
        }
        dirCacheInvalidate();
        const rescan = ['enabled', 'usageEvents', 'usageEventsRoot', 'logPath', 'includeLegacyWorkspaceLogs', 'pollIntervalMs', 'historySize', 'backfillDays']
          .some((key) => e.affectsConfiguration(`${P}.${key}`));
        if (rescan) {
          restartLoop();
        } else {
          scopeCacheInvalidate();
          updateStatusBar();
          pushData();
        }
        pushSettings();
        if (currentView === 'sessions') pushSessions();
      }
      if (e.affectsConfiguration(`${COPILOT_CONFIG}.${FILE_LOGGING_KEY}`)) {
        pushData();
        pushSettings();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders
      ? vscode.workspace.onDidChangeWorkspaceFolders(() => {
        // Adding or removing a folder changes which sessions are "this window",
        // so the numbers have to be rebuilt even if no new record arrived.
        windowBackfillDone = false;
        scopeCacheInvalidate();
        tick(true);
        pushSettings();
      })
      : { dispose: () => {} },
    vscode.window.onDidChangeWindowState
      ? vscode.window.onDidChangeWindowState((state) => {
        if (state && state.focused) tick(false);
      })
      : { dispose: () => {} },
    { dispose: () => { if (timer) clearInterval(timer); } }
  );

  restartLoop();
  maybeWarnSetup(context);
}

function deactivate() {
  if (timer) clearInterval(timer);
  timer = null;
  extensionContext = null;
}

/**
 * "Why is it empty?" answered in one place: every root that was looked at,
 * every file that was found, and how many records came out of each source.
 */
function showDiagnostics() {
  if (!output) output = vscode.window.createOutputChannel('Copilot Speedometer');
  const uopts = usageOptions();
  const lopts = scannerOptions();
  const logState = loggingState();
  const t = tr();
  const lines = [];

  lines.push(`Copilot Speedometer ${require('../package.json').version}`);
  lines.push(`extension host: ${process.platform} / node ${process.versions.node}`);
  lines.push('');
  lines.push(t('diag.settings'));
  lines.push(`  ${t('diag.useUsage')}: ${usageEnabled()}`);
  lines.push(`  ${t('diag.usageRoot')}: ${uopts.root || t('diag.default')}`);
  lines.push(`  ${t('diag.logPath')}: ${lopts.logPath || t('diag.autoDiscover')}`);
  lines.push(`  ${t('diag.backfill')}: ${uopts.backfillDays}`);
  lines.push(`  ${t('diag.logging')}: ${logState.known ? (logState.enabled ? t('diag.on') : t('diag.off')) : t('diag.unknown')}`);
  const scoping = windowScope();
  lines.push(`  ${t('diag.scope')}: ${scoping.mode === 'window' ? t('diag.scopeWindow') : t('diag.scopeAll')}`);
  lines.push(`  ${t('diag.scopeRoots')}: ${scoping.roots.length ? scoping.roots.join(', ') : t('diag.scopeNoRoots')}`);
  if (scoping.workspaceFile) lines.push(`  ${t('diag.scopeWorkspaceFile')}: ${scoping.workspaceFile}`);
  lines.push('');

  lines.push(t('diag.usageTitle'));
  if (!usageEnabled()) {
    lines.push(`  ${t('diag.usageDisabled')}`);
  } else if (usageScanner) {
    const roots = usageScanner.existingRoots(uopts);
    lines.push(`  ${t('diag.root')}: ${usageScanner.root(uopts)}`);
    lines.push(`  ${t('diag.exists')}: ${roots.length > 0}`);
    if (roots.length) {
      let files = [];
      try {
        files = usageScanner.scan(Object.assign({}, uopts, { backfillDays: 7 }));
      } catch (err) {
        lines.push(`  ${t('diag.scanError')}: ${err.message}`);
      }
      lines.push(`  ${t('diag.files7d')}: ${files.length}`);
      for (const f of files.slice(0, 10)) {
        lines.push(`    ${f.file}  ${(f.size / 1048576).toFixed(1)} MB`);
      }
    }
  }
  lines.push('');

  lines.push(t('diag.logsTitle'));
  if (scanner) {
    let roots = [];
    try {
      roots = scanner.existingRoots(lopts);
    } catch (err) {
      lines.push(`  ${t('diag.discoveryError')}: ${err.message}`);
    }
    lines.push(`  ${t('diag.rootsFound')}: ${roots.length}`);
    for (const r of roots.slice(0, 10)) lines.push(`    ${r.root || r}`);
    if (!roots.length) {
      lines.push(`    ${t('diag.noRoots')}`);
    }
  }
  lines.push('');

  const visible = scopedRecords();
  const bySource = visible.reduce((acc, r) => {
    acc[r.source || 'log'] = (acc[r.source || 'log'] || 0) + 1;
    return acc;
  }, {});
  lines.push(t('diag.capturedTitle'));
  lines.push(`  ${t('diag.totalRecords')}: ${visible.length}`);
  for (const [k, v] of Object.entries(bySource)) lines.push(`    ${k}: ${v}`);
  if (records.length !== visible.length) {
    lines.push(`  ${t('diag.otherWindows')}: ${records.length - visible.length}`);
  }
  const last = visible[visible.length - 1];
  if (last) {
    lines.push(`  ${t('diag.lastRequest')}: ${last.model} - ${fmtRate(last.rate)} tok/s, ${last.output} tokens, ${fmtDur(last.durMs)}` +
      (last.ttftMs ? `, TTFT ${fmtDur(last.ttftMs)}` : ''));
  } else {
    lines.push(`  ${t('diag.lastRequest')}: ${t('diag.noneYet')}`);
    lines.push('');
    lines.push(t('diag.hint'));
  }

  output.clear();
  output.appendLine(lines.join('\n'));
  output.show(true);
}

function dirCacheInvalidate() {
  if (scanner) {
    scanner.dirCache = null;
    if (scanner.dirs) scanner.dirs.clear();
  }
  if (usageScanner) {
    usageScanner.dirCache = null;
    usageScanner.dirCacheAt = 0;
    if (usageScanner.dirs) usageScanner.dirs.clear();
  }
  if (hubScanner) hubScanner.invalidate();
}

function pricingOptions() {
  const mult = Number(config().get('pricingMultiplier', 1));
  const custom = config().get('customPricing', {});
  return {
    multiplier: isFinite(mult) && mult >= 0 ? mult : 1,
    customPricing: custom && typeof custom === 'object' && !Array.isArray(custom) ? custom : {},
  };
}

function scannerOptions() {
  return {
    logPath: config().get('logPath', '') || '',
    legacy: config().get('includeLegacyWorkspaceLogs', true),
    backfillDays: Number(config().get('backfillDays', 2)) || 0,
  };
}

function usageOptions() {
  return {
    root: config().get('usageEventsRoot', '') || '',
    backfillDays: Number(config().get('backfillDays', 2)) || 0,
  };
}

function usageEnabled() {
  return config().get('usageEvents', true) !== false;
}

function configBundle() {
  return { own: config(), copilot: vscode.workspace.getConfiguration(COPILOT_CONFIG) };
}

/**
 * Everything the Settings tab renders: the field model (value, default,
 * modified flag) plus a live health snapshot of both data sources, so the
 * panel can say "96 session files" instead of asking the user to believe it.
 */
function buildSettingsPayload() {
  const desc = settings.describe(configBundle(), tr());
  const uopts = usageOptions();

  let files = [];
  let usageRoot = '';
  let usageExists = false;
  try {
    if (usageScanner) {
      usageRoot = usageScanner.root(uopts);
      usageExists = usageScanner.existingRoots(uopts).length > 0;
      files = usageScanner.scan(uopts);
    }
  } catch {
    files = [];
  }

  let logRoots = [];
  try {
    if (scanner) logRoots = scanner.existingRoots(scannerOptions()).map((r) => r.root);
  } catch {
    logRoots = [];
  }

  const logState = loggingState();
  let latest = 0;
  for (const f of files) {
    if (f.mtimeMs > latest) latest = f.mtimeMs;
  }

  const scoping = windowScope();
  const visible = scopedRecords();
  if (sessionScopeOverride !== null) {
    const scopeField = desc.fields.find((f) => f.key === 'sessionScope');
    if (scopeField) {
      scopeField.value = scoping.mode;
      scopeField.modified = scoping.mode !== scopeField.default;
    }
  }

  return Object.assign(desc, {
    sources: {
      usage: {
        root: usageRoot,
        exists: usageExists,
        files: files.length,
        latest: latest || null,
      },
      logs: { roots: logRoots, files: logRoots.length, enabled: !!logState.enabled },
      captured: {
        total: visible.length,
        usage: visible.filter((r) => r.source === 'usage').length,
        byok: visible.filter((r) => r.byok).length,
        all: records.length,
      },
    },
    scope: {
      mode: scoping.mode,
      roots: scoping.roots,
      workspaceFile: scoping.workspaceFile,
      otherSessions: records.length - visible.length,
    },
  });
}

function postToViews(msg) {
  if (sidebarView && sidebarView.webview) sidebarView.webview.postMessage(msg);
  if (panel && panel.webview) panel.webview.postMessage(msg);
}

function pushSettings() {
  if (!sidebarView && !panel) return;
  postToViews({ type: 'settings', payload: buildSettingsPayload() });
}

function postConfigResult(result) {
  if (!sidebarView && !panel) return;
  postToViews(Object.assign({ type: 'configResult' }, result));
}

async function applyScope(value, reset) {
  const next = reset ? 'window' : (value === 'all' ? 'all' : 'window');
  // Apply immediately in memory so the dashboard toggle still works even when
  // VS Code restarted only the Extension Host and has not registered the new
  // setting schema from package.json yet.
  sessionScopeOverride = reset ? null : next;
  scopeCacheInvalidate();
  pushSettings();
  updateStatusBar();
  pushData();

  try {
    const result = await settings.apply(configBundle(), 'sessionScope', next, !!reset);
    if (result.ok && config().get('sessionScope', 'window') === next) {
      sessionScopeOverride = null;
      pushSettings();
    }
    postConfigResult(result);
  } catch {
    postConfigResult({ ok: true, key: 'sessionScope', value: next });
  }
}

async function applySetting(key, value, reset) {
  if (key === 'sessionScope') return applyScope(value, reset);
  try {
    const result = await settings.apply(configBundle(), key, value, reset);
    postConfigResult(result);
    if (result.ok) {
      dirCacheInvalidate();
      scopeCacheInvalidate();
      pushSettings();
      updateStatusBar();
      pushData();
      if (currentView === 'sessions') pushSessions();
    }
  } catch (err) {
    postConfigResult({ ok: false, key, message: err.message });
  }
}

async function browseSetting(key) {
  const field = settings.fieldByKey(key);
  if (!field || field.type !== 'path') return;
  const current = config().get(key, '') || '';
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: tr()('msg.pickFolder'),
    defaultUri: current && fs.existsSync(current) ? vscode.Uri.file(current) : undefined,
  });
  if (!picked || !picked.length) return;
  await applySetting(key, picked[0].fsPath, false);
}

function revealFolder(target) {
  if (!target || !fs.existsSync(target)) {
    vscode.window.showInformationMessage(tr()('msg.folderMissing', target || tr()('diag.default')));
    return;
  }
  vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
}

function openSettingsJson() {
  vscode.commands.executeCommand('workbench.action.openSettings', 'copilotSpeedometer');
}

async function clearHistory() {
  const t = tr();
  if (!records.length) {
    vscode.window.showInformationMessage(t('msg.nothingToClear'));
    return;
  }
  const clearLabel = t('msg.clear');
  const pick = await vscode.window.showWarningMessage(
    t('msg.clearConfirm', records.length),
    { modal: true },
    clearLabel
  );
  if (pick !== clearLabel) return;
  records = [];
  seen.clear();
  deepLoaded = false;
  demoMode = false;
  scopeCacheInvalidate();
  updateStatusBar();
  pushData();
  pushSettings();
}

/** Short, status-bar-friendly model label: last path segment, trimmed. */
function shortModel(model) {
  const name = String(model || '').split('/').filter(Boolean).pop() || String(model || '');
  return name.length > 26 ? `${name.slice(0, 25)}…` : name;
}

function restartLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!config().get('enabled', true)) {
    if (statusBar) statusBar.hide();
    if (panel) panel.dispose();
    return;
  }
  scanner = new LogScanner();
  usageScanner = new UsageScanner();
  hubScanner = new SessionHubScanner();
  cachedSessions = [];
  records = [];
  seen.clear();
  deepLoaded = false;
  windowBackfillDone = false;
  windowActivityTs = 0;
  demoMode = false;
  scopeCacheInvalidate();
  tick(true);
  const interval = Math.max(500, Number(config().get('pollIntervalMs', 2000)) || 2000);
  timer = setInterval(() => tick(false), interval);
}

/**
 * Both sources describe the same model calls, so a call that shows up in the
 * usage records must not be counted twice when the debug log also has it.
 */
function callKey(rec) {
  return `${rec.rawModel || rec.model}|${rec.output}|${Math.round(rec.ts / 5000)}`;
}

function entryMatchesWindow(entry, scoping) {
  if (!scoping || scoping.mode !== 'window' || !scoping.roots.length) return true;
  if (!entry || !entry.cwd) return false;
  return scope.matchesRoots(entry.cwd, scoping.roots);
}

/**
 * When a project's latest Copilot session is older than `backfillDays`, the
 * startup scan leaves this window empty even though historical data exists on
 * disk. Pull the tail of this window's own session files right away so opening
 * a historical conversation shows its tok/s without waiting for a new message.
 */
function backfillCurrentWindow(cap, batch, usageKeys) {
  if (windowBackfillDone || deepLoaded) return;
  windowBackfillDone = true;
  if (!usageScanner || !usageEnabled()) return;
  const scoping = windowScope();
  if (!scoping.roots.length) return;

  let files = [];
  try {
    files = usageScanner.scan(Object.assign(usageOptions(), { backfillDays: 0 }));
  } catch {
    return;
  }
  const mine = files.filter((e) => entryMatchesWindow(e, scoping)).slice(0, 4);
  for (const entry of mine) {
    let lines = [];
    try {
      lines = usageScanner.readNew(entry.file);
    } catch {
      continue;
    }
    for (const line of lines) {
      const rec = parseUsageLine(line, entry.file, entry.cwd);
      if (!rec || seen.has(rec.id)) continue;
      seen.add(rec.id);
      batch.push(rec);
      usageKeys.add(callKey(rec));
    }
  }
}

function tick(force) {
  if (!config().get('enabled', true)) return;

  const cap = Math.max(100, Number(config().get('historySize', 3000)) || 3000);
  const batch = [];
  const usageKeys = new Set();
  const scoping = windowScope();
  let wokeUp = false;

  const add = (rec, isUsage) => {
    if (!rec || seen.has(rec.id)) return;
    seen.add(rec.id);
    batch.push(rec);
    if (isUsage) usageKeys.add(callKey(rec));
  };

  if (usageScanner && usageEnabled()) {
    let files = [];
    try {
      files = usageScanner.scan(usageOptions());
    } catch {
      files = [];
    }
    for (const entry of files) {
      let lines = [];
      try {
        lines = usageScanner.readNew(entry.file);
      } catch {
        continue;
      }
      const mine = entryMatchesWindow(entry, scoping);
      for (const line of lines) {
        if (
          mine &&
          !force &&
          (line.indexOf('"session.resume"') !== -1 ||
            line.indexOf('"session.start"') !== -1 ||
            line.indexOf('"user.message"') !== -1)
        ) {
          windowActivityTs = Date.now();
          wokeUp = true;
        }
        add(parseUsageLine(line, entry.file, entry.cwd), true);
      }
    }
  }

  let files = [];
  try {
    files = scanner.scan(scannerOptions());
  } catch {
    files = [];
  }
  for (const entry of files) {
    let lines = [];
    try {
      lines = scanner.readNew(entry.file);
    } catch {
      continue;
    }
    for (const line of lines) {
      const rec = parseEventLine(line, entry.file, entry.cwd, entry.workspacePath);
      if (!rec) continue;
      if (usageKeys.has(callKey(rec))) continue; // already known, with TTFT
      add(rec, false);
    }
  }

  if (batch.length) {
    records.push(...batch);
    if (usageKeys.size) {
      records = records.filter((r) => r.source === 'usage' || !usageKeys.has(callKey(r)));
    }
    records.sort((a, b) => a.ts - b.ts);
    if (records.length > cap) {
      records = records.slice(records.length - cap);
      seen = new Set(records.map((r) => r.id));
    }
    scopeCacheInvalidate();
  }

  if (!windowBackfillDone && scopedRecords().length === 0) {
    const extra = [];
    const extraKeys = new Set();
    backfillCurrentWindow(cap, extra, extraKeys);
    if (extra.length) {
      records.push(...extra);
      if (extraKeys.size) {
        records = records.filter((r) => r.source === 'usage' || !extraKeys.has(callKey(r)));
      }
      records.sort((a, b) => a.ts - b.ts);
      if (records.length > cap) {
        records = records.slice(records.length - cap);
        seen = new Set(records.map((r) => r.id));
      }
      scopeCacheInvalidate();
      wokeUp = true;
    }
  }

  if (batch.length || force || wokeUp) {
    updateStatusBar();
    pushData();
  } else {
    applyStatusBarVisibility();
  }
}

/**
 * The startup backfill is deliberately shallow (a couple of days, tail of each
 * file) so activation stays instant. Choosing the "all" window is an explicit
 * ask for history, so do one deeper pass then - still tail-bounded per file,
 * with an overall byte budget so a 40 MB session file cannot stall the UI.
 */
const DEEP_BUDGET_BYTES = 64 * 1024 * 1024;

function deepBackfill() {
  if (deepLoaded) return;
  deepLoaded = true;

  const cap = Math.max(100, Number(config().get('historySize', 3000)) || 3000);
  const batch = [];
  const usageKeys = new Set();

  if (usageScanner && usageEnabled()) {
    let files = [];
    try {
      files = usageScanner.scan(Object.assign(usageOptions(), { backfillDays: 0 }));
    } catch {
      files = [];
    }
    let budget = DEEP_BUDGET_BYTES;
    for (const entry of files) {
      if (budget <= 0) break;
      budget -= Math.min(entry.size, 8 * 1024 * 1024);
      let lines = [];
      try {
        lines = usageScanner.readNew(entry.file);
      } catch {
        continue;
      }
      for (const line of lines) {
        const rec = parseUsageLine(line, entry.file, entry.cwd);
        if (!rec || seen.has(rec.id)) continue;
        seen.add(rec.id);
        batch.push(rec);
        usageKeys.add(callKey(rec));
      }
    }
  }

  if (!batch.length) return;
  records.push(...batch);
  if (usageKeys.size) {
    records = records.filter((r) => r.source === 'usage' || !usageKeys.has(callKey(r)));
  }
  records.sort((a, b) => a.ts - b.ts);
  if (records.length > cap) {
    records = records.slice(records.length - cap);
    seen = new Set(records.map((r) => r.id));
  }
  scopeCacheInvalidate();
}

/**
 * Minutes of Copilot silence after which the status-bar item hides itself. A
 * window that is not chatting should not keep showing a number from yesterday;
 * the dashboard stays one command away either way.
 */
function autoHideMinutes() {
  const raw = Number(config().get('autoHideMinutes', 5));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function statusBarWanted() {
  const list = scopedRecords();
  const last = list[list.length - 1];
  const lastTs = Math.max(last ? last.ts : 0, windowActivityTs);
  return statsStatusBarWanted({
    enabled: config().get('enabled', true),
    statusBar: config().get('statusBar', true),
    autoHideMinutes: autoHideMinutes(),
    lastTs,
  });
}

/** Cheap enough to run on every poll: only show/hide, never rebuild text. */
function applyStatusBarVisibility() {
  if (!statusBar) return;
  if (statusBarWanted()) statusBar.show();
  else statusBar.hide();
}

function updateStatusBar() {
  if (!statusBar) return;
  if (!statusBarWanted()) {
    statusBar.hide();
    return;
  }
  statusBar.show();

  const t = tr();
  const mine = scopedRecords();
  const last = mine[mine.length - 1];
  if (!last) {
    statusBar.text = t('status.idle.text');
    statusBar.tooltip = t('status.idle.tooltip');
    statusBar.color = undefined;
    return;
  }

  const format = config().get('statusBarFormat', 'rate');
  let text = t('status.rate', fmtRate(last.rate));
  if (format === 'rate-model') text += ` · ${shortModel(last.model)}`;
  else if (format === 'rate-ttft' && last.ttftMs) text += ` · TTFT ${fmtDur(last.ttftMs)}`;
  statusBar.text = text;
  statusBar.color = undefined;

  const recent = mine.slice(-20);
  const pOpts = pricingOptions();
  const agg = summarize(recent, pOpts);
  const lastEst = estimateCost(last, pOpts);
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Copilot Speedometer**\n\n`);
  md.appendMarkdown(`${t('status.md.last')}: **${fmtRate(last.rate)} tok/s**\n\n`);
  md.appendMarkdown(`| | |\n|:--|--:|\n`);
  md.appendMarkdown(`| ${t('status.md.model')} | \`${last.model}\` |\n`);
  md.appendMarkdown(`| ${t('status.md.output')} | ${last.output} |\n`);
  md.appendMarkdown(`| ${t('status.md.duration')} | ${fmtDur(last.durMs)} |\n`);
  if (last.ttftMs) md.appendMarkdown(`| ${t('status.md.ttft')} | ${fmtDur(last.ttftMs)} |\n`);
  if (last.decodeRate) md.appendMarkdown(`| ${t('status.md.decode')} | ${fmtRate(last.decodeRate)} tok/s |\n`);
  if (lastEst) md.appendMarkdown(`| ${t('ui.th.cost')} | ${fmtCost(lastEst.costUsd)} |\n`);
  if (last.byok) md.appendMarkdown(`| ${t('status.md.provider')} | ${t('status.md.byok')} |\n`);
  md.appendMarkdown(`| ${t('status.md.io')} | ${fmtTokens(last.input)} / ${fmtTokens(last.cached)} |\n`);
  md.appendMarkdown('\n' + t('status.md.recent', agg.count, fmtRate(agg.rate), fmtRate(agg.medianRate), agg.output) + '\n\n');
  md.appendMarkdown(t('status.md.click'));
  statusBar.tooltip = md;
}

function loggingState() {
  const cfg = vscode.workspace.getConfiguration(COPILOT_CONFIG);
  const info = cfg.inspect(FILE_LOGGING_KEY);
  if (!info) return { known: false, enabled: false };
  const value =
    info.globalValue !== undefined
      ? info.globalValue
      : info.workspaceValue !== undefined
        ? info.workspaceValue
        : info.defaultValue;
  return { known: true, enabled: !!value };
}

function buildPayload(windowKey) {
  const now = Date.now();
  let from = 0;
  if (windowKey === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    from = d.getTime();
  } else if (windowKey === '7d') {
    from = now - 7 * 86400000;
  }

  const scoping = windowScope();
  const visible = scopedRecords();
  const inWindow = visible.filter((r) => r.ts >= from);
  const pOpts = pricingOptions();
  const agg = summarize(inWindow, pOpts);
  const last = inWindow.length ? inWindow[inWindow.length - 1] : null;
  const opts = scannerOptions();
  const roots = scanner ? scanner.existingRoots(opts).map((r) => r.root) : [];
  const usageRoots = usageScanner && usageEnabled() ? usageScanner.existingRoots(usageOptions()) : [];
  const logState = loggingState();
  const fromUsage = visible.filter((r) => r.source === 'usage').length;
  const byokCount = visible.filter((r) => r.byok).length;

  const pick = (r) => {
    const est = estimateCost(r, pOpts);
    return {
      id: r.id,
      ts: r.ts,
      model: r.model,
      input: r.input,
      output: r.output,
      cached: r.cached,
      cacheWrite: r.cacheWrite || 0,
      reasoning: r.reasoning || 0,
      costUsd: est ? est.costUsd : null,
      durMs: r.durMs,
      ttftMs: r.ttftMs,
      rate: r.rate,
      decodeRate: r.decodeRate,
      source: r.source || 'log',
      byok: !!r.byok,
      cwd: r.cwd || '',
      workspacePath: r.workspacePath || '',
    };
  };

  return {
    window: windowKey,
    hasData: inWindow.length > 0,
    agg,
    lastRate: last ? last.rate : null,
    lastModel: last ? last.model : null,
    lastOutput: last ? last.output : null,
    models: groupByModel(inWindow, pOpts),
    series: inWindow.slice(-80).map(pick),
    requests: inWindow.slice(-200).reverse().map(pick),
    totalCaptured: visible.length,
    demo: demoMode,
    scope: {
      mode: scoping.mode,
      roots: scoping.roots,
      workspaceFile: scoping.workspaceFile,
      otherSessions: records.length - visible.length,
    },
    setup: {
      loggingEnabled: logState.enabled,
      loggingKnown: logState.known,
      roots,
      logPathSetting: opts.logPath,
      usageRoots,
      usageEnabled: usageEnabled(),
      counts: { total: visible.length, usage: fromUsage, byok: byokCount, all: records.length },
    },
  };
}

let currentWindow = 'today';
let currentView = 'dashboard';

const DEFAULT_UI_STATE = {
  view: 'dashboard',
  filter: 'today',
  dashOpen: { chart: true, models: true, recent: true },
  recentLimit: null,
  hubFilter: { q: '', scope: 'all', source: 'all', project: '', showArchived: false },
  selectedSessionId: '',
  detailOpen: false,
  turnLimit: 15,
};

function getUiState() {
  const raw = extensionContext && extensionContext.workspaceState
    ? extensionContext.workspaceState.get(UI_STATE_KEY)
    : null;
  const s = raw && typeof raw === 'object' ? raw : {};
  const view = ['dashboard', 'sessions', 'settings'].includes(s.view) ? s.view : DEFAULT_UI_STATE.view;
  const filter = ['today', '7d', 'all'].includes(s.filter) ? s.filter : DEFAULT_UI_STATE.filter;
  const dashOpen = Object.assign(
    {},
    DEFAULT_UI_STATE.dashOpen,
    s.dashOpen && typeof s.dashOpen === 'object' ? s.dashOpen : {}
  );
  const hubFilter = Object.assign(
    {},
    DEFAULT_UI_STATE.hubFilter,
    s.hubFilter && typeof s.hubFilter === 'object' ? s.hubFilter : {}
  );
  return {
    view,
    filter,
    dashOpen: { chart: !!dashOpen.chart, models: !!dashOpen.models, recent: !!dashOpen.recent },
    recentLimit: typeof s.recentLimit === 'number' && s.recentLimit > 0 ? s.recentLimit : null,
    hubFilter: {
      q: typeof hubFilter.q === 'string' ? hubFilter.q : '',
      scope: hubFilter.scope === 'window' ? 'window' : 'all',
      source: ['all', 'agent', 'vscode'].includes(hubFilter.source) ? hubFilter.source : 'all',
      project: typeof hubFilter.project === 'string' ? hubFilter.project : '',
      showArchived: !!hubFilter.showArchived,
    },
    selectedSessionId: typeof s.selectedSessionId === 'string' ? s.selectedSessionId : '',
    detailOpen: !!s.detailOpen,
    turnLimit: typeof s.turnLimit === 'number' && s.turnLimit > 0 ? s.turnLimit : 15,
  };
}

function saveUiState(patch) {
  if (!patch || typeof patch !== 'object') return getUiState();
  const prev = getUiState();
  const next = {
    view: ['dashboard', 'sessions', 'settings'].includes(patch.view) ? patch.view : prev.view,
    filter: ['today', '7d', 'all'].includes(patch.filter) ? patch.filter : prev.filter,
    dashOpen: patch.dashOpen && typeof patch.dashOpen === 'object'
      ? {
          chart: patch.dashOpen.chart !== undefined ? !!patch.dashOpen.chart : prev.dashOpen.chart,
          models: patch.dashOpen.models !== undefined ? !!patch.dashOpen.models : prev.dashOpen.models,
          recent: patch.dashOpen.recent !== undefined ? !!patch.dashOpen.recent : prev.dashOpen.recent,
        }
      : prev.dashOpen,
    recentLimit: patch.recentLimit === null
      ? null
      : (typeof patch.recentLimit === 'number' && patch.recentLimit > 0 ? patch.recentLimit : prev.recentLimit),
    hubFilter: patch.hubFilter && typeof patch.hubFilter === 'object'
      ? {
          q: typeof patch.hubFilter.q === 'string' ? patch.hubFilter.q : prev.hubFilter.q,
          scope: patch.hubFilter.scope === 'window' ? 'window' : (patch.hubFilter.scope === 'all' ? 'all' : prev.hubFilter.scope),
          source: ['all', 'agent', 'vscode'].includes(patch.hubFilter.source) ? patch.hubFilter.source : prev.hubFilter.source,
          project: typeof patch.hubFilter.project === 'string' ? patch.hubFilter.project : prev.hubFilter.project,
          showArchived: patch.hubFilter.showArchived !== undefined ? !!patch.hubFilter.showArchived : prev.hubFilter.showArchived,
        }
      : prev.hubFilter,
    selectedSessionId: typeof patch.selectedSessionId === 'string' ? patch.selectedSessionId : prev.selectedSessionId,
    detailOpen: patch.detailOpen !== undefined ? !!patch.detailOpen : prev.detailOpen,
    turnLimit: typeof patch.turnLimit === 'number' && patch.turnLimit > 0 ? patch.turnLimit : prev.turnLimit,
  };
  currentWindow = next.filter;
  currentView = next.view;
  if (extensionContext && extensionContext.workspaceState) {
    Promise.resolve(extensionContext.workspaceState.update(UI_STATE_KEY, next)).catch(() => {});
  }
  return next;
}

function getArchivedIds() {
  if (!extensionContext || !extensionContext.globalState) return [];
  const raw = extensionContext.globalState.get(ARCHIVED_KEY);
  return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
}

async function setSessionArchivedState(id, archived) {
  if (!extensionContext || !extensionContext.globalState || !id) return;
  const set = new Set(getArchivedIds());
  if (archived) set.add(id);
  else set.delete(id);
  await extensionContext.globalState.update(ARCHIVED_KEY, [...set]);
}

function pushData() {
  if (!sidebarView && !panel) return;
  postToViews({ type: 'data', payload: buildPayload(currentWindow) });
}

function buildSessionsPayload() {
  if (!hubScanner) hubScanner = new SessionHubScanner();
  const scoping = windowScope();
  const list = hubScanner.scan({
    usageEventsRoot: usageOptions().root,
    includeVscodeChats: config().get('includeVscodeChats', true) !== false,
    pricingOpts: pricingOptions(),
  });
  cachedSessions = list;
  const archivedSet = new Set(getArchivedIds());
  const projects = [...new Set(list.map((s) => s.project).filter(Boolean))].sort();
  let archivedCount = 0;
  const mapped = list.map((s) => {
    const isArchived = archivedSet.has(s.id);
    if (isArchived) archivedCount += 1;
    return {
      id: s.id,
      rawId: s.rawId,
      source: s.source,
      title: s.title,
      cwd: s.cwd,
      workspacePath: s.workspacePath,
      project: s.project,
      repository: s.repository,
      branch: s.branch,
      active: s.active,
      archived: isArchived,
      inWindow: sessionMatchesScope(s, scoping),
      models: s.models,
      userTurns: s.userTurns,
      assistantTurns: s.assistantTurns,
      reqCount: s.reqCount,
      input: s.input,
      output: s.output,
      cached: s.cached,
      cacheWrite: s.cacheWrite,
      reasoning: s.reasoning,
      durMs: s.durMs,
      rate: s.rate,
      costUsd: s.costUsd,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      searchText: s.searchText,
    };
  });
  return {
    sessions: mapped,
    projects,
    archivedCount,
    hasWindowRoots: !!(scoping.roots.length || scoping.workspaceFile),
  };
}

function pushSessions() {
  if (!sidebarView && !panel) return;
  postToViews({ type: 'sessions', payload: buildSessionsPayload() });
}

function pushSessionDetail(id, targetWebview) {
  if ((!sidebarView && !panel) || !id) return;
  if (!hubScanner) hubScanner = new SessionHubScanner();
  if (!cachedSessions.length) buildSessionsPayload();
  const target = cachedSessions.find((s) => s.id === id);
  const msg = target
    ? { type: 'sessionDetail', payload: hubScanner.readDetail(target, pricingOptions()) }
    : { type: 'sessionDetail', payload: null };
  if (targetWebview) targetWebview.postMessage(msg);
  else postToViews(msg);
}

async function copyResumeCommand(id) {
  const target = cachedSessions.find((s) => s.id === id);
  if (!target || target.source !== 'agent') return;
  const cmd = `copilot --resume=${target.rawId}`;
  if (vscode.env && vscode.env.clipboard) {
    await vscode.env.clipboard.writeText(cmd);
  }
  vscode.window.showInformationMessage(tr()('msg.copiedResume', cmd));
}

function resumeSessionInTerminal(id) {
  const target = cachedSessions.find((s) => s.id === id);
  if (!target || target.source !== 'agent') return;
  const cmd = `copilot --resume=${target.rawId}`;
  if (typeof vscode.window.createTerminal !== 'function') return;
  const term = vscode.window.createTerminal({
    name: `Copilot: ${target.project || target.rawId.slice(0, 8)}`,
    cwd: target.cwd && fs.existsSync(target.cwd) ? target.cwd : undefined,
  });
  term.show(false);
  term.sendText(cmd, true);
}

function openSessionFolder(id) {
  const target = cachedSessions.find((s) => s.id === id);
  if (!target) return;
  revealFolder(target.cwd || (target.workspacePath ? path.dirname(target.workspacePath) : ''));
}

function findSessionById(id) {
  if (!cachedSessions.length) buildSessionsPayload();
  return cachedSessions.find((s) => s.id === id) || null;
}

async function forkSessionAction(id) {
  const t = tr();
  const target = findSessionById(id);
  if (!target || target.source !== 'agent') return;
  const res = forkAgentSession(usageOptions().root, target.rawId, { title: target.title });
  if (!res.ok) {
    vscode.window.showErrorMessage(t('msg.sessionActionFailed', res.message || 'unknown'));
    return;
  }
  dirCacheInvalidate();
  const nextUi = saveUiState({ selectedSessionId: res.id, detailOpen: false });
  postToViews({ type: 'uiState', payload: nextUi });
  pushSessions();
  vscode.window.showInformationMessage(t('msg.forked', res.rawId.slice(0, 8)));
}

async function moveSessionAction(id) {
  const t = tr();
  const target = findSessionById(id);
  if (!target || target.source !== 'agent') return;
  if (target.active) {
    vscode.window.showWarningMessage(t('msg.sessionInUse'));
    return;
  }

  const seenDirs = new Set();
  if (target.cwd) seenDirs.add(scope.normalizePath(target.cwd));
  const picks = [];

  for (const folder of vscode.workspace.workspaceFolders || []) {
    const fsPath = folder.uri && folder.uri.fsPath;
    if (!fsPath) continue;
    const norm = scope.normalizePath(fsPath);
    if (seenDirs.has(norm)) continue;
    seenDirs.add(norm);
    picks.push({
      label: folder.name || path.basename(fsPath),
      description: t('msg.currentWindowTag'),
      detail: fsPath,
      dirPath: fsPath,
    });
  }

  for (const s of cachedSessions) {
    if (!s.cwd) continue;
    const norm = scope.normalizePath(s.cwd);
    if (seenDirs.has(norm)) continue;
    if (!fs.existsSync(s.cwd)) continue;
    seenDirs.add(norm);
    picks.push({
      label: s.project || path.basename(s.cwd),
      description: t('msg.knownProjectTag'),
      detail: s.cwd,
      dirPath: s.cwd,
    });
  }

  picks.push({
    label: `$(folder-opened) ${t('msg.moveBrowse')}`,
    description: '',
    detail: '',
    browse: true,
  });

  const picked = await vscode.window.showQuickPick(picks, {
    placeHolder: t('msg.movePickPlaceholder'),
    matchOnDetail: true,
  });
  if (!picked) return;

  let chosenDir = picked.dirPath || '';
  if (picked.browse) {
    const defaultUri = target.cwd && fs.existsSync(target.cwd) ? vscode.Uri.file(target.cwd) : undefined;
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri,
    });
    if (!uris || !uris.length) return;
    chosenDir = uris[0].fsPath;
  }
  if (!chosenDir) return;

  const res = moveAgentSession(usageOptions().root, target.rawId, chosenDir);
  if (!res.ok) {
    vscode.window.showErrorMessage(t('msg.sessionActionFailed', res.message || 'unknown'));
    return;
  }

  dirCacheInvalidate();
  restartLoop();
  if (currentWindow !== 'today') deepBackfill();
  pushData();
  pushSettings();
  pushSessions();
  vscode.window.showInformationMessage(t('msg.moved', res.repository || path.basename(chosenDir)));
}

async function archiveSessionAction(id, archived) {
  const t = tr();
  const target = findSessionById(id);
  if (!target) return;
  await setSessionArchivedState(id, archived);
  const ui = getUiState();
  if (archived && !ui.hubFilter.showArchived && ui.selectedSessionId === id) {
    const nextUi = saveUiState({ selectedSessionId: '', detailOpen: false });
    postToViews({ type: 'uiState', payload: nextUi });
  }
  pushSessions();
  vscode.window.showInformationMessage(archived ? t('msg.archived') : t('msg.unarchived'));
}

async function deleteSessionAction(id) {
  const t = tr();
  const target = findSessionById(id);
  if (!target || target.source !== 'agent') return;
  if (target.active) {
    vscode.window.showWarningMessage(t('msg.sessionInUse'));
    return;
  }
  const delLabel = t('msg.delete');
  const ans = await vscode.window.showWarningMessage(
    t('msg.deleteSessionConfirm', target.title || target.rawId),
    { modal: true },
    delLabel
  );
  if (ans !== delLabel) return;

  const res = deleteAgentSession(usageOptions().root, target.rawId);
  if (!res.ok) {
    vscode.window.showErrorMessage(t('msg.sessionActionFailed', res.message || 'unknown'));
    return;
  }
  await setSessionArchivedState(id, false);
  if (getUiState().selectedSessionId === id) {
    const nextUi = saveUiState({ selectedSessionId: '', detailOpen: false });
    postToViews({ type: 'uiState', payload: nextUi });
  }
  dirCacheInvalidate();
  restartLoop();
  if (currentWindow !== 'today') deepBackfill();
  pushData();
  pushSettings();
  pushSessions();
  vscode.window.showInformationMessage(t('msg.deleted'));
}

function showSidebar(context) {
  if (typeof vscode.window.registerWebviewViewProvider === 'function') {
    Promise.resolve(vscode.commands.executeCommand(`${P}.sidebarView.focus`)).catch(() => showDashboard(context));
    return;
  }
  showDashboard(context);
}

function wireWebview(targetWebview, context) {
  targetWebview.onDidReceiveMessage((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      const ui = getUiState();
      currentWindow = ui.filter;
      currentView = ui.view;
      targetWebview.postMessage({ type: 'uiState', payload: ui });
      if (currentWindow !== 'today') deepBackfill();
      pushData();
      pushSettings();
      if (currentView === 'sessions') pushSessions();
    } else if (msg.type === 'saveUiState') {
      saveUiState(msg.patch);
    } else if (msg.type === 'tab') {
      saveUiState({ view: msg.view || 'dashboard' });
      if (msg.view === 'settings') pushSettings();
      else if (msg.view === 'sessions') pushSessions();
    } else if (msg.type === 'filter') {
      const w = ['today', '7d', 'all'].includes(msg.window) ? msg.window : 'today';
      saveUiState({ filter: w });
      if (currentWindow !== 'today') deepBackfill();
      pushData();
    } else if (msg.type === 'refresh') {
      dirCacheInvalidate();
      tick(true);
      pushData();
      pushSettings();
      if (currentView === 'sessions') pushSessions();
    } else if (msg.type === 'openTab') {
      showDashboard(context);
    } else if (msg.type === 'sessionDetail') {
      pushSessionDetail(msg.id, targetWebview);
    } else if (msg.type === 'copyResume') {
      copyResumeCommand(msg.id);
    } else if (msg.type === 'resumeInTerminal') {
      resumeSessionInTerminal(msg.id);
    } else if (msg.type === 'openSessionFolder') {
      openSessionFolder(msg.id);
    } else if (msg.type === 'forkSession') {
      forkSessionAction(msg.id);
    } else if (msg.type === 'moveSession') {
      moveSessionAction(msg.id);
    } else if (msg.type === 'archiveSession') {
      archiveSessionAction(msg.id, true);
    } else if (msg.type === 'unarchiveSession') {
      archiveSessionAction(msg.id, false);
    } else if (msg.type === 'deleteSession') {
      deleteSessionAction(msg.id);
    } else if (msg.type === 'enableLogging') {
      enableLogging(context);
    } else if (msg.type === 'setScope') {
      applyScope(msg.value, false);
    } else if (msg.type === 'setConfig') {
      applySetting(msg.key, msg.value, false);
    } else if (msg.type === 'resetConfig') {
      applySetting(msg.key, null, true);
    } else if (msg.type === 'browse') {
      browseSetting(msg.key);
    } else if (msg.type === 'revealUsageRoot') {
      revealFolder(usageScanner ? usageScanner.root(usageOptions()) : '');
    } else if (msg.type === 'diagnostics') {
      showDiagnostics();
    } else if (msg.type === 'exportJson') {
      exportJson();
    } else if (msg.type === 'clearHistory') {
      clearHistory();
    } else if (msg.type === 'openVsCodeSettings') {
      openSettingsJson();
    }
  });
}

function showDashboard(context) {
  if (panel) {
    panel.reveal(undefined, false);
    pushData();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    `${P}.dashboard`,
    'Copilot Speedometer',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
  );

  const nonce = makeNonce();
  panel.webview.html = webview.html(nonce, panel.webview.cspSource, panelLocale(), false);
  wireWebview(panel.webview, context);

  panel.onDidDispose(() => {
    panel = null;
  });

  pushData();
}

function makeNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i += 1) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

async function enableLogging(context) {
  const t = tr();
  const cfg = vscode.workspace.getConfiguration(COPILOT_CONFIG);
  try {
    await cfg.update(FILE_LOGGING_KEY, true, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(t('msg.loggingEnabled'));
  } catch (err) {
    vscode.window.showErrorMessage(t('msg.loggingFailed', `${COPILOT_CONFIG}.${FILE_LOGGING_KEY}: ${err.message}`));
  }
  context.globalState.update(WARNED_KEY, true);
  setTimeout(() => {
    dirCacheInvalidate();
    tick(true);
  }, 1500);
}

async function maybeWarnSetup(context) {
  setTimeout(async () => {
    if (records.length > 0) return;
    if (context.globalState.get(WARNED_KEY)) return;
    const state = loggingState();
    if (state.enabled) return;
    // BYOK / custom-endpoint users have usage records and need no debug logging.
    if (usageScanner && usageScanner.existingRoots(usageOptions()).length) return;
    const t = tr();
    const enableLabel = t('msg.setupEnable');
    const pick = await vscode.window.showInformationMessage(
      t('msg.setupAsk'),
      enableLabel,
      t('msg.setupLater')
    );
    await context.globalState.update(WARNED_KEY, true);
    if (pick === enableLabel) enableLogging(context);
  }, 2500);
}

async function exportJson() {
  const t = tr();
  const visible = scopedRecords();
  if (!visible.length) {
    vscode.window.showInformationMessage(t('msg.nothingToExport'));
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = await vscode.window.showSaveDialog({
    filters: { JSON: ['json'] },
    saveLabel: t('msg.exportLabel'),
    defaultUri: vscode.Uri.joinPath(
      (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
        ? vscode.workspace.workspaceFolders[0].uri
        : vscode.Uri.file(require('os').homedir())),
      `copilot-speedometer-${stamp}.json`
    ),
  });
  if (!target) return;
  const pOpts = pricingOptions();
  const payload = {
    exportedAt: new Date().toISOString(),
    scope: windowScope(),
    summary: summarize(visible, pOpts),
    byModel: groupByModel(visible, pOpts),
    requests: visible,
  };
  fs.writeFileSync(target.fsPath, JSON.stringify(payload, null, 2), 'utf8');
  vscode.window.showInformationMessage(t('msg.exported', visible.length, path.basename(target.fsPath)));
}

function seedDemo() {
  const t = tr();
  if (records.length) {
    vscode.window.showInformationMessage(t('msg.demoOnlyEmpty'));
    return;
  }
  const models = ['gpt-5.1-codex', 'claude-sonnet-4.5', 'gemini-2.5-pro'];
  const now = Date.now();
  for (let i = 0; i < 24; i += 1) {
    const model = models[i % models.length];
    const output = 120 + Math.round(Math.random() * 900);
    const ttft = 600 + Math.round(Math.random() * 900);
    const decodeMs = (output / (25 + Math.random() * 35)) * 1000;
    const rec = {
      id: `demo-${i}`,
      ts: now - (24 - i) * 90000,
      model,
      input: 1800 + Math.round(Math.random() * 6000),
      output,
      cached: Math.round(Math.random() * 3000),
      durMs: Math.round(ttft + decodeMs),
      ttftMs: ttft,
      rate: 0,
      decodeRate: 0,
      file: null,
    };
    rec.rate = rec.output / (rec.durMs / 1000);
    rec.decodeRate = (rec.output - 1) / ((rec.durMs - rec.ttftMs) / 1000);
    records.push(rec);
    seen.add(rec.id);
  }
  demoMode = true;
  scopeCacheInvalidate();
  updateStatusBar();
  pushData();
  vscode.window.showInformationMessage(t('msg.demoLoaded'));
}

module.exports = { activate, deactivate };
