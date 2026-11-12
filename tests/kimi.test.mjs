import test from 'node:test';
import assert from 'node:assert/strict';
import { kimiRequest, parseKimiResponse } from '../src/kimi.js';

const row = ratio => ({ used_ratio: ratio, reset_time: '2026-12-01T00:00:00Z' });

test('Kimi reads only the official plan endpoint using Bearer authorization', () => {
  const request = kimiRequest(' test-key ');
  assert.equal(request.url, 'https://api.kimi.com/coding/v1/usages');
  assert.equal(request.method, 'GET');
  assert.equal(request.header.Authorization, 'Bearer test-key');
  assert.throws(() => kimiRequest('bad\r\nkey'));
});

test('Kimi keeps only the 5-hour and weekly quota windows', () => {
  const result = parseKimiResponse({ usages: {
    limit_5h: row(0.2), limit_7d: row(0.6), limit_month_total: row(0.75), limit_month_code: row(0.5)
  } }, 123);
  assert.deepEqual(result.windows.map(item => [item.label, item.remainingPercent]), [
    ['5 小时', 80], ['每周', 40]
  ]);
  assert.equal(result.updatedAt, 123);
  assert.equal(result.windows[1].resetAt, Date.parse('2026-12-01T00:00:00Z'));
});

test('unrelated monthly metadata never becomes a displayed quota window', () => {
  const result = parseKimiResponse({ usages: { limit_5h: row(1), limit_month_code: row(0) } });
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].remainingPercent, 0);
});

test('invalid Kimi ratios cannot become a full or negative allowance', () => {
  for (const ratio of [undefined, null, '', ' ', -1, 1.1, 'invalid']) {
    assert.throws(() => parseKimiResponse({ usages: { limit_5h: row(ratio) } }), { code: 'NO_QUOTA' });
  }
  assert.equal(parseKimiResponse({ usages: { limit_5h: row(0) } }).windows[0].remainingPercent, 100);
});

test('detailed Kimi counters override stale zero ratios without changing period identity', () => {
  const result = parseKimiResponse({
    usage: { limit: '100', used: '29', resetTime: '2026-12-01T00:00:00Z' },
    limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '88' } }],
    usages: { limit_5h: row(0), limit_7d: row(0) }
  });
  assert.equal(Math.round(result.windows[0].remainingPercent), 12);
  assert.equal(Math.round(result.windows[1].remainingPercent), 71);
});

test('Kimi business errors and invalid bodies never leak upstream text', () => {
  for (const body of [null, [], 'invalid', { error: { message: 'secret-key' } }, { code: 401 }]) {
    assert.throws(() => parseKimiResponse(body), error => !error.message.includes('secret-key'));
  }
});

test('Kimi microsecond timestamps retain their reset instant on the watch engine', () => {
  const result = parseKimiResponse({ usages: { limit_5h: { used_ratio: 0.5, reset_time: '2026-12-01T00:00:00.471957Z' } } });
  assert.equal(result.windows[0].resetAt, Date.parse('2026-12-01T00:00:00.471Z'));
});
