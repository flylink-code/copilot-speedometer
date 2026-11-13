'use strict';

/**
 * Settings model for the dashboard's Settings tab.
 *
 * The webview never writes settings itself and never sees a raw
 * `WorkspaceConfiguration`: every field is described here (type, default,
 * range, unit, which section it belongs to), read back through `describe()`,
 * and written through `apply()` after `coerce()` has validated the value.
 * That keeps the panel honest - what it shows is what VS Code will report,
 * including whether the value is still the default.
 */

const i18n = require('./i18n');

const P = 'copilotSpeedometer';
const COPILOT = 'github.copilot.chat';
const FILE_LOGGING_KEY = 'agentDebugLog.fileLogging.enabled';

/**
 * `copilot: true` marks a field that lives in the Copilot extension's own
 * namespace (the debug-log switch). It is displayed with the others because
 * it is a data-source setting, but it is written through a different
 * configuration section.
 *
 * `label`/`hint` are i18n keys, not copy: the panel and the host must agree on
 * the wording, and a translation lives in one place (src/i18n.js).
 */
const FIELDS = [
  { key: 'enabled', section: 'general', type: 'boolean', default: true },
  { key: 'usageEvents', section: 'sources', type: 'boolean', default: true },
  { key: 'usageEventsRoot', section: 'sources', type: 'path', default: '' },
  { key: 'logPath', section: 'sources', type: 'path', default: '' },
  { key: 'includeLegacyWorkspaceLogs', section: 'sources', type: 'boolean', default: true },
  {
    key: 'copilotDebugLogging',
    section: 'sources',
    type: 'boolean',
    copilot: true,
    default: false,
  },
  {
    key: 'pollIntervalMs',
    section: 'collection',
    type: 'number',
    default: 2000,
    min: 500,
    max: 60000,
    step: 500,
    unit: 'ms',
  },
  {
    key: 'historySize',
    section: 'collection',
    type: 'number',
    default: 3000,
    min: 100,
    max: 50000,
    step: 100,
    unit: 'records',
  },
  {
    key: 'backfillDays',
    section: 'collection',
    type: 'number',
    default: 2,
    min: 0,
    max: 365,
    step: 1,
    unit: 'days',
  },
  { key: 'statusBar', section: 'display', type: 'boolean', default: true },
  {
    key: 'statusBarFormat',
    section: 'display',
    type: 'enum',
    default: 'rate',
    options: ['rate', 'rate-model', 'rate-ttft'],
  },
];

function fieldByKey(key) {
  return FIELDS.find((f) => f.key === key) || null;
}

/** The effective value VS Code would hand the extension. */
function readValue(config, field) {
  if (field.copilot) {
    const info = config.copilot.inspect(FILE_LOGGING_KEY);
    if (!info) return false;
    const raw =
      info.globalValue !== undefined
        ? info.globalValue
        : info.workspaceValue !== undefined
          ? info.workspaceValue
          : info.defaultValue;
    return !!raw;
  }
  return config.own.get(field.key, field.default);
}

/** True while the value differs from the packaged default. */
function isModified(config, field) {
  // Comparing effective values (rather than "was it written anywhere?") keeps
  // the reset affordance honest: an explicit `false` is still the default.
  return readValue(config, field) !== field.default;
}

/**
 * Ordered, serialisable description of every setting. `sections` carries the
 * presentation metadata (title + blurb) so the webview never hardcodes copy
 * that the host already knows. `t` is the translation function from
 * src/i18n.js; without one the panel falls back to English.
 */
function describe(config, t) {
  const tr = typeof t === 'function' ? t : i18n.create(i18n.DEFAULT).t;
  return {
    sections: [
      { id: 'general', title: tr('section.general.title'), blurb: tr('section.general.blurb') },
      { id: 'sources', title: tr('section.sources.title'), blurb: tr('section.sources.blurb') },
      { id: 'collection', title: tr('section.collection.title'), blurb: tr('section.collection.blurb') },
      { id: 'display', title: tr('section.display.title'), blurb: tr('section.display.blurb') },
    ],
    fields: FIELDS.map((f) => ({
      key: f.key,
      section: f.section,
      type: f.type,
      default: f.default,
      min: f.min,
      max: f.max,
      step: f.step,
      unit: f.unit,
      options: f.options,
      label: tr(`field.${f.key}.label`),
      hint: tr(`field.${f.key}.hint`),
      value: readValue(config, f),
      modified: isModified(config, f),
    })),
  };
}

/**
 * Convert whatever the input produced into the type the setting expects.
 * Returns `{ value }` on success or `{ error }` with a message the panel can
 * show next to the field.
 */
function coerce(field, raw) {
  if (field.type === 'boolean') {
    return { value: raw === true || raw === 'true' };
  }
  if (field.type === 'enum') {
    return field.options.includes(raw)
      ? { value: raw }
      : { error: `Unknown option "${raw}".` };
  }
  if (field.type === 'number') {
    const n = Number(raw);
    if (!isFinite(n)) return { error: 'Enter a number.' };
    if (field.min !== undefined && n < field.min) {
      return { error: `Minimum is ${field.min}.` };
    }
    if (field.max !== undefined && n > field.max) {
      return { error: `Maximum is ${field.max}.` };
    }
    return { value: Math.round(n) };
  }
  if (field.type === 'path') {
    const value = String(raw === undefined || raw === null ? '' : raw).trim();
    return { value };
  }
  return { value: raw };
}

const GLOBAL = 1; // vscode.ConfigurationTarget.Global
const WORKSPACE = 2; // vscode.ConfigurationTarget.Workspace

/**
 * Where to write a value. VS Code's `get` hides which scope won, so inspect it:
 * if the user already has a workspace override, writing to the user settings
 * would look like a no-op in the panel (the workspace value still wins), which
 * is the most confusing thing a settings UI can do. Keep the existing scope,
 * otherwise write to the user's settings.
 */
function writeTarget(config, field) {
  const section = field.copilot ? config.copilot : config.own;
  const name = field.copilot ? FILE_LOGGING_KEY : field.key;
  let target = GLOBAL;
  if (typeof section.inspect === 'function') {
    const info = section.inspect(name);
    if (info && info.workspaceValue !== undefined && info.workspaceFolderValue === undefined) {
      target = WORKSPACE;
    }
  }
  return { section, name, target };
}

/**
 * Write one setting. `reset` removes the override so the packaged default
 * applies again (which is exactly what VS Code's own "reset" affordance does).
 */
async function apply(config, key, value, reset) {
  const field = fieldByKey(key);
  if (!field) return { ok: false, message: `Unknown setting "${key}".` };

  const where = writeTarget(config, field);

  if (reset) {
    await where.section.update(where.name, undefined, where.target);
    return { ok: true, key, value: field.default, reset: true };
  }

  const result = coerce(field, value);
  if (result.error) return { ok: false, key, message: result.error };

  await where.section.update(where.name, result.value, where.target);
  return { ok: true, key, value: result.value };
}

module.exports = {
  P,
  COPILOT,
  FILE_LOGGING_KEY,
  FIELDS,
  fieldByKey,
  describe,
  coerce,
  apply,
};
