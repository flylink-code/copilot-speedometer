'use strict';

/** Aggregation and formatting helpers (no VS Code dependency, so they are testable). */

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] !== undefined ? sorted[base + 1] : sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function summarize(records) {
  const n = records.length;
  if (!n) {
    return {
      count: 0,
      input: 0,
      output: 0,
      cached: 0,
      durMs: 0,
      rate: null,
      medianRate: null,
      p90Rate: null,
      decodeRate: null,
      ttftMs: null,
    };
  }

  let input = 0;
  let output = 0;
  let cached = 0;
  let durMs = 0;
  let decodeOut = 0;
  let decodeDur = 0;
  let ttftSum = 0;
  let ttftCount = 0;

  for (const r of records) {
    input += r.input || 0;
    output += r.output || 0;
    cached += r.cached || 0;
    durMs += r.durMs || 0;
    if (r.ttftMs > 0 && r.durMs > r.ttftMs && r.output > 1) {
      decodeOut += r.output - 1;
      decodeDur += r.durMs - r.ttftMs;
      ttftSum += r.ttftMs;
      ttftCount += 1;
    }
  }

  const rates = records.map((r) => r.rate).filter((v) => typeof v === 'number' && isFinite(v));
  rates.sort((a, b) => a - b);

  return {
    count: n,
    input,
    output,
    cached,
    durMs,
    rate: durMs > 0 ? output / (durMs / 1000) : null,
    medianRate: rates.length ? quantile(rates, 0.5) : null,
    p90Rate: rates.length ? quantile(rates, 0.9) : null,
    decodeRate: decodeDur > 0 ? decodeOut / (decodeDur / 1000) : null,
    ttftMs: ttftCount ? ttftSum / ttftCount : null,
  };
}

function groupByModel(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.model)) map.set(r.model, []);
    map.get(r.model).push(r);
  }
  const rows = [];
  for (const [model, list] of map) {
    rows.push(Object.assign({ model }, summarize(list)));
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

function dayKey(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fmtRate(rate) {
  if (rate === null || rate === undefined || !isFinite(rate)) return '--';
  if (rate >= 100) return String(Math.round(rate));
  if (rate >= 10) return (Math.round(rate * 10) / 10).toFixed(1);
  return rate.toFixed(2);
}

function fmtTokens(n) {
  if (n === null || n === undefined || !isFinite(n)) return '--';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

function fmtDur(ms) {
  if (ms === null || ms === undefined || !isFinite(ms)) return '--';
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}`;
}

module.exports = { summarize, groupByModel, dayKey, fmtRate, fmtTokens, fmtDur, fmtTime, quantile };
