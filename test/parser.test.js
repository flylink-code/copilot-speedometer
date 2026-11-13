'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LogScanner, eventToRecord, parseEventLine } = require('../src/parser');
const { summarize, groupByModel, fmtRate, fmtTokens, fmtDur } = require('../src/stats');

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

function ev(attrs, overrides) {
  return Object.assign({ type: 'llm_request', ts: 1763000000000, dur: 2000, attrs }, overrides || {});
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-test-'));
}

console.log('parser');

test('computes tok/s from outputTokens and dur', () => {
  const rec = eventToRecord(
    ev({ model: 'gpt-test', inputTokens: 100, outputTokens: 250, cachedTokens: 40, responseId: 'r1' }),
    'f.jsonl'
  );
  assert.strictEqual(rec.id, 'r1');
  assert.strictEqual(rec.model, 'gpt-test');
  assert.strictEqual(rec.output, 250);
  assert.strictEqual(rec.input, 100);
  assert.strictEqual(rec.cached, 40);
  assert.strictEqual(rec.durMs, 2000);
  assert.strictEqual(rec.rate, 125); // 250 tokens / 2s
  assert.strictEqual(rec.decodeRate, null); // no ttft in the log
});

test('computes decode rate when ttft is present', () => {
  const rec = eventToRecord(ev({ outputTokens: 200, ttftMs: 500 }), null);
  assert.strictEqual(rec.durMs, 2000);
  assert.strictEqual(rec.rate, 100);
  assert.strictEqual(rec.decodeRate, 199 / 1.5);
});

test('handles snake_case and second-precision timestamps', () => {
  const rec = eventToRecord(
    { type: 'llm_request', ts: 1763000000, dur: 1000, attrs: { output_tokens: 50, input_tokens: 10 } },
    null
  );
  assert.strictEqual(rec.ts, 1763000000000);
  assert.strictEqual(rec.rate, 50);
});

test('ignores non llm_request events and unusable requests', () => {
  assert.strictEqual(eventToRecord({ type: 'session_start', ts: 1, attrs: {} }, null), null);
  assert.strictEqual(eventToRecord({ type: 'user_message', ts: 1, attrs: { content: 'hi' } }, null), null);
  assert.strictEqual(eventToRecord(ev({ outputTokens: 0 }), null), null);
  assert.strictEqual(eventToRecord(ev({ outputTokens: 12 }, { dur: 0 }), null), null);
  assert.strictEqual(parseEventLine('{"broken":', null), null);
  assert.strictEqual(parseEventLine('', null), null);
});

test('falls back to a composite id when responseId is missing', () => {
  const rec = eventToRecord(ev({ outputTokens: 10 }), null);
  assert.strictEqual(rec.id, '1763000000000|unknown|10|2000');
});

console.log('scanner');

test('discovers a session folder and tails complete lines only', () => {
  const root = tmpDir();
  const session = path.join(root, 'debug-logs', 'abc123');
  fs.mkdirSync(session, { recursive: true });
  const file = path.join(session, 'main.jsonl');
  const l1 = JSON.stringify({ type: 'session_start', ts: 1763000000000, attrs: { vscodeVersion: '1.130.0' } });
  const l2 = JSON.stringify(ev({ outputTokens: 300, responseId: 'a' }));
  const partial = '{"type":"llm_request","ts":1763000001';
  fs.writeFileSync(file, [l1, l2].join('\n') + '\n' + partial, 'utf8');

  const scanner = new LogScanner(() => Date.now());
  const files = scanner.scan({ logPath: path.join(root, 'debug-logs'), legacy: false, backfillDays: 5 });
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].file, file);

  const first = scanner.readNew(files[0].file);
  assert.strictEqual(first.length, 2, 'partial line must not be returned');
  const recs = first.map((l) => parseEventLine(l, file)).filter(Boolean);
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].output, 300);
  assert.strictEqual(recs[0].rate, 150);

  // Finish the partial line: only the new bytes come back.
  fs.appendFileSync(file, '000,"dur":1000,"attrs":{"outputTokens":40,"responseId":"b"}}\n', 'utf8');
  const second = scanner.readNew(file).map((l) => parseEventLine(l, file)).filter(Boolean);
  assert.strictEqual(second.length, 1);
  assert.strictEqual(second[0].output, 40);
  assert.strictEqual(second[0].rate, 40);

  // Nothing new -> nothing returned.
  assert.deepStrictEqual(scanner.readNew(file), []);
});

