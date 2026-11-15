'use strict';

/**
 * Read-only cross-workspace Copilot session index + conversation reader.
 *
 * Reads two local stores without modifying them (modifying `state.vscdb` or
 * `agent-host.db` while VS Code is running gets overwritten on window exit or
 * breaks versioned hashes):
 *
 *   1. Agent / CLI sessions: `~/.copilot/session-state/<id>/`
 *      (`workspace.yaml` + `events.jsonl` + `inuse.*.hold|lock`)
 *   2. VS Code local Chat sessions:
 *      `<editorUser>/workspaceStorage/<hash>/chatSessions/*.jsonl`
 *      (+ `workspace.json` and `globalStorage/emptyWindowChatSessions/*.jsonl`)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { editorUserDirs } = require('./parser');
const { defaultRoot, usageToRecord } = require('./usage-events');
const { DirMetadataCache, normalizePath, parseWorkspaceYaml, workspaceStorageId, matchesRoots } = require('./scope');
const { estimateCost } = require('./pricing');

const MAX_VSCODE_CHAT_BYTES = 8 * 1024 * 1024;
const MAX_DETAIL_TURNS = 200;
const CHUNK_SIZE = 64 * 1024;

function readTextSafe(file, maxBytes) {
  let fd;
  try {
    const st = fs.statSync(file);
    if (!st.size) return '';
    if (maxBytes && st.size > maxBytes) {
      fd = fs.openSync(file, 'r');
      const buf = Buffer.allocUnsafe(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.toString('utf8');
    }
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Stream a potentially large JSONL file line by line without holding the whole raw file in RAM. */
function forEachLine(file, onLine) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(CHUNK_SIZE);
    let leftover = '';
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, CHUNK_SIZE, null)) > 0) {
      const text = leftover + buf.subarray(0, read).toString('utf8');
      let start = 0;
      let nl = text.indexOf('\n', start);
      while (nl !== -1) {
        const line = text.slice(start, nl).trim();
        if (line) onLine(line);
        start = nl + 1;
        nl = text.indexOf('\n', start);
      }
      leftover = text.slice(start);
    }
    if (leftover.trim()) onLine(leftover.trim());
  } catch {
    /* unreadable or vanished during scan */
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function parseWorkspaceMeta(file) {
  const raw = readTextSafe(file, 32 * 1024);
  if (!raw) return { id: '', cwd: '', gitRoot: '', repository: '', branch: '', name: '', fields: {}, createdAt: 0, updatedAt: 0 };
  const fields = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let val = m[2].trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val[val.length - 1] === val[0]) {
      val = val.slice(1, -1);
    }
    fields[m[1]] = val;
  }
  const cwd = fields.cwd || parseWorkspaceYaml(raw);
  return {
    id: fields.id || '',
    cwd,
    gitRoot: fields.git_root || '',
    repository: fields.repository || '',
    branch: fields.branch || '',
    name: fields.name || '',
    fields,
    createdAt: Date.parse(fields.created_at || '') || 0,
    updatedAt: Date.parse(fields.updated_at || '') || 0,
  };
}

