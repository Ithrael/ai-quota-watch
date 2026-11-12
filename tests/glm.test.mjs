import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuota, parseQuotaResponse, quotaRequest, formatReset, resetRequest, parseResetResponse } from '../src/glm.js';

const now = Date.UTC(2026, 10, 11, 10);
function credit(overrides = {}) {
  return { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 28000, currentValue: 19040, percentage: 68, nextResetTime: now + 3600000, ...overrides };
}
function response(limits) { return { success: true, code: 200, data: { limits } }; }

test('credit windows preserve the provider percentage and sort 5h before weekly', () => {
  const result = parseQuotaResponse(response([credit({ unit: 6, number: 1, usage: 140000, currentValue: 93514, percentage: 66 }), credit()]), now);
  assert.equal(result.provider, 'GLM');
  assert.equal(result.updatedAt, now);
  assert.deepEqual(result.windows.map(w => w.label), ['5 小时', '每周']);
  assert.equal(result.windows[0].remainingPercent, 32);
  assert.equal(result.windows[1].usedPercent, 66);
  assert.equal(result.windows[0].unit, '积分');
  assert.equal(result.windows[0].resetAt, now + 3600000);
  assert.equal(result.windows[0].total, 28000);
});

test('explicit zero usage remains zero rather than unavailable', () => {
  const window = normalizeQuota({ limits: [credit({ percentage: 0, currentValue: 0 })] }, now).windows[0];
  assert.equal(window.usedPercent, 0);
  assert.equal(window.remainingPercent, 100);
  assert.equal(window.used, 0);
});

test('token and monthly MCP quotas retain distinct units and labels', () => {
  const result = parseQuotaResponse(JSON.stringify(response([credit({ type: 'TOKENS_LIMIT' }), credit({ type: 'TIME_LIMIT', unit: 5, number: 1, usage: 100, currentValue: 3, percentage: 3 })])), now);
  assert.equal(result.windows[0].unit, 'Token');
  assert.equal(result.windows[1].unit, '次');
  assert.equal(result.windows[1].label, 'MCP 月度');
});

test('unknown time units keep their quota without inventing a window duration', () => {
  const result = parseQuotaResponse(response([credit({ unit: 1 }), credit({ unit: 5 }), credit({ unit: 99 })]), now);
  assert.deepEqual(result.windows.map(w => w.label), ['套餐额度', '套餐额度', '套餐额度']);
  assert.deepEqual(result.windows.map(w => w.remainingPercent), [32, 32, 32]);
});

test('missing percentage derives from valid counters without inventing missing totals', () => {
  const first = parseQuotaResponse(response([credit({ percentage: undefined, usage: 100, currentValue: 25 })]), now).windows[0];
  assert.equal(first.remainingPercent, 75);
  const second = parseQuotaResponse(response([credit({ usage: undefined, currentValue: undefined, percentage: 40 })]), now).windows[0];
  assert.equal(second.used, null);
  assert.equal(second.total, null);
});

test('remaining counter can provide usage when currentValue is absent', () => {
  const window = parseQuotaResponse(response([credit({ usage: 100, currentValue: undefined, percentage: undefined, remaining: 75 })]), now).windows[0];
  assert.equal(window.used, 25);
  assert.equal(window.remainingPercent, 75);
});

test('empty, unknown, missing and out-of-range quota data never becomes 0% used', () => {
  for (const limits of [[], [credit({ type: 'UNKNOWN' })], [credit({ percentage: undefined, usage: undefined, currentValue: undefined })], [credit({ percentage: -1 })], [credit({ percentage: 101 })], [credit({ percentage: Infinity })]]) {
    assert.throws(() => parseQuotaResponse(response(limits), now), { code: 'NO_QUOTA' });
  }
});

test('invalid JSON and payloads use fixed error messages without reflecting response text', () => {
  for (const body of ['sensitive-value', null, [], { data: {} }]) {
    assert.throws(() => parseQuotaResponse(body, now), error => error.code === 'INVALID_DATA' && !error.message.includes('sensitive-value'));
  }
});

test('business authentication errors and failures cannot display quota as successful', () => {
  assert.throws(() => parseQuotaResponse({ ...response([credit()]), code: 401, msg: 'do-not-reflect' }), error => error.code === 'AUTH' && !error.message.includes('do-not-reflect'));
  assert.throws(() => parseQuotaResponse({ ...response([credit()]), code: '1002' }), { code: 'AUTH' });
  assert.throws(() => parseQuotaResponse({ ...response([credit()]), success: false }), { code: 'API_ERROR' });
  assert.throws(() => parseQuotaResponse({ code: 429, success: false }), { code: 'RATE_LIMIT' });
  assert.throws(() => parseQuotaResponse({ error: { code: '1002' } }), { code: 'AUTH' });
});

