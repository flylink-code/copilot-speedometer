'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SessionHubScanner,
  sessionMatchesScope,
  cleanPromptText,
  detectGitInfo,
  forkAgentSession,
  moveAgentSession,
  deleteAgentSession,
} = require('../src/sessions');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-sess-'));
}

console.log('sessions');

test('cleanPromptText strips injected context tags and falls back to IDE selection file', () => {
  assert.strictEqual(
    cleanPromptText('<system_reminder>secret</system_reminder>\nExplain scope.js'),
    'Explain scope.js'
  );
  assert.strictEqual(
    cleanPromptText('<ide_selection>\nFile: task.md (lines 1-3)\n```\nhi\n```\n</ide_selection>'),
    'File: task.md (lines 1-3)'
  );
});

test('scans agent sessions, checks live pids, computes tokens and cost, and caches by mtime/size', () => {
  const root = tmpDir();
  const s1 = path.join(root, 'sess-1');
  const s2 = path.join(root, 'sess-2');
  fs.mkdirSync(s1, { recursive: true });
  fs.mkdirSync(s2, { recursive: true });

  fs.writeFileSync(
    path.join(s1, 'workspace.yaml'),
    'id: sess-1\ncwd: E:\\workspace\\alpha\nrepository: org/alpha\nbranch: main\n',
    'utf8'
  );
  // Current test PID is alive; 999999 is stale/dead.
  fs.writeFileSync(path.join(s1, `inuse.${process.pid}.lock`), String(process.pid), 'utf8');
  fs.writeFileSync(path.join(s2, 'inuse.999999.lock'), '999999', 'utf8');

  const events1 = [
    { type: 'session.start', timestamp: '2026-11-14T10:00:00.000Z', data: { selectedModel: 'gpt-6.1-sol', context: { cwd: 'E:\\workspace\\alpha' } } },
    { type: 'user.message', timestamp: '2026-11-14T10:00:01.000Z', data: { content: '<current_datetime>now</current_datetime>Add cost table' } },
    { type: 'assistant.message', timestamp: '2026-11-14T10:00:03.000Z', data: { model: 'gpt-6.1-sol', content: '', toolRequests: [{ name: 'view' }, { name: 'edit' }] } },
    { type: 'assistant.message', timestamp: '2026-11-14T10:00:05.000Z', data: { model: 'gpt-6.1-sol', content: 'Done adding cost table.' } },
    {
      type: 'session.usage_record',
      timestamp: '2026-11-14T10:00:05.200Z',
      data: { usage: { model: 'gpt-6.1-sol', inputTokens: 100000, outputTokens: 1000, cacheReadTokens: 0, duration: 2000 } },
    },
  ];
  fs.writeFileSync(path.join(s1, 'events.jsonl'), events1.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

  fs.writeFileSync(path.join(s2, 'workspace.yaml'), 'id: sess-2\ncwd: E:\\workspace\\beta\nbranch: dev\n', 'utf8');
  fs.writeFileSync(
    path.join(s2, 'events.jsonl'),
    JSON.stringify({ type: 'user.message', timestamp: '2026-11-14T09:00:00.000Z', data: { content: 'Inspect beta' } }) + '\n',
    'utf8'
  );

  const hub = new SessionHubScanner({ editorUserDirs: () => [] });
  const list = hub.scan({ usageEventsRoot: root, includeVscodeChats: false, pricingOpts: { multiplier: 1 } });

  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].rawId, 'sess-1');
  assert.strictEqual(list[0].active, true);
  assert.strictEqual(list[0].title, 'Add cost table');
  assert.strictEqual(list[0].reqCount, 1);
  assert.strictEqual(list[0].output, 1000);
  // gpt-6.1-sol: 0.1M * $2 + 0.001M * $10 = $0.21
  assert.ok(Math.abs(list[0].costUsd - 0.21) < 1e-9);
  assert.strictEqual(list[1].active, false);

  const detail = hub.readDetail(list[0], { multiplier: 1 });
  assert.strictEqual(detail.turns.length, 3);
  assert.strictEqual(detail.turns[0].role, 'user');
  assert.strictEqual(detail.turns[1].role, 'tools');
  assert.strictEqual(detail.turns[1].tools.length, 2);
  assert.strictEqual(detail.turns[2].role, 'assistant');
  assert.ok(detail.turns[2].usage && detail.turns[2].usage.output === 1000);

  // Scope matching
  assert.strictEqual(sessionMatchesScope(list[0], { mode: 'window', roots: ['E:\\workspace\\alpha'], workspaceFile: '' }), true);
  assert.strictEqual(sessionMatchesScope(list[1], { mode: 'window', roots: ['E:\\workspace\\alpha'], workspaceFile: '' }), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('replays VS Code delta chatSessions JSONL and reads conversation turns', () => {
  const userDir = tmpDir();
  const hashDir = path.join(userDir, 'workspaceStorage', 'abc123');
  const chatDir = path.join(hashDir, 'chatSessions');
  fs.mkdirSync(chatDir, { recursive: true });
  fs.writeFileSync(path.join(hashDir, 'workspace.json'), JSON.stringify({ folder: 'file:///e%3A/workspace/demo' }), 'utf8');

  const lines = [
    {
      kind: 0,
      v: {
        version: 3,
        creationDate: 1790000000000,
        sessionId: 'chat-1',
        requests: [{ requestId: 'r0', timestamp: 1790000001000, message: { text: 'How fast is this?' }, response: [] }],
        inputState: { selectedModel: { identifier: 'gpt-4o' } },
      },
    },
    { kind: 1, k: ['customTitle'], v: 'Speed check' },
    { kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'Pretty fast.' }] },
    { kind: 1, k: ['requests', 0, 'promptTokens'], v: 2000 },
    { kind: 1, k: ['requests', 0, 'completionTokens'], v: 500 },
    { kind: 1, k: ['requests', 0, 'elapsedMs'], v: 2000 },
  ];
  fs.writeFileSync(path.join(chatDir, 'chat-1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const hub = new SessionHubScanner({ editorUserDirs: () => [userDir] });
  const list = hub.scan({ usageEventsRoot: path.join(userDir, 'empty-agent'), includeVscodeChats: true });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].source, 'vscode');
  assert.strictEqual(list[0].title, 'Speed check');
  assert.strictEqual(list[0].project, 'demo');
  assert.strictEqual(list[0].output, 500);
  assert.ok(list[0].costUsd > 0);

  const det = hub.readDetail(list[0], { multiplier: 1 });
  assert.strictEqual(det.turns.length, 2);
  assert.strictEqual(det.turns[0].text, 'How fast is this?');
  assert.strictEqual(det.turns[1].text, 'Pretty fast.');

  fs.rmSync(userDir, { recursive: true, force: true });
});

