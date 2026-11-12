import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const script = fileURLToPath(new URL('../scripts/push-phone.mjs', import.meta.url));
function fixture(t, devices, serial = '', installed = true) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-quota-adb-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const adb = join(dir, 'adb.mjs'), log = join(dir, 'calls.jsonl'), hap = join(dir, 'test.hap');
  writeFileSync(hap, 'test fixture; not an installable HAP');
  writeFileSync(adb, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_ADB_LOG, JSON.stringify(args)+'\\n');
if(args[0]==='devices') process.stdout.write('List of devices attached\\n'+process.env.FAKE_ADB_DEVICES);
if(args.includes('packages') && process.env.FAKE_ASSISTANT==='1') console.log('package:com.huawei.deveco.assistant');
`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [script, hap], { encoding: 'utf8', env: {
    ...process.env, ADB: adb, ANDROID_SERIAL: serial, FAKE_ADB_LOG: log,
    FAKE_ADB_DEVICES: devices, FAKE_ASSISTANT: installed ? '1' : '0'
  } });
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  return { result, calls, hap };
}
const options = { skip: process.platform === 'win32' ? 'POSIX executable fixture' : false };
test('phone transfer refuses ambiguous or unauthorized devices without mutations', options, t => {
  for (const [devices, serial] of [['phone-a\tdevice\nphone-b\tdevice\n', ''], ['phone-a\tunauthorized\n', 'phone-a']]) {
    const { result, calls } = fixture(t, devices, serial);
    assert.equal(result.status, 1);
    assert.deepEqual(calls, [['devices']]);
  }
});
test('phone transfer checks the assistant before copying anything', options, t => {
  const { result, calls } = fixture(t, 'phone-a\tdevice\n', '', false);
  assert.equal(result.status, 1);
  assert.ok(!calls.some(args => args.includes('push') || args.includes('mkdir')));
});
test('selected phone receives the HAP; completion message still requires watch installation', options, t => {
  const { result, calls, hap } = fixture(t, 'phone-a\tdevice\nphone-b\tdevice\n', 'phone-b');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(calls.slice(1).every(args => args[0] === '-s' && args[1] === 'phone-b'));
  assert.ok(calls.some(args => args.includes('push') && args.includes(hap) && args.includes('/sdcard/haps/ai-quota-watch.hap')));
  assert.ok(!calls.some(args => args.includes('install') || args.includes('uninstall')));
  assert.match(result.stdout, /传到手机不代表已安装到手表/);
});
