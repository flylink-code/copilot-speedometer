'use strict';

/**
 * Offline model pricing table and cost estimation.
 *
 * All built-in prices are USD per 1M tokens (`input`, `output`, `cacheRead`,
 * `cacheWrite`), sourced from OpenRouter / LiteLLM public model catalogs
 * (2026-11-14). Unknown models yield `null` instead of falling back to a
 * misleading default like `gpt-4o-mini`; callers can inspect `unpriced` counts
 * or let users add custom overrides.
 */

const PRICES = {
  // Anthropic Claude
  'claude-opus-5.5': { input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 5.0 },
  'claude-opus-5': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5.5': { input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5.5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5.2': { input: 8.0, output: 40.0, cacheRead: 0.2, cacheWrite: 10.0 },
  'claude-fable-5.1': { input: 10.0, output: 50.0, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-fable-5': { input: 10.0, output: 50.0, cacheRead: 1.0, cacheWrite: 12.5 },
  'claude-opus-4.8': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4.7': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4.6': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4.5': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4.1': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4.6': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4.5': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4.5': { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-3.5-sonnet': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3.5-haiku': { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },

  // OpenAI GPT & o-series
  'gpt-6.1-sol': { input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 2.5 },
  'gpt-6.1-terra': { input: 1.0, output: 5.0, cacheRead: 0.05, cacheWrite: 1.25 },
  'gpt-6-astra': { input: 10.0, output: 50.0, cacheRead: 1.0, cacheWrite: 12.5 },
  'gpt-6-sol': { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  'gpt-6-luna': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'gpt-5.6-sol': { input: 4.0, output: 20.0, cacheRead: 0.4, cacheWrite: 5.0 },
  'gpt-5.6-terra': { input: 2.0, output: 12.0, cacheRead: 0.2, cacheWrite: 2.5 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  'gpt-5.5-pro': { input: 30.0, output: 180.0, cacheRead: 0, cacheWrite: 0 },
  'gpt-5.5': { input: 5.0, output: 30.0, cacheRead: 0.5, cacheWrite: 0 },
  'gpt-5.4-pro': { input: 30.0, output: 180.0, cacheRead: 0, cacheWrite: 0 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
  'gpt-5.4': { input: 2.5, output: 15.0, cacheRead: 0.25, cacheWrite: 0 },
  'gpt-5.3-codex': { input: 1.75, output: 14.0, cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.2-pro': { input: 21.0, output: 168.0, cacheRead: 0, cacheWrite: 0 },
  'gpt-5.2-codex': { input: 1.75, output: 14.0, cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.2': { input: 1.75, output: 14.0, cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.1-codex-max': { input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5.1-codex-mini': { input: 0.25, output: 2.0, cacheRead: 0.03, cacheWrite: 0 },
  'gpt-5.1-codex': { input: 1.25, output: 10.0, cacheRead: 0.13, cacheWrite: 0 },
  'gpt-5.1': { input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5-pro': { input: 15.0, output: 120.0, cacheRead: 0, cacheWrite: 0 },
  'gpt-5-mini': { input: 0.25, output: 2.0, cacheRead: 0.025, cacheWrite: 0 },
  'gpt-5-nano': { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
  'gpt-5': { input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.03, cacheWrite: 0 },
  'gpt-4.1': { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  'gpt-4o': { input: 2.5, output: 10.0, cacheRead: 1.25, cacheWrite: 0 },
  'o3-pro': { input: 20.0, output: 80.0, cacheRead: 0, cacheWrite: 0 },
  o3: { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 0 },
  'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },

  // Google Gemini
  'gemini-4-hydrogen': { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0.0833 },
  'gemini-4-argon': { input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 0.1875 },
  'gemini-4-carbon': { input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 0.1875 },
  'gemini-3.8-flash': { input: 0.825, output: 4.125, cacheRead: 0.0825, cacheWrite: 0.0417 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.0417 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.0417 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.0833 },
  'gemini-3.5-flash': { input: 1.5, output: 9.0, cacheRead: 0.15, cacheWrite: 0.0833 },
  'gemini-3.1-pro': { input: 2.0, output: 12.0, cacheRead: 0.2, cacheWrite: 0.375 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.0833 },
  'gemini-3-flash': { input: 0.5, output: 3.0, cacheRead: 0.05, cacheWrite: 0.0833 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0.375 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.0833 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.0833 },

  // DeepSeek
  'deepseek-v4.1-flash-1017': { input: 0.038, output: 0.5, cacheRead: 0.01, cacheWrite: 0 },
  'deepseek-v4.1-flash': { input: 0.0507, output: 0.2028, cacheRead: 0.001, cacheWrite: 0 },
  'deepseek-v4-pro': { input: 0.9, output: 1.5, cacheRead: 0.25, cacheWrite: 0 },
  'deepseek-v4-flash': { input: 0.09, output: 0.18, cacheRead: 0.018, cacheWrite: 0 },
  'deepseek-v3.2': { input: 0.26, output: 0.38, cacheRead: 0.13, cacheWrite: 0 },
  'deepseek-r1': { input: 0.5, output: 2.15, cacheRead: 0.35, cacheWrite: 0 },
  'deepseek-chat': { input: 0.2574, output: 1.0287, cacheRead: 0, cacheWrite: 0 },

  // GLM & Qwen
  'glm-5.3-flash': { input: 0.0399, output: 0.0784, cacheRead: 0.03, cacheWrite: 0 },
  'glm-5.3': { input: 0.084, output: 3.6, cacheRead: 0.079, cacheWrite: 0 },
  'glm-5.1': { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  'glm-5': { input: 1.0, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  'glm-4.7': { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
  'qwen3.8-max': { input: 2.0, output: 6.0, cacheRead: 0.25, cacheWrite: 0 },
  'qwen3.8-flash': { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0 },
  'qwen3.7-plus': { input: 0.32, output: 1.28, cacheRead: 0.064, cacheWrite: 0.4 },
  'qwen3.6-plus': { input: 0.325, output: 1.95, cacheRead: 0, cacheWrite: 0.4062 },
  'qwen3-coder': { input: 0.3, output: 1.0, cacheRead: 0.1, cacheWrite: 0 },
};

const KNOWN_KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);
const FREE_RATE = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * Turn a gateway-prefixed BYOK identifier like
 * `customendpoint/magpie/antigravity/claude-sonnet-5-5` or
 * `Claude Sonnet 5.5 · Antigravity` into a canonical lowercase key.
 */
function normalizeModelName(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';

  // Display names sometimes append ` · Provider` (`Claude Sonnet 5.5 · Kiro`).
  s = s.replace(/\s+\u00b7\s+.*$/, '');
  s = s.toLowerCase();

  // Keep the trailing segment after gateway/vendor paths (`magpie/antigravity/...`).
  if (s.includes('/')) {
    s = s.split('/').filter(Boolean).pop() || s;
  }

  // Strip `:free`, `(latest)`, `[1m]`, spaces -> hyphens.
  s = s.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').trim();
  s = s.replace(/\s+/g, '-');
  // Unify `claude-sonnet-5-5` / `claude-3-5-sonnet` -> `claude-sonnet-5.5` / `claude-3.5-sonnet`.
  s = s.replace(/(\d)-(\d)(?=-|$)/g, '$1.$2');
  return s.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function isFreeModel(raw) {
  const s = String(raw || '').toLowerCase();
  return /:free\b/.test(s) || /-free\b/.test(s);
}

function sanitizeRate(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const input = Number(entry.input);
  const output = Number(entry.output);
  if (!isFinite(input) || !isFinite(output) || input < 0 || output < 0) return null;
  const cacheRead = isFinite(Number(entry.cacheRead)) && Number(entry.cacheRead) >= 0 ? Number(entry.cacheRead) : 0;
  const cacheWrite = isFinite(Number(entry.cacheWrite)) && Number(entry.cacheWrite) >= 0 ? Number(entry.cacheWrite) : 0;
  return { input, output, cacheRead, cacheWrite };
}

/**
 * Look up per-1M token pricing for one model.
 * Order: custom overrides (exact raw -> normalized) -> `:free` -> built-in exact ->
 * built-in without date/preview suffix -> longest boundary prefix.
 */
function lookupPrice(rawModel, displayName, customPricing) {
  const custom = customPricing && typeof customPricing === 'object' ? customPricing : null;
  const raw = String(rawModel || '').trim();
  const disp = String(displayName || '').trim();
  const normRaw = normalizeModelName(raw);
  const normDisp = normalizeModelName(disp);

  if (custom) {
    for (const candidate of [raw, raw.toLowerCase(), normRaw, disp, normDisp]) {
      if (candidate && Object.prototype.hasOwnProperty.call(custom, candidate)) {
        const rate = sanitizeRate(custom[candidate]);
        if (rate) return { key: candidate, rate, source: 'override' };
      }
    }
  }

  if (isFreeModel(raw) || isFreeModel(disp)) {
    return { key: normRaw || normDisp || 'free', rate: FREE_RATE, source: 'free' };
  }

  for (const base of [normRaw, normDisp].filter(Boolean)) {
    if (PRICES[base]) return { key: base, rate: PRICES[base], source: 'builtin' };

    const stripped = base
      .replace(/-(?:20\d{6}|\d{4})$/, '')
      .replace(/-(?:preview|customtools|thinking|instruct)$/, '');
    if (PRICES[stripped]) return { key: stripped, rate: PRICES[stripped], source: 'builtin' };

    for (const key of KNOWN_KEYS) {
      if (base === key || base.startsWith(`${key}-`)) {
        return { key, rate: PRICES[key], source: 'builtin' };
      }
    }
  }

  return null;
}

/**
 * Compute estimated USD cost for a single captured record, or `null` when the
 * model has no pricing entry. `inputTokens` from Copilot usage records is total
 * input (including cached reads), so uncached input subtracts `cached`.
 */
function estimateCost(record, opts = {}) {
  if (!record || typeof record !== 'object') return null;
  const hit = lookupPrice(record.rawModel || record.model, record.model, opts.customPricing);
  if (!hit) return null;

  const multRaw = Number(opts.multiplier);
  const multiplier = isFinite(multRaw) && multRaw >= 0 ? multRaw : 1;

  const totalInput = Math.max(0, Number(record.input) || 0);
  const cacheRead = Math.max(0, Number(record.cached) || 0);
  const cacheWrite = Math.max(0, Number(record.cacheWrite) || 0);
  const output = Math.max(0, Number(record.output) || 0);
  const uncachedInput = Math.max(0, totalInput - cacheRead);

  const rawUsd =
    (uncachedInput * hit.rate.input +
      cacheRead * hit.rate.cacheRead +
      cacheWrite * hit.rate.cacheWrite +
      output * hit.rate.output) /
    1e6;

  return {
    costUsd: rawUsd * multiplier,
    matchedKey: hit.key,
    source: hit.source,
  };
}

function fmtCost(usd) {
  if (usd === null || usd === undefined || !isFinite(usd)) return '--';
  if (usd === 0) return '$0.00';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

module.exports = {
  PRICES,
  normalizeModelName,
  lookupPrice,
  estimateCost,
  fmtCost,
};
