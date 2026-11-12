import fetch from '@system.fetch';
import storage from '@system.storage';
import { ACCOUNTS } from '../../common/local-config.js';
import { parseQuotaResponse, quotaRequest, resetRequest, parseResetResponse, formatReset } from '../../common/glm.js';
import { kimiRequest, parseKimiResponse } from '../../common/kimi.js';

const MUTED = '#7D8A95';
const ALERT = '#FF969D';

function finite(value) {
  return typeof value === 'number' && isFinite(value);
}

function percentText(value) {
  return (Math.round(value * 10) / 10) + '%';
}

function shortCount(value) {
  return value >= 10000 ? (Math.round(value / 1000) / 10) + '万' : String(value);
}

function findWindow(snapshot, label) {
  return snapshot.windows.filter(function(item) {
    return item.label === label && item.unit !== '次';
  })[0] || null;
}

function windowDetail(item) {
  if (!item) return '额度未获取';
  return finite(item.total) ? '上限' + shortCount(item.total) + item.unit : '上限未知';
}

function windowReset(item) {
  return formatReset(item ? item.resetAt : null, Date.now())
    .split(' ').join('').split('小时').join('时').split('分钟').join('分');
}

function readCachedQuota(value) {
  try {
    const row = JSON.parse(value);
    if (!Array.isArray(row) || row.length !== 5 || row[0] !== 3 ||
        !finite(row[1]) || row[1] <= 0 || row[1] > Date.now() + 60000) return null;
    const windows = [];
    for (let index = 2; index < 4; index++) {
      const item = row[index];
      if (item === null) continue;
      if (!Array.isArray(item) || item.length !== 3 ||
          !finite(item[0]) || item[0] < 0 || item[0] > 100 ||
          !(item[1] === null || (finite(item[1]) && item[1] > 0 && item[1] <= 8640000000000000)) ||
          !(item[2] === null || (finite(item[2]) && item[2] >= 0))) return null;
      windows.push({ label: index === 2 ? '5 小时' : '每周', remainingPercent: item[0],
        resetAt: item[1], total: item[2], unit: '' });
    }
    return windows.length ? { updatedAt: row[1], windows: windows } : null;
  } catch (_) {
    return null;
  }
}