test('rescans from the top when the log is truncated', () => {
  const root = tmpDir();
  const file = path.join(root, 'main.jsonl');
  fs.writeFileSync(file, JSON.stringify(ev({ outputTokens: 100 })) + '\n', 'utf8');
  const scanner = new LogScanner();
  assert.strictEqual(scanner.readNew(file).length, 1);
  fs.writeFileSync(file, JSON.stringify(ev({ outputTokens: 7, responseId: 'z' })) + '\n', 'utf8');
  const after = scanner.readNew(file).map((l) => parseEventLine(l, file)).filter(Boolean);
  assert.strictEqual(after.length, 1);
  assert.strictEqual(after[0].output, 7);
});

test('legacy workspaceStorage layout is discovered', () => {
  const root = tmpDir();
  const dir = path.join(root, 'workspaceStorage', 'deadbeef', 'GitHub.copilot-chat', 'debug-logs', 's1');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'main.jsonl');
  fs.writeFileSync(file, JSON.stringify(ev({ outputTokens: 5 })) + '\n', 'utf8');

  // Point the scanner at a fake workspaceStorage root by nesting it under a
  // custom log path that contains the legacy folder name.
  const scanner = new LogScanner();
  const original = scanner.roots.bind(scanner);
  scanner.roots = () => [{ root: path.join(root, 'workspaceStorage'), legacy: true, editor: 'test' }];
  const files = scanner.scan({ legacy: true, backfillDays: 5 });
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].file, file);
  scanner.roots = original;
});

console.log('stats');

test('weighted average is sum(output)/sum(duration), not mean of rates', () => {
  const a = eventToRecord(ev({ outputTokens: 1000 }, { ts: 1, dur: 10000 }), null); // 100 tok/s
  const b = eventToRecord(ev({ outputTokens: 10 }, { ts: 2, dur: 1000 }), null); // 10 tok/s
  const s = summarize([a, b]);
  assert.strictEqual(s.count, 2);
  assert.strictEqual(s.output, 1010);
  assert.strictEqual(s.durMs, 11000);
  assert.ok(Math.abs(s.rate - 1010 / 11) < 1e-9);
  assert.strictEqual(s.medianRate, 55);
  assert.strictEqual(s.decodeRate, null);
});

test('empty summary is safe', () => {
  const s = summarize([]);
  assert.strictEqual(s.count, 0);
  assert.strictEqual(s.rate, null);
});

test('groups by model and sorts by request count', () => {
  const rows = groupByModel([
    eventToRecord(ev({ model: 'b', outputTokens: 10 }, { ts: 1 }), null),
    eventToRecord(ev({ model: 'a', outputTokens: 20 }, { ts: 2 }), null),
    eventToRecord(ev({ model: 'a', outputTokens: 30 }, { ts: 3 }), null),
  ]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].model, 'a');
  assert.strictEqual(rows[0].count, 2);
});

test('formatters degrade gracefully', () => {
  assert.strictEqual(fmtRate(null), '--');
  assert.strictEqual(fmtRate(125.4), '125');
  assert.strictEqual(fmtRate(12.34), '12.3');
  assert.strictEqual(fmtRate(1.234), '1.23');
  assert.strictEqual(fmtTokens(1234), '1.2k');
  assert.strictEqual(fmtTokens(1500000), '1.50M');
  assert.strictEqual(fmtDur(950), '950 ms');
  assert.strictEqual(fmtDur(2500), '2.50 s');
});

console.log(`\n${passed} tests passed`);