test('quota request is read-only and fixed to the official domestic endpoint', () => {
  const request = quotaRequest(' fixture-key ');
  assert.equal(request.url, 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
  assert.equal(request.header.Authorization, 'fixture-key');
  assert.equal(request.method, 'GET');
  assert.equal(request.responseType, 'json');
  for (const key of ['', null, 'a\nb']) assert.throws(() => quotaRequest(key), { code: 'KEY_REQUIRED' });
});

test('reset times are explicit, do not fabricate a timezone correction, and handle elapsed limits', () => {
  assert.equal(formatReset(null, now), '重置时间未知');
  assert.equal(formatReset(now - 1, now), '等待额度更新');
  assert.equal(formatReset(now + 1, now), '1 分钟后重置');
  assert.equal(formatReset(now + 3660000, now), '1 小时 1 分钟后重置');
  assert.equal(formatReset(now + 176400000, now), '2 天 1 小时后重置');
});

function resetResponse(data) { return { success: true, code: 200, data }; }

test('reset inventory counts only available and unexpired cards in the matching buckets', () => {
  const result = parseResetResponse(resetResponse({
    targetType: 'PERSONAL',
    fiveHourResets: [
      { available: true, expireTime: '2026-11-12 23:59:59' },
      { available: false, expireTime: '2026-12-01 23:59:59' },
      { available: true, expireTime: '2026-11-10 23:59:59' }
    ],
    weekResets: [
      { available: true, expireTime: '2026-12-22 23:59:59' },
      { available: true, expireTime: '2026-12-22 23:59:59' },
      { available: true, expireTime: '2026-11-11 18:00:00' }
    ],
    unknownResets: [{ available: true, expireTime: '2026-12-22 23:59:59' }]
  }), now);
  assert.deepEqual(result, { fiveHour: 1, weekly: 2, updatedAt: now });
});

test('an explicitly empty reset list is zero, while an absent bucket stays unavailable', () => {
  assert.deepEqual(parseResetResponse(JSON.stringify(resetResponse({ fiveHourResets: [], weekResets: [] })), now), { fiveHour: 0, weekly: 0, updatedAt: now });
  assert.deepEqual(parseResetResponse(resetResponse({ weekResets: [] }), now), { fiveHour: null, weekly: 0, updatedAt: now });
});

test('unreadable availability or expiry cannot be misreported as zero resets', () => {
  for (const record of [{ available: 'true', expireTime: '2026-12-22 23:59:59' }, { available: true, expireTime: 'unknown' }, { available: true }, null]) {
    assert.equal(parseResetResponse(resetResponse({ fiveHourResets: [record], weekResets: [] }), now).fiveHour, null);
  }
  assert.equal(parseResetResponse(resetResponse({ fiveHourResets: [{ available: false }], weekResets: [] }), now).fiveHour, 0);
});

test('domestic expiry dates use UTC+8, and explicit offsets retain their meaning', () => {
  const result = parseResetResponse(resetResponse({
    fiveHourResets: [
      { available: true, expireTime: '2026-11-11 18:00:00' },
      { available: true, expireTime: '2026-11-11 18:00:01' }
    ],
    weekResets: [
      { available: true, expireTime: '2026-11-11T10:00:00Z' },
      { available: true, expireTime: '2026-11-11T18:00:01+08:00' }
    ]
  }), now);
  assert.equal(result.fiveHour, 1);
  assert.equal(result.weekly, 1);
});

test('unknown reset schemas, other plan types and business errors fail without reflecting response text', () => {
  for (const body of ['sensitive-value', { success: true, data: { resets: [] } }, resetResponse({ targetType: 'TEAM', fiveHourResets: [], weekResets: [] })]) {
    assert.throws(() => parseResetResponse(body, now), error => error.code === 'INVALID_DATA' && !error.message.includes('sensitive-value'));
  }
  assert.throws(() => parseResetResponse({ success: false, code: 401, msg: 'sensitive-value' }, now), { code: 'AUTH' });
  assert.throws(() => parseResetResponse({ success: false, code: 500, msg: 'sensitive-value' }, now), error => error.code === 'API_ERROR' && !error.message.includes('sensitive-value'));
});

test('reset request only reads personal inventory from the official endpoint', () => {
  const request = resetRequest('fixture-key');
  assert.equal(request.url, 'https://open.bigmodel.cn/api/biz/customer-package-reset/list?targetType=PERSONAL');
  assert.equal(request.method, 'GET');
  assert.equal(request.header.Authorization, 'fixture-key');
  assert.equal(request.responseType, 'json');
  assert.equal(request.data, undefined);
});
