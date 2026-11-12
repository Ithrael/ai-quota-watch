import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const adb = process.env.ADB || 'adb';
const hap = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../entry/build/default/outputs/default/entry-default-signed.hap', import.meta.url));
const env = { ...process.env, ...(process.platform === 'darwin' ? { ADB_LIBUSB: process.env.ADB_LIBUSB || '1' } : {}) };
const run = args => execFileSync(adb, args, { env, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await access(hap);
  const devices = run(['devices']).split('\n').map(line => line.trim().split(/\s+/)).filter(([, state]) => state === 'device').map(([serial]) => serial);
  const serial = process.env.ANDROID_SERIAL || (devices.length === 1 ? devices[0] : '');
  if (!serial || !devices.includes(serial)) throw new Error('请连接并授权一台华为手机；多设备时设置 ANDROID_SERIAL。');
  const phone = args => run(['-s', serial, ...args]);
  const packages = phone(['shell', 'pm', 'list', 'packages', 'com.huawei.deveco.assistant']);
  if (!packages.split(/\r?\n/).some(line => line.trim() === 'package:com.huawei.deveco.assistant')) throw new Error('手机未安装应用调测助手，请先从华为应用市场安装。');
  phone(['shell', 'mkdir', '-p', '/sdcard/haps']);
  phone(['push', hap, '/sdcard/haps/ai-quota-watch.hap']);
  phone(['shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', 'com.huawei.deveco.assistant']);
  console.log('HAP 已复制至手机 /sdcard/haps/ai-quota-watch.hap，已请求打开应用调测助手。');
  console.log('接下来在助手的“应用管理”选择该 HAP 安装到配对手表，并核对安装日志。传到手机不代表已安装到手表。');
} catch (error) {
  console.error(error.code === 'ENOENT' ? '缺少已签名 HAP 或 adb；请先构建签名，并安装 Android Platform Tools。' :
    error.status !== undefined ? 'ADB 操作失败，请检查 USB 调试授权、连接及应用调测助手。' : error.message);
  process.exitCode = 1;
}