export default {
  data: {
    accountIndex: 0,
    isKimi: false,
    firstTabBg: '#243744',
    secondTabBg: '#111A21',
    kimiTabBg: '#111A21',
    firstTabColor: '#EDF3F7',
    secondTabColor: '#8193A0',
    kimiTabColor: '#8193A0',
    fiveHourPercent: 0,
    weeklyPercent: 0,
    fiveHourPercentText: '--',
    weeklyPercentText: '--',
    fiveHourDetail: '额度未获取',
    weeklyDetail: '额度未获取',
    fiveHourResetText: '重置时间未知',
    weeklyResetText: '重置时间未知',
    caption: '剩余额度',
    fiveHourResetsText: '可重置 --',
    weeklyResetsText: '可重置 --',
    updatedText: '未更新',
    statusText: '正在获取额度…',
    footerText: '正在获取额度…',
    statusColor: MUTED,
    buttonText: '刷新',
    refreshing: false
  },

  onInit() {
    this._alive = true;
    this._requestId = (this._requestId || 0) + 1;
    this._lifecycleId = (this._lifecycleId || 0) + 1;
    this.refreshing = false;
    this.buttonText = '刷新';
    this._timer = null;
    this._snapshot = null;
    this._hasLive = false;
    this._lastError = '';
    this._pending = { quota: false, resets: false };
    this._errors = { quota: '', resets: '' };
    this.loadCache();
    this.refresh();
  },

  account() { return ACCOUNTS[this.accountIndex]; },

  cacheKey() { return 'aihud-' + this.account().id + '-v3'; },

  selectFirst() { this.selectAccount(0); },
  selectSecond() { this.selectAccount(1); },
  selectKimi() { this.selectAccount(2); },

  selectAccount(index) {
    if (index === this.accountIndex) return;
    if (this.refreshing) {
      this.showStatus('正在刷新，请稍候', MUTED);
      return;
    }
    this.accountIndex = index;
    this.isKimi = this.account().provider === 'Kimi';
    this.firstTabBg = index === 0 ? '#243744' : '#111A21';
    this.secondTabBg = index === 1 ? '#243744' : '#111A21';
    this.kimiTabBg = index === 2 ? '#34304A' : '#111A21';
    this.firstTabColor = index === 0 ? '#EDF3F7' : '#8193A0';
    this.secondTabColor = index === 1 ? '#EDF3F7' : '#8193A0';
    this.kimiTabColor = index === 2 ? '#E0DAFF' : '#8193A0';
    this._lifecycleId += 1;
    this._snapshot = null;
    this._hasLive = false;
    this._lastError = '';
    this.fiveHourPercent = this.weeklyPercent = 0;
    this.fiveHourPercentText = this.weeklyPercentText = '--';
    this.fiveHourDetail = this.weeklyDetail = '额度未获取';
    this.fiveHourResetText = this.weeklyResetText = '额度未获取';
    this.fiveHourResetsText = this.weeklyResetsText = '可重置 --';
    this.updatedText = '未更新';
    this.caption = '剩余额度';
    this.loadCache();
    this.refresh();
  },

  onDestroy() {
    this._alive = false;
    this._requestId += 1;
    clearTimeout(this._timer);
  },

  loadCache() {
    const page = this;
    const lifecycleId = this._lifecycleId;
    try {
      storage.get({
        key: this.cacheKey(),
        success(value) {
          if (!page._alive || lifecycleId !== page._lifecycleId || page._hasLive) return;
          const cached = readCachedQuota(value);
          if (!cached) return;
          page._snapshot = cached;
          page.renderQuotas();
          if (!page.refreshing) page.showStatus(page._lastError || '上次数据，点刷新更新', ALERT);
        },
        fail() {}
      });
    } catch (_) {}
  },

  saveCache() {
    const compact = function(item) { return item ? [item.remainingPercent, item.resetAt, item.total] : null; };
    const value = JSON.stringify([3, this._snapshot.updatedAt,
      compact(findWindow(this._snapshot, '5 小时')), compact(findWindow(this._snapshot, '每周')), null]);
    // Keep the v3 cache shape so existing two-window snapshots remain readable.
    // Lite storage values must stay below 128 bytes. Cache both quota windows, never the key.
    // This compact JSON contains only numbers, null and ASCII punctuation.
    if (value.length >= 128) return;
    try {
      storage.set({ key: this.cacheKey(), value, fail() {} });
    } catch (_) {}
  },

  renderQuotas() {
    if (!this._snapshot) return;
    const fiveHour = findWindow(this._snapshot, '5 小时');
    const weekly = findWindow(this._snapshot, '每周');
    this.fiveHourPercent = fiveHour ? fiveHour.remainingPercent : 0;
    this.weeklyPercent = weekly ? weekly.remainingPercent : 0;
    this.fiveHourPercentText = fiveHour ? percentText(fiveHour.remainingPercent) : '--';
    this.weeklyPercentText = weekly ? percentText(weekly.remainingPercent) : '--';
    this.fiveHourDetail = windowDetail(fiveHour);
    this.weeklyDetail = windowDetail(weekly);
    this.fiveHourResetText = windowReset(fiveHour);
    this.weeklyResetText = windowReset(weekly);
    this.caption = this._hasLive && !this._lastError ? '剩余额度' : '上次额度';
    const time = new Date(this._snapshot.updatedAt);
    const today = new Date();
    const day = time.getFullYear() === today.getFullYear() &&
      time.getMonth() === today.getMonth() && time.getDate() === today.getDate()
      ? '' : (time.getMonth() + 1) + '/' + time.getDate() + ' ';
    const hours = ('0' + time.getHours()).slice(-2);
    const minutes = ('0' + time.getMinutes()).slice(-2);
    this.updatedText = day + hours + ':' + minutes + ' 更新';
  },

  showStatus(text, color) {
    this.statusText = text;
    this.footerText = text === '已同步' ? this.updatedText : text;
    this.statusColor = color;
  },

  isPending(id, kind) {
    return this._alive && id === this._requestId && this.refreshing && this._pending[kind];
  },

  finishPart(id, kind, result, message) {
    if (!this.isPending(id, kind)) return;
    this._pending[kind] = false;
    this._errors[kind] = message || '';
    if (kind === 'quota') {
      if (result) {
        this._snapshot = result;
        this._hasLive = true;
        this._lastError = '';
        this.renderQuotas();
        this.saveCache();
      } else {
        this._lastError = message;
        this.renderQuotas();
      }
    } else if (result) {
      this.fiveHourResetsText = '可重置 ' + (result.fiveHour === null ? '--' : result.fiveHour + ' 次');
      this.weeklyResetsText = '可重置 ' + (result.weekly === null ? '--' : result.weekly + ' 次');
    }
    if (!this._pending.quota && !this._pending.resets) {
      clearTimeout(this._timer);
      this.refreshing = false;
      this.buttonText = '刷新';
    }
    const error = this._errors.quota || (!this._pending.quota && this._errors.resets ? '额度已同步，重置未获取' : '');
    this.showStatus(error || (this._pending.quota ? '正在获取额度…' :
      this._pending.resets ? '额度已同步，重置获取中' : '已同步'), error ? ALERT : MUTED);
    console.log('[aihud] completed ' + kind + ' ok=' + !!result);
    if (kind === 'quota' && this._pending.resets) {
      const page = this;
      // Let the native fetch callback return before starting the next request.
      setTimeout(function() {
        if (page.isPending(id, 'resets')) page.requestPart(id, 'resets');
      }, 100);
    }
  },

  requestPart(id, kind) {
    const page = this;
    try {
      const account = this.account();
      const options = account.provider === 'Kimi' ? kimiRequest(account.key) :
        kind === 'quota' ? quotaRequest(account.key) : resetRequest(account.key);
      options.success = function(response) {
        console.log('[aihud] response ' + kind + ' code=' + Number(response.code));
        if (!page.isPending(id, kind)) return;
        const code = Number(response.code);
        if (code < 200 || code >= 300 || !isFinite(code)) {
          const message = code === 401 || code === 403 ?
            (account.provider === 'Kimi' ? '请更换 Kimi Code 套餐 Key' : 'Key 无效或无查询权限') :
            code === 429 ? '查询过于频繁，请稍后刷新' : '平台暂不可用，请稍后刷新';
          page.finishPart(id, kind, null, message);
          return;
        }
        try {
          const result = account.provider === 'Kimi' ? parseKimiResponse(response.data, Date.now()) :
            kind === 'quota' ? parseQuotaResponse(response.data, Date.now()) :
            parseResetResponse(response.data, Date.now());
          page.finishPart(id, kind, result, '');
        } catch (error) {
          const code = error && error.code;
          const message = code === 'AUTH' ? 'Key 无效或无查询权限' :
            code === 'NO_QUOTA' ? '未查到编程套餐额度' :
            code === 'RATE_LIMIT' ? '查询过于频繁，请稍后刷新' : '平台数据异常，请重试';
          page.finishPart(id, kind, null, message);
        }
      };
      options.fail = function(_, code) {
        console.log('[aihud] failed ' + kind + ' code=' + Number(code));
        page.finishPart(id, kind, null, '请检查运动健康连接');
      };
      fetch.fetch(options);
    } catch (_) {
      this.finishPart(id, kind, null, '请检查运动健康连接');
    }
  },

  refresh() {
    if (!this._alive || this.refreshing) return;
    if (!this.account().key) {
      this._lastError = '请先配置 ' + this.account().provider + ' Key';
      this.showStatus(this._lastError, ALERT);
      return;
    }
    const page = this;
    const id = ++this._requestId;
    this._pending = { quota: true, resets: !this.isKimi };
    this._errors = { quota: '', resets: '' };
    this.fiveHourResetsText = '可重置 --';
    this.weeklyResetsText = '可重置 --';
    this.refreshing = true;
    this.buttonText = '刷新中…';
    this.showStatus('正在获取额度…', MUTED);
    this._timer = setTimeout(function() {
      page.finishPart(id, 'quota', null, '请求超时，请检查连接');
      page.finishPart(id, 'resets', null, '请求超时，请检查连接');
    }, 20000);
    this.requestPart(id, 'quota');
  }
};
