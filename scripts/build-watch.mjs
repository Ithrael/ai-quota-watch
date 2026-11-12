import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawn } from 'node:child_process';
import { prepareWatch } from './prepare-watch.mjs';

const candidates = [
  process.env.HVIGORW,
  process.env.DEVECO_SDK_HOME && join(process.env.DEVECO_SDK_HOME, 'command-line-tools/bin/hvigorw'),
  '/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw',
  ...process.env.PATH.split(delimiter).map(path => join(path, 'hvigorw'))
].filter(Boolean);
let executable;
for (const candidate of candidates) {
  try { await access(candidate, constants.X_OK); executable = candidate; break; } catch {}
}
if (!executable) {
  console.error('未找到华为 hvigorw / SDK，尚未构建 HAP。');
  console.error('安装 DevEco Studio 26 或配套 Command Line Tools，将 hvigorw 加入 PATH，或设置 HVIGORW 为其完整路径。');
  console.error('官方下载：https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos');
  process.exitCode = 1;
} else {
  await prepareWatch();
  const child = spawn(executable, ['--mode', 'module', '-p', 'module=entry@default', '-p', 'product=default',
    '-p', 'buildMode=debug', 'clean', 'assembleHap', '--no-daemon'], { stdio: 'inherit' });
  child.on('error', () => { console.error('无法运行华为构建工具。'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
