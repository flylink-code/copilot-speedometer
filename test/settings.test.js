'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const settings = require('../src/settings');

let passed = 0;
const queue = [];

function test(name, fn) {
  queue.push([name, fn]);
}

async function run() {
  for (const [name, fn] of queue) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok   ${name}`);
    } catch (err) {
      console.error(`  FAIL ${name}`);
      console.error(err);
      process.exitCode = 1;
      throw err;
    }
  }
  console.log(`\n${passed} settings tests passed`);
}

/**
 * Minimal stand-in for WorkspaceConfiguration: values live in a plain object so
 * a test can assert exactly what was written where.
 */
function fakeConfig(initial) {
  const store = Object.assign({}, initial);
  const calls = [];
  return {
    store,
    calls,
    own: {
      get(key, dflt) {
        return key in store ? store[key] : dflt;
      },
      update(key, value) {
        calls.push(['own', key, value]);
        if (value === undefined) delete store[key];
        else store[key] = value;
        return Promise.resolve();
      },
    },
    copilot: {
      inspect() {
        return { defaultValue: false, globalValue: store.__debugLogging, workspaceValue: undefined };
      },
      update(key, value) {
        calls.push(['copilot', key, value]);
        store.__debugLogging = value;
        return Promise.resolve();
      },
    },
  };
}

test('every declared field exists in package.json configuration', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const props = pkg.contributes.configuration.properties;
  for (const field of settings.FIELDS) {
    if (field.copilot) continue;
    const key = `copilotSpeedometer.${field.key}`;
    assert.ok(props[key], `${key} is missing from package.json`);
    assert.strictEqual(props[key].default, field.default, `${key} default drifted from settings.js`);
    if (field.min !== undefined) assert.strictEqual(props[key].minimum, field.min, `${key} minimum drifted`);
    if (field.options) assert.deepStrictEqual(props[key].enum, field.options, `${key} enum drifted`);
  }
});

test('describe() reports values, defaults and modified flags', () => {
  const cfg = fakeConfig({ pollIntervalMs: 5000 });
  const desc = settings.describe(cfg);

  assert.ok(desc.sections.length >= 4);
  assert.strictEqual(desc.fields.length, settings.FIELDS.length);

  const poll = desc.fields.find((f) => f.key === 'pollIntervalMs');
  assert.strictEqual(poll.value, 5000);
  assert.strictEqual(poll.modified, true);
  assert.strictEqual(poll.unit, 'ms');

  const statusBar = desc.fields.find((f) => f.key === 'statusBar');
  assert.strictEqual(statusBar.value, true);
  assert.strictEqual(statusBar.modified, false);
});

test('describe() reads the Copilot debug-logging switch from the other namespace', () => {
  const cfg = fakeConfig({ __debugLogging: true });
  const field = settings.describe(cfg).fields.find((f) => f.key === 'copilotDebugLogging');
  assert.strictEqual(field.value, true);
  assert.strictEqual(field.modified, true);
});

test('number fields reject non-numbers and out-of-range values', () => {
  const field = settings.fieldByKey('pollIntervalMs');
  assert.deepStrictEqual(settings.coerce(field, 'abc'), { error: 'Enter a number.' });
  assert.deepStrictEqual(settings.coerce(field, 10), { error: 'Minimum is 500.' });
  assert.deepStrictEqual(settings.coerce(field, 999999), { error: 'Maximum is 60000.' });
  assert.deepStrictEqual(settings.coerce(field, '1500'), { value: 1500 });
  assert.deepStrictEqual(settings.coerce(field, 1500.4), { value: 1500 });
});

test('enum fields reject options outside the packaged list', () => {
  const field = settings.fieldByKey('statusBarFormat');
  assert.deepStrictEqual(settings.coerce(field, 'nope'), { error: 'Unknown option "nope".' });
  assert.deepStrictEqual(settings.coerce(field, 'rate-model'), { value: 'rate-model' });
});

test('boolean and path fields tolerate the shapes an <input> sends', () => {
  assert.deepStrictEqual(settings.coerce(settings.fieldByKey('statusBar'), 'true'), { value: true });
  assert.deepStrictEqual(settings.coerce(settings.fieldByKey('statusBar'), false), { value: false });
  assert.deepStrictEqual(settings.coerce(settings.fieldByKey('usageEventsRoot'), '  C:\\x  '), {
    value: 'C:\\x',
  });
});

test('apply() writes the coerced value to global user settings', async () => {
  const cfg = fakeConfig({});
  const result = await settings.apply(cfg, 'pollIntervalMs', '3000', false);
  assert.deepStrictEqual(result, { ok: true, key: 'pollIntervalMs', value: 3000 });
  assert.deepStrictEqual(cfg.calls, [['own', 'pollIntervalMs', 3000]]);
});

test('apply() rejects an invalid value without writing anything', async () => {
  const cfg = fakeConfig({});
  const result = await settings.apply(cfg, 'historySize', 1, false);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.message, 'Minimum is 100.');
  assert.deepStrictEqual(cfg.calls, []);
});

test('apply(reset) removes the override instead of writing the default', async () => {
  const cfg = fakeConfig({ pollIntervalMs: 5000 });
  const result = await settings.apply(cfg, 'pollIntervalMs', null, true);
  assert.strictEqual(result.reset, true);
  assert.deepStrictEqual(cfg.calls, [['own', 'pollIntervalMs', undefined]]);
});

test('apply() routes the debug-logging switch to the Copilot namespace', async () => {
  const cfg = fakeConfig({});
  const result = await settings.apply(cfg, 'copilotDebugLogging', true, false);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(cfg.calls, [['copilot', settings.FILE_LOGGING_KEY, true]]);
});

test('apply() reports unknown keys instead of throwing', async () => {
  const cfg = fakeConfig({});
  const result = await settings.apply(cfg, 'nonsense', 1, false);
  assert.deepStrictEqual(result, { ok: false, message: 'Unknown setting "nonsense".' });
});

run();
