import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseQuotaResponse, quotaRequest, resetRequest, parseResetResponse, formatReset } from '../src/glm.js';
import { kimiRequest, parseKimiResponse } from '../src/kimi.js';

const key = 'watch-test-key';
const now = Date.now();
const source = fs.readFileSync(new URL('../entry/src/main/js/MainAbility/pages/index/index.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export default {', 'globalThis.pageOptions = {');
const cached = JSON.stringify([3, now - 600000, [50, now + 3600000, 28000], [20, now + 86400000, 140000], null]);

function credit(unit = 3, percentage = 68) {
  return { type: 'CREDIT_LIMIT', unit, number: unit === 3 ? 5 : 1, percentage,
    usage: unit === 3 ? 28000 : 140000, nextResetTime: now + (unit === 3 ? 3600000 : 86400000) };
}
function success(percentage = 68, limits = [credit(3, percentage), credit(6, 66)]) {
  return { code: 200, data: { success: true, code: 200, data: { limits } } };
}
function resetSuccess(data = { fiveHourResets: [], weekResets: [] }) {
  return { code: 200, data: { success: true, code: 200, data } };
}

function createPage() {
  const requests = [];
  const saved = [];
  const cacheKeys = [];
  const savedKeys = [];
  const timers = new Map();
  const cacheCallbacks = [];
  let cacheCallback;
  let timerId = 0;
  const context = vm.createContext({
    ACCOUNTS: [{ id: 'glm-1', provider: 'GLM', key }, { id: 'glm-2', provider: 'GLM', key: 'other-glm-key' }, { id: 'kimi', provider: 'Kimi', key: 'kimi-test-key' }],
    parseQuotaResponse, quotaRequest, resetRequest, parseResetResponse, formatReset, kimiRequest, parseKimiResponse,
    fetch: { fetch: options => requests.push(options) },
    storage: {
      get: options => { cacheKeys.push(options.key); cacheCallback = options.success; cacheCallbacks.push(options.success); },
      set: options => { savedKeys.push(options.key); saved.push(options.value); }
    },
    setTimeout: (callback, delay) => { callback.delay = delay; timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id)
  });
  // The watch's JerryScript build omits String.replace along with RegExp.
  vm.runInContext('delete String.prototype.replace;', context);
  vm.runInContext(source, context);
  const page = { ...context.pageOptions, ...context.pageOptions.data };
  page.onInit();
  const next = () => {
    for (const [id, callback] of timers) {
      if (callback.delay !== 100) continue;
      timers.delete(id);
      callback();
      break;
    }
  };
  return { page, requests, saved, timers, cacheKeys, savedKeys, cacheCallbacks, next, loadCache: value => cacheCallback(value) };
}

test('refresh clicks do not duplicate either request and both quotas appear immediately', () => {
  const h = createPage();
  h.page.refresh();
  h.page.refresh();
  assert.equal(h.requests.length, 1);
  h.requests[0].success(success());
  assert.equal(h.page.fiveHourPercentText, '32%');
  assert.equal(h.page.weeklyPercentText, '34%');
  assert.equal(h.page.fiveHourPercent, 32);
  assert.equal(h.page.weeklyPercent, 34);
  assert.match(h.page.fiveHourDetail, /2\.8万积分/);
  assert.match(h.page.weeklyDetail, /14万积分/);
  assert.equal(h.page.refreshing, true);
  assert.equal(h.requests.length, 1);
  h.next();
  assert.equal(h.requests.length, 2);
  h.requests[1].success(resetSuccess());
  assert.equal(h.page.refreshing, false);
  assert.equal(h.timers.size, 0);
});

test('both cached windows are marked stale and never overwrite a live result', () => {
  const h = createPage();
  h.loadCache(cached);
  assert.equal(h.page.fiveHourPercentText, '50%');
  assert.equal(h.page.weeklyPercentText, '20%');
  assert.equal(h.page.caption, '上次额度');
  h.requests[0].success(success());
  h.loadCache(cached);
  assert.equal(h.page.fiveHourPercentText, '32%');
  assert.equal(h.page.weeklyPercentText, '34%');
  assert.equal(h.page.caption, '剩余额度');
  const liveFirst = createPage();
  liveFirst.requests[0].success(success());
  liveFirst.loadCache(cached);
  assert.equal(liveFirst.page.fiveHourPercentText, '32%');
  assert.equal(liveFirst.page.weeklyPercentText, '34%');
});

test('a timed out request cannot overwrite or finish a newer refresh', () => {
  const h = createPage();
  h.loadCache(cached);
  h.requests[0].success(success(50));
  h.next();
  [...h.timers.values()][0]();
  assert.equal(h.page.refreshing, false);
  assert.match(h.page.statusText, /重置未获取/);
  h.page.refresh();
  h.requests[0].success(success(1));
  assert.equal(h.page.fiveHourPercentText, '50%');
  assert.equal(h.page.refreshing, true);
  h.requests[1].success(resetSuccess());
  assert.match(h.page.weeklyResetsText, /--/);
  h.requests[2].success(success());
  h.next();
  h.requests[3].success(resetSuccess());
  assert.equal(h.page.fiveHourPercentText, '32%');
  assert.equal(h.page.weeklyPercentText, '34%');
  assert.equal(h.page.refreshing, false);
});

test('destroyed pages ignore both request and cache callbacks', () => {
  const h = createPage();
  h.requests[0].success(success());
  h.next();
  h.page.onDestroy();
  const before = JSON.stringify(h.page);
  h.requests[0].success(success());
  h.requests[1].success(resetSuccess());
  h.loadCache(cached);
  assert.equal(JSON.stringify(h.page), before);
  assert.equal(h.timers.size, 0);
});

test('reentering the same pending page starts fresh requests and rejects old lifecycle callbacks', () => {
  const h = createPage();
  const oldCache = h.cacheCallbacks[0];
  h.page.onDestroy();
  h.page.onInit();
  assert.equal(h.requests.length, 2);
  assert.equal(h.page.refreshing, true);
  h.requests[0].success(success(1));
  oldCache(cached);
  assert.equal(h.page.fiveHourPercentText, '--');
  assert.equal(h.page.weeklyPercentText, '--');
  assert.match(h.page.weeklyResetsText, /--/);
  assert.equal(h.page.refreshing, true);
  h.requests[1].success(success());
  h.next();
  h.requests[2].success(resetSuccess());
  assert.equal(h.page.fiveHourPercentText, '32%');
  assert.equal(h.page.weeklyPercentText, '34%');
  assert.equal(h.page.refreshing, false);
  assert.equal(h.page.footerText, h.page.updatedText);
});

test('HTTP 401 preserves both quotas and cached values contain no credential', () => {
  const h = createPage();
  h.requests[0].success(success());
  h.next();
  h.requests[1].success(resetSuccess());
  h.page.refresh();
  h.requests[2].success({ code: 401, data: { message: key } });
  h.next();
  h.requests[3].success(resetSuccess());
  assert.equal(h.page.fiveHourPercentText, '32%');
  assert.equal(h.page.weeklyPercentText, '34%');
  assert.equal(h.page.caption, '上次额度');
  assert.match(h.page.statusText, /Key 无效/);
  assert.equal(JSON.stringify(h.page).includes(key), false);
  assert.ok(h.saved.length > 0);
  for (const value of h.saved) {
    assert.equal(value.includes(key), false);
    assert.ok(Buffer.byteLength(value, 'utf8') < 128);
  }
  const stored = JSON.parse(h.saved[0]);
  assert.equal(stored[2][0], 32);
  assert.equal(stored[3][0], 34);
});

test('both quotas stay available when reset inventory fails or times out', () => {
  for (const failReset of [h => h.requests[1].fail(), h => [...h.timers.values()][0]()]) {
    const h = createPage();
    h.requests[0].success(success());
    h.next();
    failReset(h);
    assert.equal(h.page.fiveHourPercentText, '32%');
    assert.equal(h.page.weeklyPercentText, '34%');
    assert.equal(h.page.caption, '剩余额度');
    assert.match(h.page.fiveHourResetsText, /--/);
    assert.match(h.page.weeklyResetsText, /--/);
    assert.match(h.page.statusText, /重置未获取/);
  }
});

test('reset counts remain usable when quota fails, and zero differs from unknown', () => {
  const h = createPage();
  h.requests[0].fail();
  h.next();
  h.requests[1].success(resetSuccess({ weekResets: [] }));
  assert.equal(h.page.fiveHourPercentText, '--');
  assert.equal(h.page.weeklyPercentText, '--');
  assert.match(h.page.fiveHourResetsText, /--/);
  assert.equal(h.page.weeklyResetsText, '可重置 0 次');
  assert.equal(h.page.refreshing, false);
  h.page.refresh();
  h.requests[2].success(success());
  h.next();
  h.requests[3].success(resetSuccess({
    fiveHourResets: [],
    weekResets: [{ available: true, expireTime: new Date(now + 86400000).toISOString() }]
  }));
  assert.equal(h.page.fiveHourResetsText, '可重置 0 次');
  assert.equal(h.page.weeklyResetsText, '可重置 1 次');
});

test('a delayed reset cannot start after leaving and reentering the page', () => {
  const h = createPage();
  h.requests[0].success(success());
  h.page.onDestroy();
  h.page.onInit();
  h.next();
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[1].url, /quota\/limit$/);
  h.requests[1].fail();
  h.next();
  h.requests[2].fail();
  assert.equal(h.page.refreshing, false);
  assert.doesNotMatch(h.page.statusText, /已同步/);
});

