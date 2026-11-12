// The endpoint and raw Authorization header follow Zhipu's own usage plugin:
// github.com/zai-org/zai-coding-plugins/tree/main/plugins/glm-plan-usage
const QUOTA_URL = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';
const RESET_URL = 'https://open.bigmodel.cn/api/biz/customer-package-reset/list?targetType=PERSONAL';

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function numeric(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const result = Number(value);
  return isFinite(result) ? result : null;
}

function nonNegative(value) {
  const result = numeric(value);
  return result !== null && result >= 0 ? result : null;
}

function windowInfo(limit) {
  const number = nonNegative(limit.number);
  if (limit.type === 'TIME_LIMIT') {
    return { label: limit.unit === 5 && number === 1 ? 'MCP 月度' : 'MCP 工具', order: 1000000 };
  }
  if (number && limit.unit === 3) {
    return { label: number + ' 小时', order: number * 60 };
  }
  if (number && limit.unit === 6) {
    return { label: number === 1 ? '每周' : number + ' 周', order: number * 10080 };
  }
  return { label: '套餐额度', order: 999999 };
}

export function quotaRequest(apiKey) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key || key.length > 2000 || key.indexOf('\r') !== -1 || key.indexOf('\n') !== -1) {
    throw failure('KEY_REQUIRED', '请先配置 GLM API Key');
  }
  return {
    url: QUOTA_URL,
    method: 'GET',
    header: { Authorization: key, 'Content-Type': 'application/json' },
    responseType: 'json'
  };
}

export function resetRequest(apiKey) {
  const request = quotaRequest(apiKey);
  request.url = RESET_URL;
  return request;
}

function resetExpiry(value) {
  if (typeof value !== 'string') return null;
  let timestamp = value.trim().split(' ').join('T');
  const offset = function(text) {
    return text.length === 5 && (text[0] === '+' || text[0] === '-') &&
      text.slice(1).split('').every(function(character) { return character >= '0' && character <= '9'; });
  };
  // Domestic console dates have no offset; use Beijing time, not the viewer's zone.
  if (timestamp.length === 19 && timestamp[4] === '-' && timestamp[7] === '-' &&
      timestamp[10] === 'T' && timestamp[13] === ':' && timestamp[16] === ':') timestamp += '+08:00';
  else if (timestamp.slice(-1).toUpperCase() !== 'Z' && !offset(timestamp.slice(-5)) &&
      !offset(timestamp.slice(-6).split(':').join(''))) return null;
  const result = Date.parse(timestamp);
  return isFinite(result) && result > 0 ? result : null;
}

function availableResets(records, nowMs) {
  if (!Array.isArray(records)) return null;
  let count = 0;
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || typeof record.available !== 'boolean') return null;
    if (!record.available) continue;
    const expires = resetExpiry(record.expireTime);
    if (expires === null) return null;
    if (expires > nowMs) count++;
  }
  return count;
}

export function parseResetResponse(body, nowMs) {
  let payload;
  try {
    payload = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (error) {
    throw failure('INVALID_DATA', 'GLM 返回的重置次数无法识别');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw failure('INVALID_DATA', 'GLM 返回的重置次数无法识别');
  }
  const code = numeric(payload.code === undefined && payload.error ? payload.error.code : payload.code);
  if (code === 401 || code === 403 || (code !== null && code >= 1000 && code <= 1004)) {
    throw failure('AUTH', 'GLM Key 无效或无查询权限');
  }
  if (code === 429) throw failure('RATE_LIMIT', '查询过于频繁，请稍后刷新');
  if (payload.error || payload.success !== true || (code !== null && code !== 0 && code !== 200)) {
    throw failure('API_ERROR', '重置次数暂不可用，请稍后刷新');
  }
  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data.targetType && data.targetType !== 'PERSONAL')) {
    throw failure('INVALID_DATA', 'GLM 返回的重置次数无法识别');
  }
  const updatedAt = nowMs === undefined ? Date.now() : nowMs;
  const fiveHour = availableResets(data.fiveHourResets, updatedAt);
  const weekly = availableResets(data.weekResets, updatedAt);
  if (fiveHour === null && weekly === null) {
    throw failure('INVALID_DATA', 'GLM 返回的重置次数无法识别');
  }
  return { fiveHour: fiveHour, weekly: weekly, updatedAt: updatedAt };
}

