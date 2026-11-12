import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { quotaRequest, resetRequest } from '../src/glm.js';
import { kimiRequest } from '../src/kimi.js';
import { readAccounts } from './prepare-watch.mjs';

const base = new URL('../', import.meta.url);
const pagePath = 'entry/src/main/js/MainAbility/pages/index/index';
const files = {
  '/': ['preview/index.html', 'text/html'],
  '/preview/style.css': ['preview/style.css', 'text/css'],
  '/preview/app.js': ['preview/app.js', 'text/javascript'],
  '/preview/native.js': ['preview/native.js', 'text/javascript'],
  '/src/glm.js': ['src/glm.js', 'text/javascript'],
  '/src/kimi.js': ['src/kimi.js', 'text/javascript'],
  '/watch.css': [pagePath + '.css', 'text/css'],
  '/watch.hml': [pagePath + '.hml', 'text/plain']
};
const cache = {};
const pending = {};
async function getData(id, kind) {
  const cacheKey = id + '/' + kind;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].at < 15000) return cache[cacheKey];
  if (pending[cacheKey]) return pending[cacheKey];
  pending[cacheKey] = (async () => {
    const account = (await readAccounts()).find(item => item.id === id);
    if (!account || (account.provider === 'Kimi' && kind !== 'quota')) throw new Error('Unknown query');
    const options = account.provider === 'Kimi' ? kimiRequest(account.key) :
      kind === 'resets' ? resetRequest(account.key) : quotaRequest(account.key);
    const response = await fetch(options.url, { headers: options.header, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { code: response.status, body: JSON.stringify({ success: false, code: response.status }) };
    const payload = await response.json();
    if (account.provider === 'Kimi') {
      const result = { at: Date.now(), code: 200, body: JSON.stringify({
        usages: payload.usages, usage: payload.usage, limits: payload.limits,
        code: payload.code, error: payload.error ? { type: 'upstream_error' } : undefined
      }) };
      if (!payload.error) cache[cacheKey] = result;
      return result;
    }
    let data = { limits: payload.data?.limits };
    if (kind === 'resets') {
      const minimal = rows => Array.isArray(rows) ? rows.map(row => row && ({ available: row.available, expireTime: row.expireTime })) : undefined;
      data = { targetType: payload.data?.targetType, fiveHourResets: minimal(payload.data?.fiveHourResets), weekResets: minimal(payload.data?.weekResets) };
    }
    const result = { at: Date.now(), code: 200, body: JSON.stringify({ success: payload.success, code: payload.code, data }) };
    if (payload.success !== false && (kind === 'quota' ? Array.isArray(data.limits) : Array.isArray(data.fiveHourResets) && Array.isArray(data.weekResets))) cache[cacheKey] = result;
    return result;
  })().finally(() => { delete pending[cacheKey]; });
  return pending[cacheKey];
}

const port = Number(process.env.PORT || 4173);
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  // Keep the credential-bearing bridge local and reject cross-origin / DNS-rebinding requests.
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host) ||
      (request.headers.origin && !origins.includes(request.headers.origin))) {
    response.writeHead(403).end(); return;
  }
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  const pathname = new URL(request.url, origins[0]).pathname;
  try {
    if (/^\/api\/(glm-1|glm-2|kimi)\/(quota|resets)$/.test(pathname)) {
      const [, , id, kind] = pathname.split('/');
      const result = await getData(id, kind);
      response.writeHead(result.code, { 'Content-Type': 'application/json' }).end(result.body);
    } else if (pathname === '/watch-entry.js') {
      let source = await readFile(new URL(pagePath + '.js', base), 'utf8');
      source = source.replace("import fetch from '@system.fetch';", "import { nativeFetch as fetch } from '/preview/native.js';")
        .replace("import storage from '@system.storage';", "import { nativeStorage as storage } from '/preview/native.js';")
        .replace("import { ACCOUNTS } from '../../common/local-config.js';", 'const ACCOUNTS = ' +
          JSON.stringify((await readAccounts()).map(({id, label, provider}) => ({id, label, provider, key: 'local-preview-' + id}))) + ';')
        .replace("'../../common/glm.js'", "'/src/glm.js'")
        .replace("'../../common/kimi.js'", "'/src/kimi.js'");
      response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(source);
    } else if (files[pathname]) {
      const [path, type] = files[pathname];
      response.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(await readFile(new URL(path, base)));
    } else response.writeHead(404).end();
  } catch {
    response.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: false, code: 502 }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`本地预览：http://127.0.0.1:${port}（仅本机访问，Key 不发送到浏览器）`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已占用，请设置 PORT 后重试。' : '本地预览启动失败。'); process.exitCode = 1; });
