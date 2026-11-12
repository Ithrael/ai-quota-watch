// Fields follow MoonshotAI/kimi-code packages/oauth/src/managed-usage.ts.
const USAGE_URL = 'https://api.kimi.com/coding/v1/usages';

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function number(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '')) return null;
  const result = Number(value);
  return isFinite(result) && result >= 0 ? result : null;
}

export function kimiRequest(apiKey) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key || key.length > 2000 || key.indexOf('\r') !== -1 || key.indexOf('\n') !== -1) {
    throw failure('KEY_REQUIRED', '请先配置 Kimi Code Key');
  }
  return { url: USAGE_URL, method: 'GET',
    header: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, responseType: 'json' };
}

function windowInfo(label, ratio, reset, total, used) {
  if (ratio === null || ratio > 1) return null;
  let timestamp = typeof reset === 'string' ? reset : '';
  const dot = timestamp.indexOf('.');
  if (dot !== -1) {
    let end = dot + 1;
    while (end < timestamp.length && timestamp[end] >= '0' && timestamp[end] <= '9') end++;
    // JerryScript only accepts millisecond precision, while Kimi may return microseconds.
    timestamp = timestamp.slice(0, dot + 1) + timestamp.slice(dot + 1, end).slice(0, 3) + timestamp.slice(end);
  }
  const resetAt = Date.parse(timestamp);
  return { label: label, remainingPercent: 100 - ratio * 100, usedPercent: ratio * 100,
    resetAt: isFinite(resetAt) && resetAt > 0 ? resetAt : null,
    total: total === undefined ? null : total, used: used === undefined ? null : used, unit: '' };
}

function counterWindow(label, row) {
  if (!row || typeof row !== 'object') return null;
  const total = number(row.limit), used = number(row.used), remaining = number(row.remaining);
  if (total === null || total <= 0) return null;
  const consumed = used === null && remaining !== null ? total - remaining : used;
  if (consumed === null || consumed < 0 || consumed > total) return null;
  return windowInfo(label, consumed / total, row.resetTime, total, consumed);
}

function ratioWindow(label, row) {
  return row && typeof row === 'object' ? windowInfo(label, number(row.used_ratio), row.reset_time) : null;
}

export function parseKimiResponse(body, nowMs) {
  let payload;
  try { payload = typeof body === 'string' ? JSON.parse(body) : body; }
  catch (_) { throw failure('INVALID_DATA', 'Kimi 返回的数据无法识别'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw failure('INVALID_DATA', 'Kimi 返回的数据无法识别');
  }
  if (payload.error || (payload.code !== undefined && payload.code !== 0 && payload.code !== 200)) {
    throw failure('API_ERROR', 'Kimi 套餐额度暂不可用');
  }
  const usages = payload.usages || {};
  let hour = null;
  if (Array.isArray(payload.limits)) {
    for (let index = 0; index < payload.limits.length; index++) {
      const item = payload.limits[index];
      if (item && item.window && item.window.duration === 300 && item.window.timeUnit === 'TIME_UNIT_MINUTE') {
        hour = counterWindow('5 小时', item.detail);
        if (hour) break;
      }
    }
  }
  // Detailed counters take precedence: older servers can return stale zero ratios.
  const week = counterWindow('每周', payload.usage) || ratioWindow('每周', usages.limit_7d);
  hour = hour || ratioWindow('5 小时', usages.limit_5h);
  const windows = [hour, week].filter(function(item) { return item !== null; });
  if (!windows.length) throw failure('NO_QUOTA', '未查到 Kimi Code 套餐额度');
  return { provider: 'Kimi', updatedAt: nowMs === undefined ? Date.now() : nowMs, windows: windows };
}
