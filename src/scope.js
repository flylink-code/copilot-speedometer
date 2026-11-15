'use strict';

/**
 * Which Copilot sessions belong to *this* VS Code window.
 *
 * The usage records are global: every window writes into
 * `~/.copilot/session-state/<sessionId>/`, and a record carries no window id.
 * The reliable signal is the session's working directory, written next to the
 * events:
 *
 *   <sessionDir>/workspace.yaml   ->  `cwd: E:\workspace\some-project`
 *   <sessionDir>/events.jsonl     ->  first `session.start` event,
 *                                     `data.context.cwd` (older sessions)
 *
 * Same idea for the legacy debug-log layout, where each
 * `workspaceStorage/<hash>/` folder names its workspace in `workspace.json`.
 * Comparing those paths with `vscode.workspace.workspaceFolders` is what makes
 * the status bar show this window's conversation instead of whichever window
 * happened to talk to Copilot last.
 */

const fs = require('fs');
const path = require('path');

const MISS_TTL_MS = 10000;
const MAX_HEAD_BYTES = 256 * 1024;

function caseInsensitive() {
  return process.platform === 'win32' || process.platform === 'darwin';
}

function fileUriToPath(uri) {
  const raw = String(uri || '');
  if (!/^file:/i.test(raw)) return '';
  let p = raw.replace(/^file:\/\//i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep the raw text */
  }
  if (/^\/[a-z]:/i.test(p)) p = p.slice(1); // /e:/workspace -> e:/workspace
  return p;
}

/** Comparable form of a path: forward slashes, no trailing slash, same case. */
function normalizePath(value) {
  if (!value) return '';
  let s = String(value).trim().replace(/\\/g, '/');
  if (/^file:\/\//i.test(s)) s = fileUriToPath(s).replace(/\\/g, '/');
  s = s.replace(/\/+$/, '');
  if (caseInsensitive()) s = s.toLowerCase();
  return s;
}

function isSameOrInside(child, parent) {
  if (!child || !parent) return false;
  return child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`);
}

/**
 * True when `cwd` is one of the window folders, or lives below one of them: a
 * multi-root workspace file can list a parent folder while Copilot runs the
 * session in the nested project directory.
 */
function matchesRoots(cwd, roots) {
  const target = normalizePath(cwd);
  if (!target) return false;
  for (const root of roots || []) {
    const dir = normalizePath(root);
    if (dir && isSameOrInside(target, dir)) return true;
  }
  return false;
}

function unquote(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1);
  return s;
}

/** `workspace.yaml` is small and flat; only `cwd:` matters here. */
function parseWorkspaceYaml(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^cwd:\s*(.*)$/.exec(line.trim());
    if (match) return unquote(match[1]);
  }
  return '';
}

/** Fallback for sessions written before `workspace.yaml` existed. */
function readHeadCwd(file) {
  let fd;
  try {
    const st = fs.statSync(file);
    if (!st.size) return '';
    const length = Math.min(st.size, MAX_HEAD_BYTES);
    fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, 0);
    return startEventCwd(buf.toString('utf8'));
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

function startEventCwd(text) {
  const at = text.indexOf('"session.start"');
  if (at === -1) return '';
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  const line = text.slice(start, end === -1 ? undefined : end).trim();
  if (!line) return '';
  try {
    const ev = JSON.parse(line);
    const cwd = ev && ev.data && ev.data.context ? ev.data.context.cwd : '';
    return typeof cwd === 'string' ? cwd : '';
  } catch {
    return '';
  }
}

/**
 * Cached directory metadata (session cwd, workspaceStorage identity). It is read
 * on every poll, and a miss is kept only briefly: a session folder appears a
 * moment before its `workspace.yaml` does, and a permanent "unknown" would keep
 * its records unattributed for the rest of the window's life.
 */
class DirMetadataCache {
  constructor(now = () => Date.now()) {
    this.entries = new Map();
    this.now = now;
  }

  get(dir) {
    const hit = this.entries.get(dir);
    if (!hit) return null;
    if (hit.cwd || hit.workspace) return hit;
    return this.now() - hit.at < MISS_TTL_MS ? hit : null;
  }

  set(dir, value) {
    const entry = Object.assign({ at: this.now(), cwd: '', workspace: '' }, value);
    this.entries.set(dir, entry);
    return entry;
  }

  clear() {
    this.entries.clear();
  }
}

/** `workspace.json` of a `workspaceStorage/<hash>` folder, decoded to paths. */
function parseWorkspaceJson(json) {
  if (!json || typeof json !== 'object') return { folder: '', workspace: '' };
  return {
    folder: typeof json.folder === 'string' ? fileUriToPath(json.folder) : '',
    workspace: typeof json.workspace === 'string' ? fileUriToPath(json.workspace) : '',
  };
}

/** Working directory of one usage-record session folder. */
function sessionCwd(sessionDir, cache) {
  if (cache) {
    const hit = cache.get(sessionDir);
    if (hit) return hit.cwd;
  }
  let cwd = '';
  try {
    cwd = parseWorkspaceYaml(fs.readFileSync(path.join(sessionDir, 'workspace.yaml'), 'utf8'));
  } catch {
    cwd = '';
  }
  if (!cwd) cwd = readHeadCwd(path.join(sessionDir, 'events.jsonl'));
  if (cache) cache.set(sessionDir, { cwd });
  return cwd;
}

/** Identity of one `workspaceStorage/<hash>` folder (the debug-log layout). */
function workspaceStorageId(hashDir, cache) {
  if (cache) {
    const hit = cache.get(hashDir);
    if (hit) return { folder: hit.cwd, workspace: hit.workspace };
  }
  let parsed = { folder: '', workspace: '' };
  try {
    parsed = parseWorkspaceJson(JSON.parse(fs.readFileSync(path.join(hashDir, 'workspace.json'), 'utf8')));
  } catch {
    parsed = { folder: '', workspace: '' };
  }
  if (cache) cache.set(hashDir, { cwd: parsed.folder, workspace: parsed.workspace });
  return parsed;
}

/**
 * Does one captured request belong to the window described by `scope`?
 *
 * Kept unless there is positive evidence that it came from elsewhere: dropping
 * what cannot be attributed would make the panel mysteriously empty, and a
 * window with nothing open has no anchor to compare against at all.
 */
function recordInWindow(record, scope) {
  if (!scope || scope.mode !== 'window') return true;
  const hasRoots = !!(scope.roots && scope.roots.length);
  const hasWorkspaceFile = !!scope.workspaceFile;
  if (!hasRoots && !hasWorkspaceFile) return true;
  if (!record) return true;

  // Debug logs of a multi-root window name their `.code-workspace` file instead
  // of a folder, so that is the identity to compare for those records.
  if (record.workspacePath && hasWorkspaceFile) {
    if (normalizePath(record.workspacePath) === normalizePath(scope.workspaceFile)) return true;
  }

  if (record.cwd && hasRoots) return matchesRoots(record.cwd, scope.roots);

  // A workspace file that is not this window's is evidence of another window.
  if (record.workspacePath && hasWorkspaceFile) return false;
  return true;
}

function filterToWindow(records, scope) {
  if (!scope || scope.mode !== 'window') return records.slice();
  return records.filter((r) => recordInWindow(r, scope));
}

module.exports = {
  normalizePath,
  fileUriToPath,
  matchesRoots,
  parseWorkspaceYaml,
  parseWorkspaceJson,
  readHeadCwd,
  startEventCwd,
  sessionCwd,
  workspaceStorageId,
  recordInWindow,
  filterToWindow,
  DirMetadataCache,
};
