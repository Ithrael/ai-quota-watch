export const nativeFetch = {
  fetch(options) {
    if (window.simulateOffline) { setTimeout(() => options.fail(), 300); return; }
    const id = options.header.Authorization.split('local-preview-')[1];
    const kind = options.url.includes('/customer-package-reset/list') ? 'resets' : 'quota';
    const path = '/api/' + encodeURIComponent(id) + '/' + kind;
    window.fetch(path, { signal: AbortSignal.timeout(18000) })
      .then(async response => options.success({ code: response.status, data: await response.text() }))
      .catch(() => options.fail());
  }
};
export const nativeStorage = {
  get(options) {
    setTimeout(() => {
      try { options.success(localStorage.getItem(options.key) || ''); } catch { options.fail?.(); }
    }, 0);
  },
  set(options) {
    try { localStorage.setItem(options.key, options.value); } catch { options.fail?.(); }
  }
};
