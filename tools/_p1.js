const fs = require('fs');

function patch(file, pairs) {
  let c = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    if (!c.includes(from)) throw new Error(`anchor missing in ${file}: ${from.slice(0, 70)}`);
    c = c.replace(from, to);
  }
  fs.writeFileSync(file, c);
  console.log('patched', file);
}

// ── package.json ────────────────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '0.4.0';
pkg.displayName = 'Copilot Speedometer';
pkg.icon = 'media/icon.png';
const props = pkg.contributes.configuration.properties;
const rebuilt = {};
for (const [k, v] of Object.entries(props)) {
  rebuilt[k] = v;
  if (k === 'copilotSpeedometer.statusBar') {
    rebuilt['copilotSpeedometer.autoHideMinutes'] = {
      type: 'number',
      default: 5,
      minimum: 0,
      maximum: 1440,
      description: '%config.autoHideMinutes.description%',
    };
  }
}
pkg.contributes.configuration.properties = rebuilt;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('package.json ->', pkg.version, pkg.displayName, pkg.icon);

// ── nls ─────────────────────────────────────────────────────────────────────
for (const [file, text] of [
  ['package.nls.json', 'Minutes of Copilot silence after which the status-bar item hides itself, so a window you are not chatting in does not keep a stale number. 0 keeps it always visible.'],
  ['package.nls.zh-cn.json', '多久没有新的 Copilot 回答后自动隐藏状态栏项，避免在不聊天的窗口里显示一个过期的数字。0 表示始终显示。'],
]) {
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v;
    if (k === 'config.statusBar.description') out['config.autoHideMinutes.description'] = text;
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log('nls ->', file, Object.keys(out).length, 'keys');
}

// ── src/settings.js ─────────────────────────────────────────────────────────
patch('src/settings.js', [[
  "  { key: 'statusBar', section: 'display', type: 'boolean', default: true },",
  "  { key: 'statusBar', section: 'display', type: 'boolean', default: true },\n" +
  "  { key: 'autoHideMinutes', section: 'display', type: 'number', default: 5, min: 0, max: 1440, step: 1, unit: 'min' },"
]]);

// ── src/i18n.js ─────────────────────────────────────────────────────────────
patch('src/i18n.js', [
  ["  'ui.unit.ms': 'ms',", "  'ui.unit.ms': 'ms',\n  'ui.unit.min': 'min',"],
  ["  'ui.unit.ms': '\u6beb\u79d2',", "  'ui.unit.ms': '\u6beb\u79d2',\n  'ui.unit.min': '\u5206\u949f',"],
  ["  'field.statusBar.hint': ", "  'field.autoHideMinutes.label': 'Auto-hide after',\n  'field.autoHideMinutes.hint': 'Hide the status-bar item when no new response has arrived for this long.',\n  'field.statusBar.hint': "],
]);