/** Strip injected XML context wrappers so session titles show what the user actually asked. */
function cleanPromptText(text) {
  if (!text) return '';
  const raw = String(text);
  let s = raw.replace(/<(?:system_reminder|ide_selection|context|reminder|current_datetime|tools_changed_notice)>[\s\S]*?<\/(?:system_reminder|ide_selection|context|reminder|current_datetime|tools_changed_notice)>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (s) return s;

  // Some turns only carry an IDE selection block; extract the file/lines instead of dropping the turn.
  const sel = /<ide_selection>[\s\S]*?(File:\s*[^\r\n]+)/i.exec(raw);
  if (sel) return sel[1].trim();
  return '';
}

function shortTitle(text, fallback) {
  const clean = cleanPromptText(text);
  if (!clean) return fallback || '';
  return clean.length > 90 ? `${clean.slice(0, 89)}…` : clean;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function detectInUse(sessionDir) {
  try {
    const entries = fs.readdirSync(sessionDir);
    for (const name of entries) {
      const m = /^inuse\.(\d+)\.(?:lock|hold)$/.exec(name);
      if (m && isPidAlive(Number(m[1]))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function projectLabel(cwd, repository) {
  if (repository) return repository;
  if (!cwd) return '';
  const parts = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : cwd;
}

function summarizeAgentFile(eventsFile, sessionDir, st, pricingOpts) {
  const meta = parseWorkspaceMeta(path.join(sessionDir, 'workspace.yaml'));
  const sessionId = meta.id || path.basename(sessionDir);
  let cwd = meta.cwd;
  let branch = meta.branch;
  let repository = meta.repository;
  let title = meta.name || '';
  let userTurns = 0;
  let assistantTurns = 0;
  let reqCount = 0;
  let input = 0;
  let output = 0;
  let cached = 0;
  let cacheWrite = 0;
  let reasoning = 0;
  let durMs = 0;
  let costSum = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let firstTs = meta.createdAt || 0;
  let lastTs = meta.updatedAt || st.mtimeMs;
  const models = new Set();
  const promptSnippets = [];

  forEachLine(eventsFile, (line) => {
    // Fast pre-filter before JSON.parse: events.jsonl has many hook/tool lines.
    const want =
      line.indexOf('"session.usage_record"') !== -1 ||
      line.indexOf('"user.message"') !== -1 ||
      line.indexOf('"assistant.message"') !== -1 ||
      line.indexOf('"session.start"') !== -1 ||
      line.indexOf('"session.resume"') !== -1;
    if (!want) return;

    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    const ts = Date.parse(ev.timestamp || '') || 0;
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (ts > lastTs) lastTs = ts;
    }

    if (ev.type === 'session.start' || ev.type === 'session.resume') {
      const ctx = ev.data && ev.data.context;
      if (ctx) {
        if (!cwd && typeof ctx.cwd === 'string') cwd = ctx.cwd;
        if (!branch && typeof ctx.branch === 'string') branch = ctx.branch;
        if (!repository && typeof ctx.repository === 'string') repository = ctx.repository;
      }
      if (ev.data && typeof ev.data.selectedModel === 'string') {
        models.add(ev.data.selectedModel.split('/').pop() || ev.data.selectedModel);
      }
    } else if (ev.type === 'user.message') {
      userTurns += 1;
      const content = ev.data && typeof ev.data.content === 'string' ? ev.data.content : '';
      const clean = cleanPromptText(content);
      if (clean) {
        if (!title) title = shortTitle(clean, '');
        if (promptSnippets.length < 8) promptSnippets.push(clean.slice(0, 120));
      }
    } else if (ev.type === 'assistant.message') {
      const content = ev.data && typeof ev.data.content === 'string' ? ev.data.content.trim() : '';
      if (content) assistantTurns += 1;
    } else if (ev.type === 'session.usage_record') {
      const rec = usageToRecord(ev, eventsFile, cwd);
      if (!rec) return;
      reqCount += 1;
      input += rec.input;
      output += rec.output;
      cached += rec.cached;
      cacheWrite += rec.cacheWrite || 0;
      reasoning += rec.reasoning || 0;
      durMs += rec.durMs;
      models.add(rec.model);
      const est = estimateCost(rec, pricingOpts);
      if (est) {
        costSum += est.costUsd;
        pricedCount += 1;
      } else {
        unpricedCount += 1;
      }
    }
  });

  if (!userTurns && !reqCount && !assistantTurns) return null;

  return {
    id: `agent:${sessionId}`,
    rawId: sessionId,
    source: 'agent',
    file: eventsFile,
    dir: sessionDir,
    title: title || projectLabel(cwd, repository) || sessionId.slice(0, 8),
    cwd: cwd || '',
    workspacePath: '',
    project: projectLabel(cwd, repository),
    repository: repository || '',
    branch: branch || '',
    active: detectInUse(sessionDir),
    models: [...models],
    userTurns,
    assistantTurns,
    reqCount,
    input,
    output,
    cached,
    cacheWrite,
    reasoning,
    durMs,
    rate: durMs > 0 && output > 0 ? output / (durMs / 1000) : null,
    costUsd: pricedCount > 0 ? costSum : null,
    pricedCount,
    unpricedCount,
    createdAt: firstTs || st.mtimeMs,
    updatedAt: lastTs || st.mtimeMs,
    searchText: [title, cwd, repository, branch, ...models, ...promptSnippets].join('\n').toLowerCase(),
  };
}

function setAtPath(root, pathArr, value) {
  if (!root || !Array.isArray(pathArr) || !pathArr.length) return;
  let cur = root;
  for (let i = 0; i < pathArr.length - 1; i += 1) {
    const key = pathArr[i];
    if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== 'object') {
      cur[key] = typeof pathArr[i + 1] === 'number' ? [] : {};
    }
    cur = cur[key];
  }
  cur[pathArr[pathArr.length - 1]] = value;
}

function pushAtPath(root, pathArr, items, index) {
  if (!root || !Array.isArray(pathArr) || !pathArr.length || !Array.isArray(items)) return;
  let cur = root;
  for (let i = 0; i < pathArr.length - 1; i += 1) {
    const key = pathArr[i];
    if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== 'object') {
      cur[key] = typeof pathArr[i + 1] === 'number' ? [] : {};
    }
    cur = cur[key];
  }
  const leaf = pathArr[pathArr.length - 1];
  if (!Array.isArray(cur[leaf])) cur[leaf] = [];
  if (typeof index === 'number' && index >= 0) {
    cur[leaf].splice(index, 0, ...items);
  } else {
    cur[leaf].push(...items);
  }
}

/** Reconstruct one VS Code `chatSessions/*.json[l]` file in memory. */
function replayVscodeChatFile(file) {
  const raw = readTextSafe(file, MAX_VSCODE_CHAT_BYTES);
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Legacy `.json` format: single object with `requests`.
  if (file.endsWith('.json') && trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  let state = null;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let op;
    try {
      op = JSON.parse(line);
    } catch {
      continue;
    }
    if (op.kind === 0 && op.v && typeof op.v === 'object') {
      state = op.v;
    } else if (op.kind === 1 && state && Array.isArray(op.k)) {
      setAtPath(state, op.k, op.v);
    } else if (op.kind === 2 && state && Array.isArray(op.k)) {
      pushAtPath(state, op.k, op.v, op.i);
    }
  }
  return state;
}

function extractVscodeResponseText(req) {
  if (!req || !Array.isArray(req.response)) return '';
  const parts = [];
  for (const item of req.response) {
    if (item && typeof item.value === 'string' && !item.kind) {
      parts.push(item.value);
    }
  }
  return parts.join('').trim();
}

function summarizeVscodeChatFile(file, wsInfo, st, pricingOpts) {
  const state = replayVscodeChatFile(file);
  if (!state) return null;
  const requests = Array.isArray(state.requests) ? state.requests : [];
  if (!requests.length && !state.customTitle) return null;

  const sessionId = state.sessionId || path.basename(file, path.extname(file));
  const models = new Set();
  let input = 0;
  let output = 0;
  let durMs = 0;
  let costSum = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let title = typeof state.customTitle === 'string' ? state.customTitle.trim() : '';
  let lastTs = Number(state.creationDate) || st.mtimeMs;
  const snippets = [];

  for (const req of requests) {
    if (!req || typeof req !== 'object') continue;
    const prompt = req.message && typeof req.message.text === 'string' ? req.message.text : '';
    const clean = cleanPromptText(prompt);
    if (clean) {
      if (!title) title = shortTitle(clean, '');
      if (snippets.length < 6) snippets.push(clean.slice(0, 120));
    }
    const ts = Number(req.timestamp) || (req.modelState && Number(req.modelState.completedAt)) || 0;
    if (ts > lastTs) lastTs = ts;
    const model =
      req.modelId ||
      (state.inputState && state.inputState.selectedModel && state.inputState.selectedModel.identifier) ||
      '';
    if (model) models.add(model);

    const pt = Number(req.promptTokens) || 0;
    const ct = Number(req.completionTokens) || 0;
    const el = Number(req.elapsedMs) || (req.result && req.result.timings && Number(req.result.timings.totalElapsed)) || 0;
    input += pt;
    output += ct;
    durMs += el;

    if (ct > 0 && model) {
      const est = estimateCost({ rawModel: model, model, input: pt, output: ct, cached: 0 }, pricingOpts);
      if (est) {
        costSum += est.costUsd;
        pricedCount += 1;
      } else {
        unpricedCount += 1;
      }
    }
  }

  if (!requests.length) return null;

  const cwd = (wsInfo && wsInfo.folder) || '';
  const workspacePath = (wsInfo && wsInfo.workspace) || '';
  const proj = projectLabel(cwd || workspacePath, '');

  return {
    id: `vscode:${sessionId}`,
    rawId: sessionId,
    source: 'vscode',
    file,
    dir: path.dirname(file),
    title: title || proj || sessionId.slice(0, 8),
    cwd,
    workspacePath,
    project: proj,
    repository: '',
    branch: '',
    active: false,
    models: [...models],
    userTurns: requests.length,
    assistantTurns: requests.filter((r) => extractVscodeResponseText(r).length > 0).length,
    reqCount: requests.length,
    input,
    output,
    cached: 0,
    cacheWrite: 0,
    reasoning: 0,
    durMs,
    rate: durMs > 0 && output > 0 ? output / (durMs / 1000) : null,
    costUsd: pricedCount > 0 ? costSum : null,
    pricedCount,
    unpricedCount,
    createdAt: Number(state.creationDate) || st.mtimeMs,
    updatedAt: lastTs || st.mtimeMs,
    searchText: [title, cwd, workspacePath, ...models, ...snippets].join('\n').toLowerCase(),
  };
}

function readAgentDetail(session, pricingOpts) {
  const turns = [];
  const usageByTurn = new Map();
  let shutdown = null;

  const flushTools = (pendingTools, ts, model) => {
    if (!pendingTools.size) return;
    turns.push({
      role: 'tools',
      ts,
      model: model || '',
      tools: [...pendingTools.entries()].map(([name, count]) => ({ name, count })),
    });
    pendingTools.clear();
  };

  let pendingTools = new Map();
  let pendingToolTs = 0;
  let pendingToolModel = '';

  forEachLine(session.file, (line) => {
    const want =
      line.indexOf('"user.message"') !== -1 ||
      line.indexOf('"assistant.message"') !== -1 ||
      line.indexOf('"session.usage_record"') !== -1 ||
      line.indexOf('"session.shutdown"') !== -1;
    if (!want) return;

    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    const ts = Date.parse(ev.timestamp || '') || 0;

    if (ev.type === 'user.message') {
      flushTools(pendingTools, pendingToolTs, pendingToolModel);
      const raw = ev.data && typeof ev.data.content === 'string' ? ev.data.content : '';
      const text = cleanPromptText(raw);
      if (text) turns.push({ role: 'user', ts, text });
    } else if (ev.type === 'assistant.message') {
      const d = ev.data || {};
      const model = d.model || '';
      const text = typeof d.content === 'string' ? d.content.trim() : '';
      const reqs = Array.isArray(d.toolRequests) ? d.toolRequests : [];
      if (text) {
        flushTools(pendingTools, pendingToolTs, pendingToolModel);
        turns.push({ role: 'assistant', ts, model, text, turnId: d.turnId || '' });
      }
      for (const req of reqs) {
        const name = req && req.name ? String(req.name) : 'tool';
        pendingTools.set(name, (pendingTools.get(name) || 0) + 1);
        pendingToolTs = ts || pendingToolTs;
        pendingToolModel = model || pendingToolModel;
      }
    } else if (ev.type === 'session.usage_record') {
      const rec = usageToRecord(ev, session.file, session.cwd);
      if (!rec) return;
      const est = estimateCost(rec, pricingOpts);
      usageByTurn.set(ts, {
        model: rec.model,
        input: rec.input,
        output: rec.output,
        cached: rec.cached,
        durMs: rec.durMs,
        rate: rec.rate,
        costUsd: est ? est.costUsd : null,
      });
    } else if (ev.type === 'session.shutdown' && ev.data) {
      shutdown = ev.data.accountingSnapshot || ev.data;
    }
  });

  flushTools(pendingTools, pendingToolTs, pendingToolModel);

  // Attach the closest usage record (within 2s) onto assistant turns when available.
  const usageEntries = [...usageByTurn.entries()].sort((a, b) => a[0] - b[0]);
  let ui = 0;
  for (const turn of turns) {
    if (turn.role !== 'assistant' || !turn.ts) continue;
    while (ui < usageEntries.length && usageEntries[ui][0] < turn.ts - 1000) ui += 1;
    if (ui < usageEntries.length && Math.abs(usageEntries[ui][0] - turn.ts) <= 5000) {
      turn.usage = usageEntries[ui][1];
      ui += 1;
    }
  }

  const truncated = turns.length > MAX_DETAIL_TURNS;
  return {
    session,
    turns: truncated ? turns.slice(turns.length - MAX_DETAIL_TURNS) : turns,
    truncated,
    totalTurns: turns.length,
    shutdown: shutdown && shutdown.codeChanges ? { codeChanges: shutdown.codeChanges } : null,
  };
}

function readVscodeDetail(session, pricingOpts) {
  const state = replayVscodeChatFile(session.file);
  const turns = [];
  if (state && Array.isArray(state.requests)) {
    for (const req of state.requests) {
      if (!req || typeof req !== 'object') continue;
      const ts = Number(req.timestamp) || 0;
      const prompt = req.message && typeof req.message.text === 'string' ? cleanPromptText(req.message.text) : '';
      if (prompt) turns.push({ role: 'user', ts, text: prompt });

      const reply = extractVscodeResponseText(req);
      const model =
        req.modelId ||
        (state.inputState && state.inputState.selectedModel && state.inputState.selectedModel.identifier) ||
        '';
      const pt = Number(req.promptTokens) || 0;
      const ct = Number(req.completionTokens) || 0;
      const el = Number(req.elapsedMs) || (req.result && req.result.timings && Number(req.result.timings.totalElapsed)) || 0;
      const est = ct > 0 && model ? estimateCost({ rawModel: model, model, input: pt, output: ct, cached: 0 }, pricingOpts) : null;
      if (reply) {
        turns.push({
          role: 'assistant',
          ts: (req.modelState && Number(req.modelState.completedAt)) || ts,
          model,
          text: reply,
          usage: ct > 0 ? { model, input: pt, output: ct, cached: 0, durMs: el, rate: el > 0 ? ct / (el / 1000) : null, costUsd: est ? est.costUsd : null } : null,
        });
      }
    }
  }

  const truncated = turns.length > MAX_DETAIL_TURNS;
  return {
    session,
    turns: truncated ? turns.slice(turns.length - MAX_DETAIL_TURNS) : turns,
    truncated,
    totalTurns: turns.length,
    shutdown: null,
  };
}

class SessionHubScanner {
  constructor(opts = {}) {
    this.cache = new Map(); // file -> { key, summary }
    this.wsCache = new DirMetadataCache(opts.now);
    this.editorDirs = opts.editorUserDirs || editorUserDirs;
  }

  invalidate() {
    this.cache.clear();
    this.wsCache.clear();
  }

  pricingKey(pricingOpts) {
    if (!pricingOpts) return '1';
    return `${pricingOpts.multiplier ?? 1}|${JSON.stringify(pricingOpts.customPricing || {})}`;
  }

  scan(opts = {}) {
    const pKey = this.pricingKey(opts.pricingOpts);
    const sessions = [];

    // 1. Agent / CLI sessions
    const agentRoot = (typeof opts.usageEventsRoot === 'string' && opts.usageEventsRoot.trim()) || defaultRoot();
    let names = [];
    try {
      names = fs.readdirSync(agentRoot, { withFileTypes: true });
    } catch {
      names = [];
    }
    for (const e of names) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const sessionDir = path.join(agentRoot, e.name);
      const eventsFile = path.join(sessionDir, 'events.jsonl');
      let st;
      try {
        st = fs.statSync(eventsFile);
        if (!st.isFile() || st.size === 0) continue;
      } catch {
        continue;
      }
      const key = `${st.mtimeMs}|${st.size}|${pKey}`;
      const cached = this.cache.get(eventsFile);
      let summary;
      if (cached && cached.key === key) {
        summary = Object.assign({}, cached.summary, { active: detectInUse(sessionDir) });
      } else {
        summary = summarizeAgentFile(eventsFile, sessionDir, st, opts.pricingOpts);
        this.cache.set(eventsFile, { key, summary });
      }
      if (summary) sessions.push(summary);
    }

    // 2. VS Code local chat sessions (optional, default true)
    if (opts.includeVscodeChats !== false) {
      const seenFiles = new Set();
      for (const userDir of this.editorDirs()) {
        const wsStorage = path.join(userDir, 'workspaceStorage');
        let wsEntries = [];
        try {
          wsEntries = fs.readdirSync(wsStorage, { withFileTypes: true });
        } catch {
          wsEntries = [];
        }
        for (const wsDir of wsEntries) {
          if (!wsDir.isDirectory()) continue;
          const hashDir = path.join(wsStorage, wsDir.name);
          const chatDir = path.join(hashDir, 'chatSessions');
          let chatFiles = [];
          try {
            chatFiles = fs.readdirSync(chatDir, { withFileTypes: true });
          } catch {
            continue;
          }
          const wsInfo = workspaceStorageId(hashDir, this.wsCache);
          for (const f of chatFiles) {
            if (!f.isFile() || (!f.name.endsWith('.jsonl') && !f.name.endsWith('.json'))) continue;
            const full = path.join(chatDir, f.name);
            if (seenFiles.has(full)) continue;
            seenFiles.add(full);
            let st;
            try {
              st = fs.statSync(full);
              if (!st.isFile() || st.size === 0) continue;
            } catch {
              continue;
            }
            const key = `${st.mtimeMs}|${st.size}|${pKey}`;
            const cached = this.cache.get(full);
            let summary;
            if (cached && cached.key === key) {
              summary = cached.summary;
            } else {
              summary = summarizeVscodeChatFile(full, wsInfo, st, opts.pricingOpts);
              this.cache.set(full, { key, summary });
            }
            if (summary) sessions.push(summary);
          }
        }

        const emptyDir = path.join(userDir, 'globalStorage', 'emptyWindowChatSessions');
        let emptyFiles = [];
        try {
          emptyFiles = fs.readdirSync(emptyDir, { withFileTypes: true });
        } catch {
          emptyFiles = [];
        }
        for (const f of emptyFiles) {
          if (!f.isFile() || (!f.name.endsWith('.jsonl') && !f.name.endsWith('.json'))) continue;
          const full = path.join(emptyDir, f.name);
          if (seenFiles.has(full)) continue;
          seenFiles.add(full);
          let st;
          try {
            st = fs.statSync(full);
            if (!st.isFile() || st.size === 0) continue;
          } catch {
            continue;
          }
          const key = `${st.mtimeMs}|${st.size}|${pKey}`;
          const cached = this.cache.get(full);
          let summary;
          if (cached && cached.key === key) {
            summary = cached.summary;
          } else {
            summary = summarizeVscodeChatFile(full, { folder: '', workspace: '' }, st, opts.pricingOpts);
            this.cache.set(full, { key, summary });
          }
          if (summary) sessions.push(summary);
        }
      }
    }

    sessions.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.updatedAt - a.updatedAt);
    return sessions;
  }

  readDetail(session, pricingOpts) {
    if (!session) return null;
    if (session.source === 'agent') return readAgentDetail(session, pricingOpts);
    if (session.source === 'vscode') return readVscodeDetail(session, pricingOpts);
    return null;
  }
}

/** Check whether a session belongs to the given window scope. */
function sessionMatchesScope(session, scope) {
  if (!scope || scope.mode !== 'window') return true;
  const hasRoots = !!(scope.roots && scope.roots.length);
  if (!hasRoots && !scope.workspaceFile) return true;
  if (session.workspacePath && scope.workspaceFile) {
    if (normalizePath(session.workspacePath) === normalizePath(scope.workspaceFile)) return true;
  }
  if (session.cwd && hasRoots) return matchesRoots(session.cwd, scope.roots);
  return false;
}

function isValidSessionId(rawId) {
  return typeof rawId === 'string' && /^[A-Za-z0-9._-]+$/.test(rawId) && rawId !== '.' && rawId !== '..';
}

function yamlScalar(v) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
  if (/[:#"'{}[\],&*!|>%@`]|^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function writeWorkspaceYaml(file, fields) {
  const ordered = [
    'id',
    'cwd',
    'git_root',
    'repository',
    'host_type',
    'branch',
    'client_name',
    'last_client_name',
    'name',
    'user_named',
    'summary_count',
    'fork_count',
    'created_at',
    'updated_at',
  ];
  const lines = [];
  const seen = new Set();
  for (const k of ordered) {
    if (fields[k] !== undefined && fields[k] !== '') {
      lines.push(`${k}: ${yamlScalar(fields[k])}`);
      seen.add(k);
    }
  }
  for (const [k, v] of Object.entries(fields)) {
    if (!seen.has(k) && v !== undefined && v !== '') {
      lines.push(`${k}: ${yamlScalar(v)}`);
    }
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, lines.join('\n') + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** Detect git root, branch and GitHub owner/repo from `.git` without spawning a subprocess. */
function detectGitInfo(startDir) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const dotGit = path.join(dir, '.git');
    let gitDir = '';
    try {
      const st = fs.statSync(dotGit);
      if (st.isDirectory()) gitDir = dotGit;
      else if (st.isFile()) {
        const ptr = fs.readFileSync(dotGit, 'utf8');
        const m = /^gitdir:\s*(.+)$/im.exec(ptr);
        if (m) gitDir = path.resolve(dir, m[1].trim());
      }
    } catch {
      /* keep walking */
    }
    if (gitDir) {
      let branch = '';
      try {
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        branch = ref ? ref[1].trim() : head.slice(0, 12);
      } catch {
        /* ignore */
      }
      let repository = '';
      let hostType = '';
      try {
        const cfg = fs.readFileSync(path.join(gitDir, 'config'), 'utf8');
        const gh = /github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\s*$/im.exec(cfg);
        if (gh) {
          repository = gh[1];
          hostType = 'github';
        }
      } catch {
        /* ignore */
      }
      return { gitRoot: dir, branch, repository, hostType };
    }
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return { gitRoot: '', branch: '', repository: '', hostType: '' };
}

function copyDirClean(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirClean(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

/**
 * Duplicate an agent session into a new UUID folder, rewriting `sessionId` in
 * `session.start` and stripping live lock files so the fork opens cleanly.
 */
function forkAgentSession(agentRoot, rawId, opts = {}) {
  if (!isValidSessionId(rawId)) return { ok: false, message: 'Invalid session id.' };
  const root = (typeof agentRoot === 'string' && agentRoot.trim()) || defaultRoot();
  const srcDir = path.join(root, rawId);
  const srcEvents = path.join(srcDir, 'events.jsonl');
  if (!fs.existsSync(srcDir) || !fs.existsSync(srcEvents)) {
    return { ok: false, message: 'Session not found.' };
  }

  const newId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const dstDir = path.join(root, newId);
  fs.mkdirSync(dstDir, { recursive: true });

  const nowIso = new Date().toISOString();
  const srcMeta = parseWorkspaceMeta(path.join(srcDir, 'workspace.yaml'));
  const fields = Object.assign({}, srcMeta.fields, {
    id: newId,
    fork_count: '0',
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (opts.targetDir) {
    const git = detectGitInfo(opts.targetDir);
    fields.cwd = opts.targetDir;
    fields.git_root = git.gitRoot;
    fields.repository = git.repository;
    fields.branch = git.branch;
    if (git.hostType) fields.host_type = git.hostType;
  }

  const baseTitle = opts.title || srcMeta.name || '';
  if (baseTitle) {
    fields.name = baseTitle.startsWith('[Fork]') ? baseTitle : `[Fork] ${baseTitle}`;
  }
  writeWorkspaceYaml(path.join(dstDir, 'workspace.yaml'), fields);

  // Copy only complete JSONL lines and update the initial session.start sessionId.
  const buf = fs.readFileSync(srcEvents);
  const lastNl = buf.lastIndexOf(0x0a);
  const rawText = (lastNl === -1 ? buf : buf.subarray(0, lastNl + 1)).toString('utf8');
  const outLines = [];
  let rewroteStart = false;
  for (const line of rawText.split('\n')) {
    if (!line.trim()) continue;
    if (!rewroteStart && line.indexOf('"session.start"') !== -1) {
      try {
        const ev = JSON.parse(line);
        if (ev && ev.type === 'session.start' && ev.data) {
          ev.data.sessionId = newId;
          ev.data.startTime = nowIso;
          if (opts.targetDir && ev.data.context) {
            ev.data.context.cwd = fields.cwd;
            if (fields.git_root) ev.data.context.gitRoot = fields.git_root;
            if (fields.repository) ev.data.context.repository = fields.repository;
            if (fields.branch) ev.data.context.branch = fields.branch;
          }
          outLines.push(JSON.stringify(ev));
          rewroteStart = true;
          continue;
        }
      } catch {
        /* keep original line */
      }
    }
    outLines.push(line);
  }
  fs.writeFileSync(path.join(dstDir, 'events.jsonl'), outLines.join('\n') + (outLines.length ? '\n' : ''), 'utf8');

  for (const sub of ['checkpoints', 'files', 'research']) {
    copyDirClean(path.join(srcDir, sub), path.join(dstDir, sub));
  }

  return { ok: true, id: `agent:${newId}`, rawId: newId, dir: dstDir };
}

/**
 * Reassign an idle agent session to a different workspace/project folder by
 * updating `workspace.yaml` (`cwd`, `git_root`, `repository`, `branch`).
 */
function moveAgentSession(agentRoot, rawId, targetDir) {
  if (!isValidSessionId(rawId)) return { ok: false, message: 'Invalid session id.' };
  const dest = String(targetDir || '').trim();
  if (!dest) return { ok: false, message: 'Target folder is required.' };
  try {
    if (!fs.statSync(dest).isDirectory()) return { ok: false, message: 'Target is not a directory.' };
  } catch {
    return { ok: false, message: 'Target folder does not exist.' };
  }

  const root = (typeof agentRoot === 'string' && agentRoot.trim()) || defaultRoot();
  const dir = path.join(root, rawId);
  if (!fs.existsSync(dir)) return { ok: false, message: 'Session not found.' };
  if (detectInUse(dir)) return { ok: false, message: 'Session is in use by a running process.' };

  const yamlPath = path.join(dir, 'workspace.yaml');
  const meta = parseWorkspaceMeta(yamlPath);
  const git = detectGitInfo(dest);
  const nowIso = new Date().toISOString();
  const fields = Object.assign({}, meta.fields, {
    id: meta.id || rawId,
    cwd: dest,
    git_root: git.gitRoot,
    repository: git.repository,
    branch: git.branch,
    updated_at: nowIso,
  });
  if (git.hostType) fields.host_type = git.hostType;
  else delete fields.host_type;
  if (!fields.created_at) fields.created_at = nowIso;

  writeWorkspaceYaml(yamlPath, fields);
  return { ok: true, id: `agent:${rawId}`, rawId, cwd: dest, repository: git.repository, branch: git.branch };
}

/** Permanently remove an idle agent session directory from disk. */
function deleteAgentSession(agentRoot, rawId) {
  if (!isValidSessionId(rawId)) return { ok: false, message: 'Invalid session id.' };
  const root = (typeof agentRoot === 'string' && agentRoot.trim()) || defaultRoot();
  const dir = path.join(root, rawId);
  if (!fs.existsSync(dir)) return { ok: false, message: 'Session not found.' };
  if (detectInUse(dir)) return { ok: false, message: 'Session is in use by a running process.' };

  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, id: `agent:${rawId}`, rawId };
}

module.exports = {
  SessionHubScanner,
  sessionMatchesScope,
  cleanPromptText,
  replayVscodeChatFile,
  readAgentDetail,
  readVscodeDetail,
  detectGitInfo,
  forkAgentSession,
  moveAgentSession,
  deleteAgentSession,
};