export function normalizeQuota(payload, nowMs) {
  const data = payload && payload.data ? payload.data : payload;
  if (!data || !Array.isArray(data.limits)) {
    throw failure('INVALID_DATA', 'GLM 返回的数据格式无法识别');
  }
  const windows = [];
  for (let index = 0; index < data.limits.length; index++) {
    const limit = data.limits[index];
    if (!limit || ['CREDIT_LIMIT', 'TOKENS_LIMIT', 'TIME_LIMIT'].indexOf(limit.type) < 0) continue;
    const total = nonNegative(limit.usage);
    let used = nonNegative(limit.currentValue);
    const remaining = nonNegative(limit.remaining);
    if (used === null && total !== null && remaining !== null && remaining <= total) used = total - remaining;
    let percent = numeric(limit.percentage);
    if (limit.percentage !== undefined && limit.percentage !== null && percent === null) continue;
    if (percent === null && used !== null && total !== null && total > 0) percent = used / total * 100;
    // An absent or impossible percentage is unavailable, never "0% used".
    if (percent === null || percent < 0 || percent > 100) continue;
    const info = windowInfo(limit);
    const reset = nonNegative(limit.nextResetTime);
    windows.push({
      id: limit.type.toLowerCase() + '-' + limit.unit + '-' + limit.number + '-' + index,
      label: info.label,
      usedPercent: percent,
      remainingPercent: 100 - percent,
      used: used,
      total: total,
      unit: limit.type === 'CREDIT_LIMIT' ? '积分' : limit.type === 'TOKENS_LIMIT' ? 'Token' : '次',
      resetAt: reset !== null && reset > 0 && reset <= 8640000000000000 ? reset : null,
      order: info.order
    });
  }
  if (!windows.length) {
    throw failure('NO_QUOTA', '未查询到个人编程套餐额度');
  }
  windows.sort(function (a, b) { return a.order - b.order; });
  windows.forEach(function (window) { delete window.order; });
  return { provider: 'GLM', windows: windows, updatedAt: nowMs === undefined ? Date.now() : nowMs };
}

export function parseQuotaResponse(body, nowMs) {
  let payload;
  try {
    payload = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (error) {
    throw failure('INVALID_DATA', 'GLM 返回了无法读取的数据');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw failure('INVALID_DATA', 'GLM 返回的数据格式无法识别');
  }
  const code = numeric(payload.code === undefined && payload.error ? payload.error.code : payload.code);
  if (payload.error || payload.success === false || (code !== null && code !== 0 && code !== 200)) {
    if (code === 401 || code === 403 || code === 1000 || code === 1001 || code === 1002 || code === 1003 || code === 1004) {
      throw failure('AUTH', 'GLM Key 无效或无查询权限');
    }
    if (code === 429) throw failure('RATE_LIMIT', '查询过于频繁，请稍后刷新');
    throw failure('API_ERROR', 'GLM 暂时无法返回额度，请稍后刷新');
  }
  return normalizeQuota(payload, nowMs);
}

export function formatReset(resetAt, nowMs) {
  const reset = numeric(resetAt);
  if (reset === null || reset <= 0 || reset > 8640000000000000) return '重置时间未知';
  const now = nowMs === undefined ? Date.now() : nowMs;
  const minutes = Math.ceil((reset - now) / 60000);
  if (minutes <= 0) return '等待额度更新';
  if (minutes < 60) return minutes + ' 分钟后重置';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return hours + ' 小时' + (rest ? ' ' + rest + ' 分钟' : '') + '后重置';
  const days = Math.floor(hours / 24);
  return days + ' 天' + (hours % 24 ? ' ' + hours % 24 + ' 小时' : '') + '后重置';
}
