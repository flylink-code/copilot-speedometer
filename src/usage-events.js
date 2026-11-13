'use strict';

/**
 * Second data source: the Copilot agent session store.
 *
 *   %USERPROFILE%/.copilot/session-state/<sessionId>/events.jsonl
 *
 * Every line is an event, and the interesting ones look like:
 *
 *   {"type":"session.usage_record",
 *    "data":{"usage":{"model":"magpie/gpt/gpt-6.1-sol",
 *                     "modelDisplayName":"GPT-6.1 Sol · gpt",
 *                     "inputTokens":369518,"outputTokens":75,"cacheReadTokens":0,
 *                     "reasoningTokens":41,"duration":41471,
 *                     "timeToFirstTokenMs":41435,"interTokenLatencyMs":1.2,
 *                     "isByok":true,"byokKind":"local_user","providerType":"openai",
 *                     "apiEndpoint":"/responses"}},
 *    "timestamp":"2026-11-13T07:44:58.298Z"}
 *
 * This is the only source that reports BYOK (custom-endpoint) models together
 * with TTFT, and it is plain JSONL, so no SQLite access is required.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR_CACHE_MS = 10000;
const MAX_FIRST_READ_BYTES = 8 * 1024 * 1024;

function defaultRoot() {
  return path.join(os.homedir(), '.copilot', 'session-state');
}

function num(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (isFinite(n)) return n;
  }
  return undefined;
}

function usageToRecord(ev, file) {
  if (!ev || typeof ev !== 'object' || ev.type !== 'session.usage_record') return null;
  const u = ev.data && typeof ev.data === 'object' ? ev.data.usage : null;
  if (!u || typeof u !== 'object') return null;

  const output = num(u.outputTokens);
  const durMs = num(u.duration) !== undefined ? num(u.duration) : num(u.durationMs);
  const ts = Date.parse(ev.timestamp);
  if (!(output > 0) || !(durMs > 0) || isNaN(ts)) return null;

  const ttftMs = num(u.timeToFirstTokenMs) !== undefined ? num(u.timeToFirstTokenMs) : num(u.outputTtftMs) || 0;
  const rawModel = typeof u.model === 'string' && u.model ? u.model : 'unknown';
  const model = typeof u.modelDisplayName === 'string' && u.modelDisplayName ? u.modelDisplayName : rawModel;

  // Only report a decode rate when the request actually spent measurable time
  // generating: non-streaming endpoints deliver everything in the first chunk,
  // which makes duration - ttft ~ 0 and the number meaningless. 500 ms is the
  // point below which a "tokens per second" figure is just rounding noise.
  const genMs = ttftMs > 0 && durMs > ttftMs ? durMs - ttftMs : 0;
  let decodeRate = genMs >= 500 && output > 1 ? (output - 1) / (genMs / 1000) : null;
  if (decodeRate && decodeRate > 3000) decodeRate = null; // measurement artefact, not a real speed

  const apiCallId = typeof u.apiCallId === 'string' ? u.apiCallId : undefined;

  return {
    id: apiCallId || `${ts}|${rawModel}|${output}|${durMs}`,
    ts,
    model,
    rawModel,
    input: num(u.inputTokens) || 0,
    output,
    cached: num(u.cacheReadTokens) || 0,
    durMs,
    ttftMs: ttftMs > 0 ? ttftMs : null,
    rate: output / (durMs / 1000),
    decodeRate,
    source: 'usage',
    byok: !!u.isByok,
    provider:
      typeof u.providerType === 'string' ? u.providerType : typeof u.modelProvider === 'string' ? u.modelProvider : null,
    file: file || null,
  };
}

function parseUsageLine(line, file) {
  const trimmed = line.trim();
  // Cheap pre-filter: the file also holds prompts, tool output and response text.
  if (!trimmed || trimmed.indexOf('session.usage_record') === -1) return null;
  let ev;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return usageToRecord(ev, file);
}

class UsageScanner {
  constructor(now = () => Date.now()) {
    this.offsets = new Map();
    this.dirCache = null;
    this.dirCacheAt = 0;
    this.now = now;
  }

  root(opts = {}) {
    const custom = typeof opts.root === 'string' ? opts.root.trim() : '';
    return custom || defaultRoot();
  }

  existingRoots(opts = {}) {
    const root = this.root(opts);
    try {
      fs.accessSync(root);
      return [root];
    } catch {
      return [];
    }
  }

  /** List events.jsonl files, newest first. Cached briefly, per backfill window. */
  scan(opts = {}) {
    const now = this.now();
    const windowKey = String(opts.backfillDays ?? 2);
    if (this.dirCache && this.dirCacheKey === windowKey && now - this.dirCacheAt < DIR_CACHE_MS) {
      return this.dirCache;
    }

    const base = this.root(opts);
    const files = [];
    let names;
    try {
      names = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      this.dirCache = [];
      this.dirCacheKey = windowKey;
      this.dirCacheAt = now;
      return this.dirCache;
    }

    for (const e of names) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const f = path.join(base, e.name, 'events.jsonl');
      try {
        if (fs.statSync(f).isFile()) files.push(f);
      } catch {
        /* not every session writes events */
      }
    }

    const backfillDays = Number(opts.backfillDays ?? 2);
    const cutoff = now - backfillDays * 86400000;
    const listed = [];
    for (const f of files) {
      let st;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      if (backfillDays > 0 && st.mtimeMs < cutoff && !this.offsets.has(f)) continue;
      listed.push({ file: f, size: st.size, mtimeMs: st.mtimeMs });
    }
    listed.sort((a, b) => b.mtimeMs - a.mtimeMs);

    this.dirCache = listed;
    this.dirCacheKey = windowKey;
    this.dirCacheAt = now;
    return listed;
  }

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
    if (st.size < offset) offset = 0;
    if (st.size === offset) {
      this.offsets.set(file, offset);
      return [];
    }

    let fd;
    let buf;
    try {
      fd = fs.openSync(file, 'r');
      if (offset > 0 && offset < st.size) {
        const probe = Buffer.alloc(1);
        fs.readSync(fd, probe, 0, 1, offset - 1);
        if (probe[0] !== 0x0a) offset = 0; // rewritten, not appended to
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

module.exports = { UsageScanner, usageToRecord, parseUsageLine, defaultRoot };
