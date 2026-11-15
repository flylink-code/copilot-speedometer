'use strict';

const assert = require('assert');
const pricing = require('../src/pricing');
const { summarize } = require('../src/stats');

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

console.log('pricing');

test('normalizes gateway prefixes, display suffixes and hyphen versions', () => {
  assert.strictEqual(
    pricing.normalizeModelName('customendpoint/magpie/antigravity/claude-sonnet-5-5'),
    'claude-sonnet-5.5'
  );
  assert.strictEqual(
    pricing.normalizeModelName('Claude Sonnet 5.5 · Antigravity'),
    'claude-sonnet-5.5'
  );
  assert.strictEqual(
    pricing.normalizeModelName('magpie/opencode-go/deepseek-v4.1-flash'),
    'deepseek-v4.1-flash'
  );
  assert.strictEqual(pricing.normalizeModelName('AI-Switcher/gpt-6.1-sol'), 'gpt-6.1-sol');
});

test('looks up built-in rates with date stripping and boundary prefix matching', () => {
  const claude = pricing.lookupPrice('claude-sonnet-4-5-20250929', '');
  assert.strictEqual(claude.key, 'claude-sonnet-4.5');
  assert.strictEqual(claude.source, 'builtin');

  const gemini = pricing.lookupPrice('magpie/antigravity/gemini-4-hydrogen', '');
  assert.strictEqual(gemini.key, 'gemini-4-hydrogen');
  assert.strictEqual(gemini.rate.input, 1.5);
  assert.strictEqual(gemini.rate.output, 7.5);
});

test('treats :free and -free models as zero cost', () => {
  const hit = pricing.lookupPrice('customendpoint/magpie/opencode-go/beam-free', 'Beam Free');
  assert.strictEqual(hit.source, 'free');
  const est = pricing.estimateCost({ rawModel: 'customendpoint/magpie/opencode-go/beam-free', input: 50000, output: 1000 });
  assert.strictEqual(est.costUsd, 0);
});

test('returns null for unknown models instead of guessing', () => {
  assert.strictEqual(pricing.lookupPrice('private-finetune-v9', ''), null);
  assert.strictEqual(pricing.estimateCost({ rawModel: 'private-finetune-v9', input: 1000, output: 500 }), null);
});

test('subtracts cached reads from uncached input and bills cacheWrite separately', () => {
  // claude-sonnet-5.5: input=2, output=10, cacheRead=0.1, cacheWrite=2.5 per 1M
  const est = pricing.estimateCost({
    rawModel: 'magpie/antigravity/claude-sonnet-5-5',
    input: 1_000_000,
    cached: 600_000,
    cacheWrite: 200_000,
    output: 100_000,
  });
  // uncached = 400k -> $0.80; cacheRead = 600k -> $0.06; cacheWrite = 200k -> $0.50; output = 100k -> $1.00
  assert.ok(Math.abs(est.costUsd - 2.36) < 1e-9, `got ${est.costUsd}`);
});

test('applies custom overrides and multiplier', () => {
  const est = pricing.estimateCost(
    { rawModel: 'my-local-model', input: 1_000_000, output: 500_000, cached: 0 },
    {
      multiplier: 0.5,
      customPricing: { 'my-local-model': { input: 2, output: 10 } },
    }
  );
  // (2 + 5) * 0.5 = 3.5
  assert.strictEqual(est.source, 'override');
  assert.ok(Math.abs(est.costUsd - 3.5) < 1e-9);
});

test('summarize tracks priced vs unpriced requests without dropping known costs', () => {
  const agg = summarize([
    { rawModel: 'gpt-6.1-sol', model: 'gpt-6.1-sol', input: 500_000, cached: 0, output: 100_000, durMs: 1000, rate: 100 },
    { rawModel: 'mystery-model', model: 'mystery-model', input: 100_000, cached: 0, output: 50_000, durMs: 1000, rate: 50 },
  ]);
  // gpt-6.1-sol: 0.5*2 + 0.1*10 = 2.0
  assert.strictEqual(agg.pricedCount, 1);
  assert.strictEqual(agg.unpricedCount, 1);
  assert.ok(Math.abs(agg.costUsd - 2.0) < 1e-9);
});

test('formats USD costs across magnitudes', () => {
  assert.strictEqual(pricing.fmtCost(null), '--');
  assert.strictEqual(pricing.fmtCost(0), '$0.00');
  assert.strictEqual(pricing.fmtCost(0.00002), '<$0.0001');
  assert.strictEqual(pricing.fmtCost(0.0042), '$0.0042');
  assert.strictEqual(pricing.fmtCost(0.184), '$0.184');
  assert.strictEqual(pricing.fmtCost(12.345), '$12.35');
});

console.log(`\n${passed} pricing tests passed`);
