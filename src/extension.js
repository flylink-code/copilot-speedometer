'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { LogScanner, parseEventLine } = require('./parser');
const { UsageScanner, parseUsageLine } = require('./usage-events');
const { summarize, groupByModel, fmtRate, fmtTokens, fmtDur } = require('./stats');
const webview = require('./webview');
const settings = require('./settings');
const i18n = require('./i18n');

const P = 'copilotSpeedometer';
const COPILOT_CONFIG = 'github.copilot.chat';
const FILE_LOGGING_KEY = 'agentDebugLog.fileLogging.enabled';
const WARNED_KEY = 'copilotSpeedometer.setupNotificationShown';

let records = [];
let seen = new Set();
let deepLoaded = false;
let scanner = null;
let usageScanner = null;
let timer = null;
let statusBar = null;
let panel = null;
let demoMode = false;
let output = null;
let translator = null;

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

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand(`${P}.showDashboard`, () => showDashboard(context)),
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

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.command = `${P}.showDashboard`;
  statusBar.name = tr()('status.name');
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(P)) {
        dirCacheInvalidate();
        const rescan = ['enabled', 'usageEvents', 'usageEventsRoot', 'logPath', 'includeLegacyWorkspaceLogs', 'pollIntervalMs', 'historySize', 'backfillDays']
          .some((key) => e.affectsConfiguration(`${P}.${key}`));
        if (rescan) {
          restartLoop();
        } else {
          updateStatusBar();
          pushData();
        }
        pushSettings();
      }
      if (e.affectsConfiguration(`${COPILOT_CONFIG}.${FILE_LOGGING_KEY}`)) {
        pushData();
        pushSettings();
      }
    }),
    { dispose: () => { if (timer) clearInterval(timer); } }
  );

  restartLoop();
  maybeWarnSetup(context);
}

function deactivate() {
  if (timer) clearInterval(timer);
  timer = null;
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

  const bySource = records.reduce((acc, r) => {
    acc[r.source || 'log'] = (acc[r.source || 'log'] || 0) + 1;
    return acc;
  }, {});
  lines.push(t('diag.capturedTitle'));
  lines.push(`  ${t('diag.totalRecords')}: ${records.length}`);
  for (const [k, v] of Object.entries(bySource)) lines.push(`    ${k}: ${v}`);
  const last = records[records.length - 1];
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
  if (scanner) scanner.dirCache = null;
  if (usageScanner) {
    usageScanner.dirCache = null;
    usageScanner.dirCacheAt = 0;
  }
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
        total: records.length,
        usage: records.filter((r) => r.source === 'usage').length,
        byok: records.filter((r) => r.byok).length,
      },
    },
  });
}

function pushSettings() {
  if (!panel) return;
  panel.webview.postMessage({ type: 'settings', payload: buildSettingsPayload() });
}

function postConfigResult(result) {
  if (!panel) return;
  panel.webview.postMessage(Object.assign({ type: 'configResult' }, result));
}