test('missing windows never borrow the other quota or a MCP value', () => {
  const onlyHour = createPage();
  onlyHour.requests[0].success(success(68, [credit()]));
  assert.equal(onlyHour.page.fiveHourPercentText, '32%');
  assert.equal(onlyHour.page.weeklyPercentText, '--');
  assert.equal(onlyHour.page.weeklyPercent, 0);
  const onlyWeek = createPage();
  onlyWeek.requests[0].success(success(68, [credit(6, 66), { ...credit(), type: 'TIME_LIMIT' }]));
  assert.equal(onlyWeek.page.fiveHourPercentText, '--');
  assert.equal(onlyWeek.page.fiveHourPercent, 0);
  assert.equal(onlyWeek.page.weeklyPercentText, '34%');
});

test('a depleted quota is zero percent while an unknown quota stays unavailable', () => {
  const h = createPage();
  h.requests[0].success(success(100, [credit(3, 100), credit(6, 0)]));
  assert.equal(h.page.fiveHourPercentText, '0%');
  assert.equal(h.page.fiveHourPercent, 0);
  assert.equal(h.page.weeklyPercentText, '100%');
});

test('damaged or old cache cannot fabricate either quota', () => {
  for (const value of ['broken', '[2,1,null,null]', JSON.stringify([2, now, [101, null, 28000], null]), JSON.stringify([1, now, '每周', 66, null])]) {
    const h = createPage();
    h.loadCache(value);
    assert.equal(h.page.fiveHourPercentText, '--');
    assert.equal(h.page.weeklyPercentText, '--');
  }
});

