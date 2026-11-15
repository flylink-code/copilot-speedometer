'use strict';

/**
 * Guards the two-language promise: the dictionaries must stay aligned, every
 * literal key used by the host or the panel must exist, and the package.nls
 * files must cover every %key% that package.json contributes.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const i18n = require('../src/i18n');
const settings = require('../src/settings');
const webview = require('../src/webview');

const root = path.join(__dirname, '..');
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

/** Keys referenced as t('x') / tr('x') in a source file. */
function usedKeys(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const keys = new Set();
  const re = /\b(?:t|tr)\(\s*'([A-Za-z0-9_.]+)'/g;
  let m = re.exec(text);
  while (m) {
    keys.add(m[1]);
    m = re.exec(text);
  }
  // `t('ui.unit.' + u)` and friends are prefixes, not keys; the dynamic keys
  // themselves are covered by their own test below.
  return [...keys].filter((k) => !k.endsWith('.'));
}

const en = i18n.DICTS.en;
const zh = i18n.DICTS.zh;

test('both dictionaries expose exactly the same keys', () => {
  const missingInZh = Object.keys(en).filter((k) => !(k in zh));
  const missingInEn = Object.keys(zh).filter((k) => !(k in en));
  assert.deepStrictEqual(missingInZh, [], `missing from zh: ${missingInZh.join(', ')}`);
  assert.deepStrictEqual(missingInEn, [], `missing from en: ${missingInEn.join(', ')}`);
});

test('no translation is empty and no placeholders drift between languages', () => {
  for (const key of Object.keys(en)) {
    assert.ok(String(en[key]).length > 0, `en.${key} is empty`);
    assert.ok(String(zh[key]).length > 0, `zh.${key} is empty`);
    const slots = (s) => (String(s).match(/\{\d\}/g) || []).sort().join(',');
    assert.strictEqual(slots(zh[key]), slots(en[key]), `placeholder mismatch in ${key}`);
  }
});

test('resolve() maps VS Code language identifiers', () => {
  assert.strictEqual(i18n.resolve('zh-cn'), 'zh');
  assert.strictEqual(i18n.resolve('zh-Hans'), 'zh');
  assert.strictEqual(i18n.resolve('ZH'), 'zh');
  assert.strictEqual(i18n.resolve('en'), 'en');
  assert.strictEqual(i18n.resolve('de'), 'en');
  assert.strictEqual(i18n.resolve(undefined), 'en');
});

test('t() substitutes positional placeholders and falls back safely', () => {
  const tr = i18n.create('zh').t;
  assert.strictEqual(tr('msg.clearConfirm', 7).includes('7'), true);
  assert.strictEqual(tr('status.rate', '12.4'), '$(pulse) 12.4 tok/s');
  assert.strictEqual(tr('ui.card.decodeSub', '1.2 s').includes('1.2 s'), true);
  // Unknown key returns the key itself rather than "undefined".
  assert.strictEqual(tr('nope.not.here'), 'nope.not.here');
});

test('every key used by the host exists in both dictionaries', () => {
  const keys = usedKeys('src/extension.js');
  assert.ok(keys.length > 30, `expected many keys, got ${keys.length}`);
  for (const key of keys) {
    assert.ok(key in en, `src/extension.js uses a key missing from en: ${key}`);
    assert.ok(key in zh, `src/extension.js uses a key missing from zh: ${key}`);
  }
});

test('every key used by the panel exists in both dictionaries', () => {
  for (const file of ['src/webview.js', 'src/settings.js']) {
    for (const key of usedKeys(file)) {
      assert.ok(key in en, `${file} uses a key missing from en: ${key}`);
      assert.ok(key in zh, `${file} uses a key missing from zh: ${key}`);
    }
  }
});

test('dynamic panel keys (segments, units, fields) resolve in both languages', () => {
  for (const locale of ['en', 'zh']) {
    const tr = i18n.create(locale).t;
    for (const key of ['ui.seg.rate', 'ui.seg.rateModel', 'ui.seg.rateTtft', 'ui.unit.ms', 'ui.unit.records', 'ui.unit.days', 'ui.unit.x']) {
      assert.notStrictEqual(tr(key), key, `${locale}: ${key} is missing`);
    }
    for (const field of settings.FIELDS) {
      for (const suffix of ['label', 'hint']) {
        const key = `field.${field.key}.${suffix}`;
        assert.ok(key in en && key in zh, `missing ${key}`);
      }
    }
    for (const id of ['general', 'sources', 'collection', 'display', 'pricing']) {
      assert.ok(`section.${id}.title` in en && `section.${id}.title` in zh, `missing section.${id}.title`);
    }
  }
});

test('describe() and the rendered panel follow the requested language', () => {
  const config = {
    own: { get: (key, dflt) => dflt, update() {} },
    copilot: { inspect: () => ({ defaultValue: false }), update() {} },
  };
  const zhDesc = settings.describe(config, i18n.create('zh').t);
  const enDesc = settings.describe(config, i18n.create('en').t);
  assert.strictEqual(zhDesc.sections[0].title, '常规');
  assert.strictEqual(enDesc.sections[0].title, 'General');
  const zhEnabled = zhDesc.fields.find((f) => f.key === 'enabled');
  assert.strictEqual(zhEnabled.label, '启用 Copilot Speedometer');

  const zhHtml = webview.html('n', 'src:', { locale: 'zh', dict: i18n.DICTS.zh });
  const enHtml = webview.html('n', 'src:', { locale: 'en', dict: i18n.DICTS.en });
  assert.ok(zhHtml.includes('<html lang="zh"'));
  assert.ok(zhHtml.includes('还没有抓到模型调用'));
  assert.ok(enHtml.includes('<html lang="en"'));
  assert.ok(enHtml.includes('No model calls captured yet'));
});

test('package.nls files cover every %key% contributed by package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const nlsEn = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
  const nlsZh = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.zh-cn.json'), 'utf8'));
  const used = [...fs.readFileSync(path.join(root, 'package.json'), 'utf8').matchAll(/%([A-Za-z0-9_.]+)%/g)].map((m) => m[1]);
  assert.ok(used.length > 10, `expected contributed strings, got ${used.length}`);
  for (const key of used) {
    assert.ok(key in nlsEn, `package.nls.json is missing ${key}`);
    assert.ok(key in nlsZh, `package.nls.zh-cn.json is missing ${key}`);
  }
  assert.deepStrictEqual(Object.keys(nlsEn).sort(), Object.keys(nlsZh).sort());
  // A localised title must never leak into the manifest itself.
  assert.ok(pkg.contributes.commands.every((c) => String(c.title).startsWith('%')));
});

console.log(`\n${passed} i18n tests passed`);