test('forkAgentSession, moveAgentSession, and deleteAgentSession manage agent dirs safely', () => {
  const root = tmpDir();
  const s1 = path.join(root, 'sess-orig');
  const projA = path.join(root, 'proj-a');
  const projB = path.join(root, 'proj-b');
  fs.mkdirSync(path.join(s1, 'files'), { recursive: true });
  fs.mkdirSync(projA, { recursive: true });
  fs.mkdirSync(path.join(projB, '.git'), { recursive: true });
  fs.writeFileSync(path.join(projB, '.git', 'HEAD'), 'ref: refs/heads/feat/test\n', 'utf8');
  fs.writeFileSync(
    path.join(projB, '.git', 'config'),
    '[remote "origin"]\n\turl = https://github.com/acme/widget.git\n',
    'utf8'
  );

  fs.writeFileSync(path.join(s1, 'workspace.yaml'), `id: sess-orig\ncwd: ${projA}\nname: Original task\n`, 'utf8');
  fs.writeFileSync(path.join(s1, 'files', 'note.txt'), 'keep me', 'utf8');
  fs.writeFileSync(path.join(s1, `inuse.${process.pid}.lock`), String(process.pid), 'utf8');
  fs.writeFileSync(
    path.join(s1, 'events.jsonl'),
    [
      JSON.stringify({ type: 'session.start', timestamp: '2026-11-14T10:00:00.000Z', data: { sessionId: 'sess-orig', context: { cwd: projA } } }),
      JSON.stringify({ type: 'user.message', timestamp: '2026-11-14T10:00:01.000Z', data: { content: 'Hello' } }),
    ].join('\n') + '\n',
    'utf8'
  );

  // Active lock blocks move & delete, while fork still succeeds cleanly without copying locks.
  assert.strictEqual(moveAgentSession(root, 'sess-orig', projB).ok, false);
  assert.strictEqual(deleteAgentSession(root, 'sess-orig').ok, false);

  const forked = forkAgentSession(root, 'sess-orig', { title: 'Original task' });
  assert.strictEqual(forked.ok, true);
  assert.ok(fs.existsSync(path.join(forked.dir, 'files', 'note.txt')));
  assert.strictEqual(fs.existsSync(path.join(forked.dir, `inuse.${process.pid}.lock`)), false);
  const firstEv = JSON.parse(fs.readFileSync(path.join(forked.dir, 'events.jsonl'), 'utf8').split('\n')[0]);
  assert.strictEqual(firstEv.data.sessionId, forked.rawId);

  // Remove live lock and test move -> git detection -> delete.
  fs.unlinkSync(path.join(s1, `inuse.${process.pid}.lock`));
  const git = detectGitInfo(projB);
  assert.strictEqual(git.branch, 'feat/test');
  assert.strictEqual(git.repository, 'acme/widget');

  const moved = moveAgentSession(root, 'sess-orig', projB);
  assert.strictEqual(moved.ok, true);
  assert.strictEqual(moved.repository, 'acme/widget');
  assert.strictEqual(moved.branch, 'feat/test');

  const hub = new SessionHubScanner({ editorUserDirs: () => [] });
  const scanned = hub.scan({ usageEventsRoot: root, includeVscodeChats: false });
  const orig = scanned.find((s) => s.rawId === 'sess-orig');
  const clone = scanned.find((s) => s.rawId === forked.rawId);
  assert.ok(orig && clone);
  assert.strictEqual(orig.repository, 'acme/widget');
  assert.strictEqual(clone.title, '[Fork] Original task');

  const del = deleteAgentSession(root, forked.rawId);
  assert.strictEqual(del.ok, true);
  assert.strictEqual(fs.existsSync(forked.dir), false);

  fs.rmSync(root, { recursive: true, force: true });
});

console.log(`\n${passed} sessions tests passed`);
