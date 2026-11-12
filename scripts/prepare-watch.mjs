import { readFile, writeFile, mkdir, copyFile, chmod } from 'node:fs/promises';

export async function readAccounts() {
  const accounts = [
    { id: 'glm-1', label: 'GLM 1', provider: 'GLM', file: 'glm-api-key', env: 'GLM_API_KEY' },
    { id: 'glm-2', label: 'GLM 2', provider: 'GLM', file: 'glm-api-key-2', env: 'GLM_API_KEY_2' },
    { id: 'kimi', label: 'Kimi', provider: 'Kimi', file: 'kimi-api-key', env: 'KIMI_API_KEY' }
  ];
  for (const account of accounts) {
    let key = process.env[account.env] || '';
    if (!key) {
      try { key = await readFile(new URL('../.secrets/' + account.file, import.meta.url), 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    key = key.trim();
    if (key && (key.length > 2000 || /[\r\n]/.test(key))) throw new Error('本机 Key 格式无效');
    account.key = key;
    delete account.file;
    delete account.env;
  }
  return accounts;
}

export async function prepareWatch() {
  const accounts = await readAccounts();
  const common = new URL('../entry/src/main/js/MainAbility/common/', import.meta.url);
  await mkdir(common, { recursive: true });
  await copyFile(new URL('../src/glm.js', import.meta.url), new URL('glm.js', common));
  await copyFile(new URL('../src/kimi.js', import.meta.url), new URL('kimi.js', common));
  const config = new URL('local-config.js', common);
  await writeFile(config, '// Generated locally; excluded from git. Debug HAP contains this key.\n' +
    'export const ACCOUNTS = ' + JSON.stringify(accounts) + ';\n', { mode: 0o600 });
  await chmod(config, 0o600);
  console.log('三个账号的手表本机配置已生成，Key 未输出。');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  prepareWatch().catch(() => { console.error('生成手表配置失败，请检查本机 Key 文件。'); process.exitCode = 1; });
}
