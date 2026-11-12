"""Sign a Lite BIN and package it with Huawei's SDK; credentials stay local."""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', default='entry/build/default/outputs/default')
args = parser.parse_args()

def fail(message):
    sys.exit(message)

sdk_value = os.environ.get('HUAWEI_SDK_ROOT')
if not sdk_value:
    fail('请设置 HUAWEI_SDK_ROOT 为包含 sdk/ 的华为 command-line-tools 目录。')
sdk = Path(sdk_value).expanduser().resolve()
libs = sdk / 'sdk/default/openharmony/toolchains/lib'
java = str(Path(os.environ['JAVA_HOME']) / 'bin' / ('java.exe' if os.name == 'nt' else 'java')) if os.environ.get('JAVA_HOME') else shutil.which('java')
if not java:
    fail('未找到 Java；请配置 SDK 配套的 JAVA_HOME。')
config_path = root / os.environ.get('WATCH_SIGNING_CONFIG', '.secrets/watch-signing/config.json')
try:
    config = json.loads(config_path.read_text())
    paths = {key: (root / config[key]).resolve() for key in
             ['keystoreFile', 'certificateFile', 'profileFile', 'storePasswordFile', 'keyPasswordFile']}
    password = paths['storePasswordFile'].read_text().strip()
    key_password = paths['keyPasswordFile'].read_text().strip()
    alias = config['keyAlias']
except (OSError, KeyError, ValueError):
    fail('签名配置缺失或格式错误；请参考 config/signing.example.json 和 docs/SETUP.md。')
source_dir = root / 'entry/build/default/outputs/default'
unsigned = source_dir / 'bin/entry-default-unsigned.bin'
for path in [*paths.values(), unsigned, libs / 'hap-sign-tool.jar', libs / 'app_packing_tool.jar']:
    if not path.is_file():
        fail('缺少签名输入：' + path.name)
if not password or not key_password or not isinstance(alias, str) or not alias:
    fail('密钥别名和密码不能为空。')
output = (root / args.output_dir).resolve()
output.mkdir(parents=True, exist_ok=True)
private = root / '.local'
private.mkdir(exist_ok=True)
log = private / 'signing.log'
log.write_text('')
log.chmod(0o600)

def run(jar, *options):
    try:
        result = subprocess.run([java, '-jar', str(libs / jar), *map(str, options)],
                                cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    except OSError:
        fail('无法启动 Java；请检查 JAVA_HOME。macOS 启动崩溃时参考 docs/SETUP.md 的 Docker 方案。')
    with log.open('a') as stream:
        stream.write(result.stdout.replace(password, '[redacted]').replace(key_password, '[redacted]'))
    if result.returncode:
        fail('官方工具执行失败；本机诊断日志：.local/signing.log（不要公开上传）。')

run('hap-sign-tool.jar', 'verify-profile', '-inFile', paths['profileFile'],
    '-outFile', private / 'profile-verification.json')
parsed = root / 'entry/build/default/intermediates/lite_source/default/assets/js'
jerry = sdk / 'sdk/default/openharmony/js/build-tools/ace-loader/bin' / ('jerry.exe' if os.name == 'nt' else 'jerry')
sources = list(parsed.rglob('*.js'))
if not jerry.is_file() or not sources:
    fail('缺少 SDK JerryScript 或编译后 JS；请先运行 npm run build:watch 并检查 SDK 路径。')
for source in sources:
    result = subprocess.run([str(jerry), '--parse-only', str(source)], capture_output=True)
    if result.returncode:
        fail('Lite JavaScript 语法检查失败：' + source.name)

signed_bin = output / 'entry-default-signed.bin'
signed_hap = output / 'entry-default-signed.hap'
run('hap-sign-tool.jar', 'sign-app', '-mode', 'localSign', '-keyAlias', alias,
    '-keystoreFile', paths['keystoreFile'], '-keystorePwd', password, '-keyPwd', key_password,
    '-signAlg', 'SHA256withECDSA', '-profileFile', paths['profileFile'],
    '-appCertFile', paths['certificateFile'], '-profileSigned', '1', '-inForm', 'bin',
    '-inFile', unsigned, '-outFile', signed_bin)
run('app_packing_tool.jar', '--mode', 'hap', '--bin-path', signed_bin,
    '--out-path', signed_hap, '--force', 'true')
print('Profile 校验和 Lite JS 语法检查通过；已签名打包：', signed_hap)
print('此 HAP 含本机 API Key，仅供自己的已登记手表使用，不要发布。')
