'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { UsageScanner, usageToRecord, parseUsageLine } = require('../src/usage-events');

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

function usage(overrides) {
  return {
    type: 'session.usage_record',
    timestamp: '2026-11-13T07:44:58.298Z',
    data: {
      usage: Object.assign(
        {
          model: 'magpie/gpt/gpt-6.1-sol',
          modelDisplayName: 'GPT-6.1 Sol \u00b7 gpt',
          inputTokens: 1200,
          outputTokens: 400,
          cacheReadTokens: 300,
          duration: 4000,
          timeToFirstTokenMs: 1000,
          interTokenLatencyMs: 4,
          isByok: true,
          byokKind: 'local_user',
          providerType: 'openai',
          apiCallId: 'resp_byok_1',
        },
        overrides || {}
      ),
    },
  };
}

console.log('usage events');

test('maps a BYOK usage record to a request record', () => {
  const rec = usageToRecord(usage(), 'events.jsonl');
  assert.strictEqual(rec.id, 'resp_byok_1');
  assert.strictEqual(rec.model, 'GPT-6.1 Sol \u00b7 gpt');
  assert.strictEqual(rec.rawModel, 'magpie/gpt/gpt-6.1-sol');
  assert.strictEqual(rec.output, 400);
  assert.strictEqual(rec.input, 1200);
  assert.strictEqual(rec.cached, 300);
  assert.strictEqual(rec.durMs, 4000);
  assert.strictEqual(rec.ttftMs, 1000);
  assert.strictEqual(rec.rate, 100);
  assert.strictEqual(rec.source, 'usage');
  assert.strictEqual(rec.byok, true);
  assert.strictEqual(rec.provider, 'openai');
  assert.strictEqual(rec.ts, Date.parse('2026-11-13T07:44:58.298Z'));
});

test('decode rate uses the window after the first token', () => {
  const rec = usageToRecord(usage({ outputTokens: 501, duration: 6000, timeToFirstTokenMs: 1000 }), null);
  assert.strictEqual(rec.decodeRate, 100);
});

test('no decode rate when the whole answer arrived with the first chunk', () => {
  const rec = usageToRecord(usage({ outputTokens: 75, duration: 41471, timeToFirstTokenMs: 41435 }), null);
  assert.strictEqual(rec.decodeRate, null);
  assert.strictEqual(rec.ttftMs, 41435);
});

test('ignores generation windows too short to be a real measurement', () => {
  const rec = usageToRecord(usage({ outputTokens: 900, duration: 41471, timeToFirstTokenMs: 41000 }), null);
  assert.strictEqual(rec.decodeRate, null);
});

test('drops impossible decode rates instead of reporting them', () => {
  const rec = usageToRecord(usage({ outputTokens: 5000, duration: 2000, timeToFirstTokenMs: 1000 }), null);
  assert.strictEqual(rec.decodeRate, null);
  assert.strictEqual(rec.rate, 2500);
});

test('ignores other events and unusable usage records', () => {
  assert.strictEqual(usageToRecord({ type: 'assistant.message', data: {} }, null), null);
  assert.strictEqual(usageToRecord(usage({ outputTokens: 0 }), null), null);
  assert.strictEqual(usageToRecord(usage({ duration: 0 }), null), null);
  assert.strictEqual(parseUsageLine('{"type":"tool.execution_start","data":{}}', null), null);
  assert.strictEqual(parseUsageLine('not json', null), null);
});

test('falls back to a composite id when apiCallId is missing', () => {
  const rec = usageToRecord(usage({ apiCallId: undefined }), null);
  assert.ok(rec.id.includes('magpie/gpt/gpt-6.1-sol'));
  assert.strictEqual(rec.model, 'GPT-6.1 Sol \u00b7 gpt');
});

test('scanner discovers session folders and tails incrementally', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-usage-'));
  const sess = path.join(dir, 'aaaa-1111');
  fs.mkdirSync(sess, { recursive: true });
  const file = path.join(sess, 'events.jsonl');
  fs.writeFileSync(file, JSON.stringify(usage()) + '\n', 'utf8');

  const scanner = new UsageScanner();
  const files = scanner.scan({ root: dir, backfillDays: 0 });
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].file, file);

  const first = scanner.readNew(file);
  assert.strictEqual(first.length, 1);
  assert.strictEqual(parseUsageLine(first[0], file).output, 400);

  // Nothing new yet.
  assert.strictEqual(scanner.readNew(file).length, 0);

  fs.appendFileSync(file, JSON.stringify(usage({ apiCallId: 'resp_byok_2', outputTokens: 10 })) + '\n', 'utf8');
  const second = scanner.readNew(file);
  assert.strictEqual(second.length, 1);
  assert.strictEqual(parseUsageLine(second[0], file).id, 'resp_byok_2');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('scanner cache is keyed by the backfill window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-usage-'));
  const recent = path.join(dir, 'recent-session');
  const old = path.join(dir, 'old-session');
  fs.mkdirSync(recent, { recursive: true });
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(recent, 'events.jsonl'), JSON.stringify(usage()) + '\n', 'utf8');
  fs.writeFileSync(path.join(old, 'events.jsonl'), JSON.stringify(usage()) + '\n', 'utf8');

  const tenDaysAgo = (Date.now() - 10 * 86400000) / 1000;
  fs.utimesSync(path.join(old, 'events.jsonl'), tenDaysAgo, tenDaysAgo);

  const scanner = new UsageScanner();
  assert.strictEqual(scanner.scan({ root: dir, backfillDays: 2 }).length, 1);
  // A deeper window must not be answered from the shallow cache.
  assert.strictEqual(scanner.scan({ root: dir, backfillDays: 0 }).length, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('scanner skips dot-directories such as .session-operation-locks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-usage-'));
  fs.mkdirSync(path.join(dir, '.session-operation-locks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.session-operation-locks', 'events.jsonl'), '{}\n', 'utf8');
  assert.strictEqual(new UsageScanner().scan({ root: dir, backfillDays: 0 }).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} tests passed`);