test('switching GLM accounts isolates keys, cached values and stale callbacks', () => {
  const h = createPage();
  const oldCache = h.cacheCallbacks[0];
  h.requests[0].success(success()); h.next(); h.requests[1].success(resetSuccess());
  h.page.selectSecond();
  assert.equal(h.page.fiveHourPercentText, '--');
  assert.equal(h.requests[2].header.Authorization, 'other-glm-key');
  assert.notEqual(h.cacheKeys[0], h.cacheKeys[1]);
  oldCache(cached);
  assert.equal(h.page.fiveHourPercentText, '--');
  h.requests[0].success(success(1));
  assert.equal(h.page.fiveHourPercentText, '--');
  h.requests[2].success(success(90)); h.next(); h.requests[3].success(resetSuccess());
  assert.equal(h.page.fiveHourPercentText, '10%');
  assert.notEqual(h.savedKeys[0], h.savedKeys[1]);
});

test('Kimi displays two quota windows and never requests GLM reset inventory', () => {
  const h = createPage();
  h.requests[0].success(success()); h.next(); h.requests[1].success(resetSuccess());
  h.page.selectKimi();
  assert.equal(h.page.isKimi, true);
  assert.equal(h.requests[2].header.Authorization, 'Bearer kimi-test-key');
  h.requests[2].success({ code: 200, data: { usages: {
    limit_5h: { used_ratio: 0.5 }, limit_7d: { used_ratio: 0.7 }, limit_month_total: { used_ratio: 0.8 }
  } } });
  h.next();
  assert.equal(h.requests.length, 3);
  assert.equal(h.page.weeklyPercentText, '30%');
  assert.equal(h.page._snapshot.windows.length, 2);
  assert.equal(h.page.refreshing, false);
  assert.equal(h.page.statusText, '已同步');
  assert.ok(h.saved.every(value => Buffer.byteLength(value) < 128));
});

test('Kimi auth failure ends refreshing and cannot show another account quota', () => {
  const h = createPage();
  h.requests[0].success(success()); h.next(); h.requests[1].success(resetSuccess());
  h.page.selectKimi();
  h.requests[2].success({ code: 401, data: {} });
  assert.equal(h.page.refreshing, false);
  assert.equal(h.page.fiveHourPercentText, '--');
  assert.match(h.page.statusText, /Kimi Code/);
});
