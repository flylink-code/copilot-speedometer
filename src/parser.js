'use strict';

/**
 * Discovery + incremental tailing of the VS Code Copilot Chat debug logs.
 *
 * Layout (VS Code >= 1.13x):
 *   %APPDATA%/Code/User/globalStorage/github.copilot-chat/debug-logs/<sessionId>/main.jsonl
 * Legacy layout (older builds, workspace windows):
 *   %APPDATA%/Code/User/workspaceStorage/<hash>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
 *
 * Every line is a JSON object: { type, ts, dur, attrs }.
 * The events we care about have type === 'llm_request', where `ts` is epoch ms,
 * `dur` is the request duration in ms and `attrs` carries model / inputTokens /
 * outputTokens / cachedTokens / responseId.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { DirMetadataCache, workspaceStorageId } = require('./scope');

const EDITOR_FOLDERS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'Windsurf', 'Trae'];
const DIR_CACHE_MS = 10000;
const MAX_FIRST_READ_BYTES = 8 * 1024 * 1024;

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function editorUserDirs() {
  const home = os.homedir();
  const out = [];
  for (const name of EDITOR_FOLDERS) {
    if (process.platform === 'win32') {
      out.push(path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), name, 'User'));
    } else if (process.platform === 'darwin') {
      out.push(path.join(home, 'Library', 'Application Support', name, 'User'));
    } else {
      out.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), name, 'User'));
    }
  }
  return out;
}

function num(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (isFinite(n)) return n;
  }
  return undefined;
}

function toMs(value) {
  const direct = num(value);
  if (direct !== undefined) {
    // Tolerate second-precision epochs.
    return direct > 1e12 ? direct : direct * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

function eventToRecord(ev, file, cwd, workspacePath) {
  if (!ev || typeof ev !== 'object' || ev.type !== 'llm_request') return null;
  const a = ev.attrs && typeof ev.attrs === 'object' ? ev.attrs : {};

  const ts = toMs(ev.ts) ?? toMs(a.ts) ?? toMs(ev.timestamp);
  const durMs = num(ev.dur) ?? num(ev.durMs) ?? num(a.durMs) ?? num(a.durationMs) ?? num(a.latencyMs);
  const output = num(a.outputTokens) ?? num(a.output_tokens) ?? num(a.completionTokens);
  const input = num(a.inputTokens) ?? num(a.input_tokens) ?? num(a.promptTokens);
  const cached = num(a.cachedTokens) ?? num(a.cached_tokens) ?? num(a.cachedInputTokens);
  const cacheWrite = num(a.cacheWriteTokens) ?? num(a.cacheCreationTokens) ?? num(a.cache_creation_tokens);
  const reasoning = num(a.reasoningTokens) ?? num(a.reasoning_tokens);
  const ttftMs =
    num(a.ttftMs) ?? num(a.timeToFirstTokenMs) ?? num(a.firstTokenMs) ?? num(a.timeToFirstChunkMs);

  if (!(output > 0) || !(durMs > 0) || ts === undefined) return null;

  const model = typeof a.model === 'string' && a.model ? a.model : 'unknown';
  const rate = output / (durMs / 1000);
  const decodeRate =
    ttftMs > 0 && durMs > ttftMs && output > 1 ? (output - 1) / ((durMs - ttftMs) / 1000) : null;

  const responseId = typeof a.responseId === 'string' ? a.responseId : undefined;
  const id = responseId || `${ts}|${model}|${output}|${durMs}`;

  return {
    id,
    ts,
    model,
    input: input || 0,
    output,
    cached: cached || 0,
    cacheWrite: cacheWrite || 0,
    reasoning: reasoning || 0,
    durMs,
    ttftMs: ttftMs > 0 ? ttftMs : null,
    rate,
    decodeRate,
    cwd: cwd || '',
    workspacePath: workspacePath || '',
    file: file || null,
  };
}

function parseEventLine(line, file, cwd, workspacePath) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let ev;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return eventToRecord(ev, file, cwd, workspacePath);
}

class LogScanner {
  constructor(now = () => Date.now()) {
    this.offsets = new Map();
    this.dirCache = null;
    this.dirCacheAt = 0;
    this.dirs = new DirMetadataCache(now);
    this.now = now;
  }

  /**
   * Working directory that produced one `main.jsonl`. The legacy layout nests
   * the file under a `workspaceStorage/<hash>/` folder whose `workspace.json`
   * names either a folder or a saved `.code-workspace` file; the global layout
   * has no such ancestor, so the record stays unattributed instead of guessed.
   */
  origin(file) {
    let dir = path.dirname(file);
    for (let depth = 0; depth < 5; depth += 1) {
      if (fs.existsSync(path.join(dir, 'workspace.json'))) {
        const id = workspaceStorageId(dir, this.dirs);
        return { cwd: id.folder, workspacePath: id.workspace };
      }
      const parent = path.dirname(dir);
      if (!parent || parent === dir) break;
      dir = parent;
    }
    return { cwd: '', workspacePath: '' };
  }

  /** Backwards-compatible shorthand for the folder-based identity. */
  cwdOf(file) {
    return this.origin(file).cwd;
  }

  roots(opts = {}) {
    const custom = typeof opts.logPath === 'string' ? opts.logPath.trim() : '';
    if (custom) return [{ root: custom, legacy: false, editor: 'custom' }];

    const out = [];
    for (const user of editorUserDirs()) {
      const editor = path.basename(path.dirname(user));
      out.push({
        root: path.join(user, 'globalStorage', 'github.copilot-chat', 'debug-logs'),
        legacy: false,
        editor,
      });
      if (opts.legacy !== false) {
        out.push({
          root: path.join(user, 'workspaceStorage'),
          legacy: true,
          editor,
        });
      }
    }
    return out;
  }

  /** Existing roots, for the setup screen. */
  existingRoots(opts = {}) {
    return this.roots(opts).filter((r) => exists(r.root));
  }

  /** List of main.jsonl files, newest first. Result is cached briefly. */
  scan(opts = {}) {
    const now = this.now();
    if (this.dirCache && now - this.dirCacheAt < DIR_CACHE_MS) return this.dirCache;

    const files = [];
    for (const entry of this.roots(opts)) {
      let names;
      try {
        names = fs.readdirSync(entry.root, { withFileTypes: true });
      } catch {
        continue;
      }
      if (!entry.legacy) {
        for (const e of names) {
          const p = path.join(entry.root, e.name);
          if (e.isFile() && e.name === 'main.jsonl') files.push(p);
          else if (e.isDirectory()) {
            const f = path.join(p, 'main.jsonl');
            if (exists(f)) files.push(f);
          }
        }
      } else {
        for (const e of names) {
          if (!e.isDirectory()) continue;
          const base = path.join(entry.root, e.name, 'GitHub.copilot-chat', 'debug-logs');
          if (!exists(base)) continue;
          let inner;
          try {
            inner = fs.readdirSync(base, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const s of inner) {
            const f = path.join(base, s.name, 'main.jsonl');
            if (s.isDirectory() && exists(f)) files.push(f);
          }
        }
      }
    }

    const unique = [...new Set(files)];
    const backfillDays = Number(opts.backfillDays ?? 2);
    const cutoff = now - backfillDays * 86400000;
    const listed = [];
    for (const f of unique) {
      let st;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      if (backfillDays > 0 && st.mtimeMs < cutoff && !this.offsets.has(f)) continue;
      const where = this.origin(f);
      listed.push({ file: f, size: st.size, mtimeMs: st.mtimeMs, cwd: where.cwd, workspacePath: where.workspacePath });
    }
    listed.sort((a, b) => b.mtimeMs - a.mtimeMs);

    this.dirCache = listed;
    this.dirCacheAt = now;
    return listed;
  }

  /**
   * Read bytes appended since the last call and return complete lines.
   * A trailing partial line is left for the next call. On the first read of a
   * huge file we start near the end; the first (partial) line is then dropped
   * by the JSON parse.
   */
  readNew(file) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return [];
    }

    let offset = this.offsets.get(file);
    if (offset === undefined) {
      offset = st.size > MAX_FIRST_READ_BYTES ? st.size - MAX_FIRST_READ_BYTES : 0;
    }
    if (st.size < offset) offset = 0; // truncated or replaced
    if (st.size === offset) {
      this.offsets.set(file, offset);
      return [];
    }

    let fd;
    let buf;
    try {
      fd = fs.openSync(file, 'r');
      // If the byte before our offset is not a newline, the file was rewritten
      // rather than appended to, so the offset is meaningless: start over.
      if (offset > 0 && offset < st.size) {
        const probe = Buffer.alloc(1);
        fs.readSync(fd, probe, 0, 1, offset - 1);
        if (probe[0] !== 0x0a) offset = 0;
      }
      const length = st.size - offset;
      if (length <= 0) {
        this.offsets.set(file, offset);
        return [];
      }
      buf = Buffer.allocUnsafe(length);
      fs.readSync(fd, buf, 0, length, offset);
    } catch {
      return [];
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }

    const lastNewline = buf.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      this.offsets.set(file, offset);
      return [];
    }
    const chunk = buf.subarray(0, lastNewline + 1).toString('utf8');
    this.offsets.set(file, offset + lastNewline + 1);

    return chunk.split('\n').filter((l) => l.trim().length > 0);
  }
}

module.exports = {
  LogScanner,
  parseEventLine,
  eventToRecord,
  editorUserDirs,
  EDITOR_FOLDERS,
};