async function applySetting(key, value, reset) {
  try {
    const result = await settings.apply(configBundle(), key, value, reset);
    postConfigResult(result);
    if (result.ok) {
      dirCacheInvalidate();
      pushSettings();
      updateStatusBar();
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
  records = [];
  seen.clear();
  deepLoaded = false;
  demoMode = false;
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

function tick(force) {
  if (!config().get('enabled', true)) return;

  const cap = Math.max(100, Number(config().get('historySize', 3000)) || 3000);
  const batch = [];
  const usageKeys = new Set();

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
      for (const line of lines) add(parseUsageLine(line, entry.file), true);
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
      const rec = parseEventLine(line, entry.file);
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
  }

  if (batch.length || force) {
    updateStatusBar();
    pushData();
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
        const rec = parseUsageLine(line, entry.file);
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
}

function updateStatusBar() {
  if (!statusBar) return;
  if (!config().get('statusBar', true) || !config().get('enabled', true)) {
    statusBar.hide();
    return;
  }
  statusBar.show();

  const t = tr();
  const last = records[records.length - 1];
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

  const recent = records.slice(-20);
  const agg = summarize(recent);
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Copilot Speedometer**\n\n`);
  md.appendMarkdown(`${t('status.md.last')}: **${fmtRate(last.rate)} tok/s**\n\n`);
  md.appendMarkdown(`| | |\n|:--|--:|\n`);
  md.appendMarkdown(`| ${t('status.md.model')} | \`${last.model}\` |\n`);
  md.appendMarkdown(`| ${t('status.md.output')} | ${last.output} |\n`);
  md.appendMarkdown(`| ${t('status.md.duration')} | ${fmtDur(last.durMs)} |\n`);
  if (last.ttftMs) md.appendMarkdown(`| ${t('status.md.ttft')} | ${fmtDur(last.ttftMs)} |\n`);
  if (last.decodeRate) md.appendMarkdown(`| ${t('status.md.decode')} | ${fmtRate(last.decodeRate)} tok/s |\n`);
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

  const inWindow = records.filter((r) => r.ts >= from);
  const agg = summarize(inWindow);
  const last = inWindow.length ? inWindow[inWindow.length - 1] : null;
  const opts = scannerOptions();
  const roots = scanner ? scanner.existingRoots(opts).map((r) => r.root) : [];
  const usageRoots = usageScanner && usageEnabled() ? usageScanner.existingRoots(usageOptions()) : [];
  const logState = loggingState();
  const fromUsage = records.filter((r) => r.source === 'usage').length;
  const byokCount = records.filter((r) => r.byok).length;

  const pick = (r) => ({
    id: r.id,
    ts: r.ts,
    model: r.model,
    input: r.input,
    output: r.output,
    cached: r.cached,
    durMs: r.durMs,
    ttftMs: r.ttftMs,
    rate: r.rate,
    decodeRate: r.decodeRate,
    source: r.source || 'log',
    byok: !!r.byok,
  });

  return {
    window: windowKey,
    hasData: inWindow.length > 0,
    agg,
    lastRate: last ? last.rate : null,
    lastModel: last ? last.model : null,
    lastOutput: last ? last.output : null,
    models: groupByModel(inWindow),
    series: inWindow.slice(-80).map(pick),
    requests: inWindow.slice(-200).reverse().map(pick),
    totalCaptured: records.length,
    demo: demoMode,
    setup: {
      loggingEnabled: logState.enabled,
      loggingKnown: logState.known,
      roots,
      logPathSetting: opts.logPath,
      usageRoots,
      usageEnabled: usageEnabled(),
      counts: { total: records.length, usage: fromUsage, byok: byokCount },
    },
  };
}

let currentWindow = 'today';

function pushData() {
  if (!panel) return;
  panel.webview.postMessage({ type: 'data', payload: buildPayload(currentWindow) });
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
  panel.webview.html = webview.html(nonce, panel.webview.cspSource, panelLocale());

  panel.webview.onDidReceiveMessage((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      if (typeof msg.window === 'string') currentWindow = msg.window;
      if (currentWindow !== 'today') deepBackfill();
      pushData();
      pushSettings();
    } else if (msg.type === 'tab') {
      if (msg.view === 'settings') pushSettings();
    } else if (msg.type === 'filter') {
      currentWindow = ['today', '7d', 'all'].includes(msg.window) ? msg.window : 'today';
      if (currentWindow !== 'today') deepBackfill();
      pushData();
    } else if (msg.type === 'refresh') {
      dirCacheInvalidate();
      tick(true);
      pushData();
      pushSettings();
    } else if (msg.type === 'enableLogging') {
      enableLogging(context);
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
  if (!records.length) {
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
  const payload = {
    exportedAt: new Date().toISOString(),
    summary: summarize(records),
    byModel: groupByModel(records),
    requests: records,
  };
  fs.writeFileSync(target.fsPath, JSON.stringify(payload, null, 2), 'utf8');
  vscode.window.showInformationMessage(t('msg.exported', records.length, path.basename(target.fsPath)));
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
  updateStatusBar();
  pushData();
  vscode.window.showInformationMessage(t('msg.demoLoaded'));
}

module.exports = { activate, deactivate };
