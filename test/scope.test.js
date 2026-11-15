'use strict';

/**
 * Window scoping: the fix for "a new window shows another window's tok/s".
 * Copilot writes every window's usage records into one shared folder and the
 * records carry no window id, so the session's working directory is the only
 * thing that can attribute them.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scope = require('../src/scope');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
    throw err;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-scope-'));
}

function session(dir, cwd, opts) {
  fs.mkdirSync(dir, { recursive: true });
  if (cwd) fs.writeFileSync(path.join(dir, 'workspace.yaml'), `id: x\ncwd: ${cwd}\nbranch: main\n`, 'utf8');
  const start = {
    type: 'session.start',
    timestamp: '2026-11-13T13:56:32.943Z',
    data: { sessionId: path.basename(dir), context: { cwd: (opts && opts.startCwd) || cwd || '' } },
  };
  fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(start) + '\n', 'utf8');
  return dir;
}

function storage(dir, workspaceJson) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify(workspaceJson), 'utf8');
  return dir;
}

console.log('scope');

test('normalizes separators, trailing slashes and drive-letter case', () => {
  assert.strictEqual(scope.normalizePath('E:\\workspace\\Demo\\'), scope.normalizePath('e:/workspace/demo'));
  assert.strictEqual(scope.normalizePath(''), '');
});

test('decodes VS Code folder URIs', () => {
  assert.strictEqual(scope.normalizePath('file:///e%3A/workspace/demo'), scope.normalizePath('E:\\workspace\\demo'));
});

test('matches a folder and its subfolders, nothing else', () => {
  const roots = ['E:\\workspace\\demo'];
  assert.strictEqual(scope.matchesRoots('e:\\workspace\\demo', roots), true);
  assert.strictEqual(scope.matchesRoots('E:\\workspace\\demo\\src\\app', roots), true);
  assert.strictEqual(scope.matchesRoots('E:\\workspace\\demo-other', roots), false);
  assert.strictEqual(scope.matchesRoots('E:\\workspace\\other', roots), false);
  assert.strictEqual(scope.matchesRoots('', roots), false);
});

test('reads cwd from workspace.yaml and tolerates quotes and CRLF', () => {
  assert.strictEqual(scope.parseWorkspaceYaml('id: a\r\ncwd: "E:\\w\\demo"\r\n'), 'E:\\w\\demo');
  assert.strictEqual(scope.parseWorkspaceYaml("cwd: 'e:/w/demo'"), 'e:/w/demo');
  assert.strictEqual(scope.parseWorkspaceYaml('id: a\nbranch: main\n'), '');
});

test('falls back to the session.start event when workspace.yaml is missing', () => {
  const dir = session(path.join(tmpDir(), 'session-old'), '', { startCwd: 'E:\\workspace\\legacy' });
  assert.strictEqual(scope.sessionCwd(dir), 'E:\\workspace\\legacy');
});

test('an unknown origin is cached briefly, not forever', () => {
  let now = 1000;
  const cache = new scope.DirMetadataCache(() => now);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-scope-empty-'));

  assert.strictEqual(scope.sessionCwd(dir, cache), '');
  // The session folder appears before its workspace.yaml does.
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), 'cwd: E:\\late\n', 'utf8');
  assert.strictEqual(scope.sessionCwd(dir, cache), '', 'a fresh miss is reused');

  now += 15000;
  assert.strictEqual(scope.sessionCwd(dir, cache), 'E:\\late');
});

test('a known origin stays cached', () => {
  let now = 1000;
  const cache = new scope.DirMetadataCache(() => now);
  const dir = session(path.join(tmpDir(), 's1'), 'E:\\workspace\\demo');
  assert.strictEqual(scope.sessionCwd(dir, cache), 'E:\\workspace\\demo');
  now += 600000;
  assert.strictEqual(scope.sessionCwd(dir, cache), 'E:\\workspace\\demo');
});

test('workspaceStorage folders are identified by workspace.json', () => {
  const dir = storage(path.join(tmpDir(), 'hash'), { folder: 'file:///e%3A/workspace/demo' });
  const id = scope.workspaceStorageId(dir);
  assert.strictEqual(scope.normalizePath(id.folder), scope.normalizePath('E:\\workspace\\demo'));
  assert.strictEqual(id.workspace, '');
});

test('filters records to the window, keeping the ones it cannot attribute', () => {
  const scoping = { mode: 'window', roots: ['E:\\workspace\\demo'], workspaceFile: '' };
  const records = [
    { id: 'mine', cwd: 'e:\\workspace\\demo' },
    { id: 'nested', cwd: 'E:\\workspace\\demo\\src' },
    { id: 'other-window', cwd: 'E:\\workspace\\elsewhere' },
    { id: 'unknown', cwd: '' },
  ];
  const kept = scope.filterToWindow(records, scoping).map((r) => r.id);
  assert.deepStrictEqual(kept, ['mine', 'nested', 'unknown']);
});

test('"all" mode disables the filter, and a window without folders keeps everything', () => {
  const records = [{ id: 'a', cwd: 'E:\\a' }, { id: 'b', cwd: 'E:\\b' }];
  assert.strictEqual(scope.filterToWindow(records, { mode: 'all', roots: ['E:\\a'] }).length, 2);
  assert.strictEqual(scope.filterToWindow(records, { mode: 'window', roots: [] }).length, 2);
});

test('a multi-root window is identified by its .code-workspace file', () => {
  // VS Code stores `workspace` instead of `folder` for a saved workspace file,
  // and Copilot then runs sessions in the nested project directories.
  const scoping = {
    mode: 'window',
    roots: ['E:\\workspace\\mono\\app', 'E:\\workspace\\mono\\lib'],
    workspaceFile: 'E:\\workspace\\mono\\mono.code-workspace',
  };
  const records = [
    { id: 'app', cwd: 'E:\\workspace\\mono\\app' },
    { id: 'lib', cwd: 'E:\\workspace\\mono\\lib\\src' },
    { id: 'logged-by-workspace-file', cwd: '', workspacePath: 'e:\\workspace\\mono\\mono.code-workspace' },
    { id: 'other-window', cwd: 'E:\\workspace\\elsewhere' },
    { id: 'other-workspace-file', cwd: '', workspacePath: 'E:\\workspace\\elsewhere\\elsewhere.code-workspace' },
  ];
  const kept = scope.filterToWindow(records, scoping).map((r) => r.id);
  assert.deepStrictEqual(kept, ['app', 'lib', 'logged-by-workspace-file']);
});

test('a folder-less window still narrows records that name a workspace file', () => {
  const scoping = { mode: 'window', roots: [], workspaceFile: 'E:\\w\\only.code-workspace' };
  const records = [
    { id: 'mine', cwd: '', workspacePath: 'E:\\w\\only.code-workspace' },
    { id: 'theirs', cwd: '', workspacePath: 'E:\\w\\other.code-workspace' },
    { id: 'unknown', cwd: '' },
  ];
  const kept = scope.filterToWindow(records, scoping).map((r) => r.id);
  assert.deepStrictEqual(kept, ['mine', 'unknown']);

  // With no folder and no workspace file there is nothing to compare against.
  assert.strictEqual(scope.filterToWindow(records, { mode: 'window', roots: [], workspaceFile: '' }).length, 3);
});

console.log(`\n${passed} scope tests passed`);
