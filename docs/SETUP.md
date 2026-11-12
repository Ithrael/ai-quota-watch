# 从克隆项目到装上自己的手表

这份指南使用自己的华为账号、Key 和调试设备，分为电脑准备、手机配对、申请签名材料、构建安装四步。已验证环境为国行 WATCH GT 6 + Mate 30 / HarmonyOS 4.2 + macOS；其他组合先确认官方应用调测助手和 Lite SDK 是否可用。

## 1. 电脑、AI 与浏览器准备

安装 Node.js 24+、Python 3、Android Platform Tools，以及 [DevEco Studio / Command Line Tools](https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos) 的配套 SDK 和 Java。当前工程使用 SDK 26.0.0，Lite FA 模型；不是 ArkTS Stage 项目。首次工具同步需要网络。

```sh
node --version
python3 --version
adb version
npm test
```

在本地克隆目录中运行。API Key 按 README 写入 `.secrets/`，运行 `npm run preview` 确认已配置账号可读取真实额度。至少一个账号即可；不需要先把其他账号填成假 Key。

### AI 怎样接管浏览器和手机

AI 需要连接本地工作目录和设备，而不只是能生成代码。推荐准备：

| 能力 | 可使用的工具 | 先做什么来确认连接 |
| --- | --- | --- |
| 终端与文件 | AI 编程助手的本地终端 | 读取本仓库、执行 `npm test`。 |
| 浏览器（★推荐） | [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) 或助手已有的浏览器工具 | 打开华为开发者联盟，读取当前标题及可操作控件。 |
| 手机 UI | [Mobile MCP](https://github.com/mobile-next/mobile-mcp) 或助手已有的 Android 工具 | 列出设备，指定已授权的华为手机，读取助手页面。 |
| 传包 | Android Platform Tools / ADB | `adb devices -l` 中手机状态为 `device`。 |

MCP 的安装和配置格式以你所用 AI 软件及上面工具的官方说明为准；不需要同时安装多套浏览器工具。给 AI 的是当前工具实际控制的浏览器窗口，不能只在另一个未连接的浏览器里登录。没有手机 UI 工具也能用 `push:phone` 完成传包，剩余安装按钮手动点击。

浏览器协作步骤：

1. 让 AI 打开 `https://developer.huawei.com/consumer/cn/`，从网站进入开发者中心/控制台。
2. 你本人完成账号登录、扫码、验证码和实名认证。无需把密码告诉 AI。
3. 登录后告知 AI 完成；AI 重新读取页面，再操作“开发者管理”“ID、证书和Profile”等菜单。网站菜单可能更新，以当前页面和官方文档为准，不点击旧的坐标。
4. 上传文件时只选本机准备好的 CSR。若工具没有文件上传权限，AI 应给出具体文件路径，由你在文件选择器里选取；不能把 P12/密码文件当作替代品上传。
5. 下载 `.cer` / `.p7b` 后，在本机移动到指定目录；浏览器工具不能访问下载目录时，由你移动。AI 再检查文件存在与 Profile 校验结果。

## 2. 华为手机与手表

1. 手机安装或更新**华为运动健康**，登录自己的华为账号，在“设备”中添加手表并完成蓝牙配对。
2. 从华为应用市场安装**应用调测助手**。打开后应能看到配对手表及设备信息；未连接时按“连接设备”跳转运动健康完成配对。
3. 保持手机联网、蓝牙开启，运动健康和调测助手可以正常运行。额度查询通过手机代理联网。
4. 用数据线把手机连到电脑，手机 USB 用途选择**传输文件**。仅看到“传输照片 / 传输文件 / 仅充电”是正常的，这和 USB 调试授权是两回事。
5. 在手机“设置 → 关于手机”连续点击版本号，按系统提示启用开发者选项；在“系统和更新 → 开发人员选项”等对应位置打开 **USB 调试**。在电脑连接弹窗中允许当前电脑。
6. 运行 `adb devices -l`。状态应为 `device`；`unauthorized` 时解锁手机并处理授权；没有设备时检查线缆、USB 模式和系统 USB 调试开关。

macOS 上如手机已被系统识别、ADB 仍找不到，可用 libusb 后端重启服务，然后重新插拔授权：

```sh
ADB_LIBUSB=1 adb kill-server
ADB_LIBUSB=1 adb start-server
ADB_LIBUSB=1 adb devices -l
```

`ADB_LIBUSB` 必须在 **ADB 服务启动时**生效；只给后续客户端设置不会改变已启动服务的后端。项目传包脚本在 macOS 上默认设置该变量，但不会主动重启你的 ADB 服务。

## 3. 申请自己的签名材料

需要五样东西：私钥库 `.p12`、本机密码、证书申请 `.csr`、华为签发的 `.cer`、绑定自己应用及手表的 `.p7b`。它们必须配套，不能借用作者的材料。Lite 设备采用[手动签名及手机安装流程](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V2/run_fitnesswatch-0000001054134240-V2/)。

### 3.1 确认应用包名并创建应用记录

当前源码包名位于 `entry/src/main/config.json` 的 `app.bundleName`。首次使用自己的开发者账号创建应用时，与 AI 确认一个你能登记的包名，再同步修改这一项；例如使用自己的反向域名命名空间。示例包名不能保证可被你的账号登记。

在开发者中心创建 HarmonyOS 应用记录，使用与工程一致的包名，并选择适用于轻量级穿戴的设备/应用选项。已有同包名应用就复用。控制台如无法选择 Lite 设备或生成匹配 Profile，先核对账号、控制台入口和官方指导；不要改成不匹配的手机 Stage 工程来绕过。

仓库名、网页展示名与 bundleName 是不同字段。已有安装更新时沿用原来的 bundleName 和有效签名，避免变成另一个应用；本机目录改名也不要求更换证书。

### 3.2 本机生成 P12 与 CSR

用 DevEco Studio 的 **Build / 构建 → Generate Key and CSR / 生成密钥和 CSR**，选择 PKCS12 密钥库、ECC/P-256 和 `SHA256withECDSA`，保存密钥别名与密码。菜单随版本变化时查阅[官方手动签名说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-hmos-signing/)。

AI 使用终端时，也可用配套 JDK 的 `keytool` 生成。以下示例仅用于**首次创建**，已存在材料时跳过；不要覆盖旧私钥或密码：

```sh
# 密码只写入本机文件，不在终端显示。
node --input-type=module <<'JS'
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
mkdirSync('.secrets/watch-signing', { recursive: true, mode: 0o700 });
writeFileSync('.secrets/watch-signing/store-pass', randomBytes(24).toString('hex'),
  { mode: 0o600, flag: 'wx' });
JS

# keytool 需在 PATH 中；也可使用配套 JAVA_HOME/bin/keytool。
keytool -genkeypair -alias ai-quota-watch -keyalg EC -groupname secp256r1 \
  -sigalg SHA256withECDSA -dname "CN=AI Quota Watch" -validity 365 \
  -storetype PKCS12 -keystore .secrets/watch-signing/debug.p12 \
  -storepass:file .secrets/watch-signing/store-pass \
  -keypass:file .secrets/watch-signing/store-pass

keytool -certreq -alias ai-quota-watch -sigalg SHA256withECDSA \
  -keystore .secrets/watch-signing/debug.p12 \
  -storepass:file .secrets/watch-signing/store-pass \
  -keypass:file .secrets/watch-signing/store-pass \
  -file .secrets/watch-signing/debug.csr

chmod 600 .secrets/watch-signing/*
```

若使用 IDE 创建的密钥库，配置中填写实际别名和路径，将密码仅保存到本机密码文件。终端示例生成的是本机密钥和 CSR；华为签发的调试证书仍要在下一步申请，不能用自签证书代替。

### 3.3 浏览器申请调试证书

按照[官方调试证书说明](https://developer.huawei.com/consumer/cn/doc/app/agc-help-add-debugcert-0000001914263178/)操作：

1. 在已登录的开发者中心进入“开发者管理”。
2. 左侧“ID、证书和Profile → 证书”，点击“新增证书”。
3. 名称可填 `ai-quota-watch-debug-日期`；类型选择**调试证书**；CSR 选择 `.secrets/watch-signing/debug.csr`。
4. 提交并下载签发的 `.cer`，保存为 `.secrets/watch-signing/debug.cer`。

证书到期、废除或吊销会影响配套 Profile。更新证书后重新生成匹配 Profile；不要为了腾名额直接废除其他项目的证书。有效期以控制台为准。

### 3.4 登记手表 UDID

在手机应用调测助手的连接设备信息中取得**手表 UDID**。界面若仅显示部分内容，可使用复制/导出等可用能力；不要猜测被截断的字符。

进入“ID、证书和Profile → 设备”，按[官方设备登记说明](https://developer.huawei.com/consumer/cn/doc/app/agc-help-add-device-0000002283189937/)添加实际手表，填写方便识别的设备名、对应设备类型和完整 UDID。

此处登记的是手表，不是手机 ADB serial、蓝牙地址，也不是主题表盘流程使用的 ODID。AI 可把完整标识保存在已忽略的 `.local/` 中，公开文档不记录个人设备号。

### 3.5 申请调试 Profile

按[官方 Profile 说明](https://developer.huawei.com/consumer/cn/doc/App/agc-help-add-debugprofile-0000001914423102/)操作；不同应用版本的入口可能有所区别：

1. 进入“ID、证书和Profile → Profile → 添加”。
2. 选择刚才创建/复用的应用，确认自动带出的包名与源码一致。
3. 类型为**调试**，名称可填 `ai-quota-watch-debug`。
4. 选择 3.3 中的有效调试证书，以及 3.4 中登记的手表。
5. 核对权限。本项目声明 INTERNET 网络权限，不应凭空申请无关的受限权限；如控制台要求额外能力，按该设备官方说明处理。
6. 生成并下载 `.p7b`，保存为 `.secrets/watch-signing/debug.p7b`。

仅下载证书还不能安装。Profile 必须覆盖当前包名、选中的证书以及实际安装的手表。

### 3.6 保存本机签名配置

```sh
cp config/signing.example.json .secrets/watch-signing/config.json
chmod 600 .secrets/watch-signing/config.json
```

编辑这个**已忽略**的 `config.json`，把别名和各路径改成自己实际的文件。相对路径以项目根目录为基准；也支持绝对路径。密码放在 `storePasswordFile` / `keyPasswordFile` 指向的文件中，不写在示例配置或公开文档里。两者相同时可指向同一文件。

```text
.secrets/watch-signing/
  config.json     本机路径和密钥别名
  debug.p12       本机私钥库
  debug.csr       仅上传这个文件申请证书
  debug.cer       华为签发的调试证书
  debug.p7b       包名 + 证书 + 手表的调试 Profile
  store-pass      本机密码文件
```

## 4. 构建、签名、传包、安装

设置实际工具路径。`HUAWEI_SDK_ROOT` 指向包含 `sdk/` 和 `bin/` 的华为 `command-line-tools` 目录，不是 Android SDK；若使用 IDE 安装的 SDK，需定位同样的工具布局或按官方 IDE 方式构建。

```sh
export HUAWEI_SDK_ROOT="/absolute/path/to/command-line-tools"
export HVIGORW="$HUAWEI_SDK_ROOT/bin/hvigorw"
# 需要时：export JAVA_HOME="/absolute/path/to/matching-jdk"

npm test
npm run build:watch
npm run sign:watch
npm run push:phone
```

`sign:watch` 使用官方 `hap-sign-tool.jar` 校验 Profile、签名 **Lite BIN**，再用 `app_packing_tool.jar` 生成 HAP；同时检查编译后 JS 的 JerryScript 语法。不能把源码 ZIP 改后缀叫 HAP。签名失败时查看本机 `.local/signing.log`，不要把日志原样公开。

HAP 默认位于 `entry/build/default/outputs/default/entry-default-signed.hap`。需要其他输出位置时可运行 `npm run sign:watch -- --output-dir .local/my-build`；传包支持 `npm run push:phone -- .local/my-build/entry-default-signed.hap`。多台 Android 设备连接时，先 `adb devices -l` 确认华为手机，再设置 `ANDROID_SERIAL`；脚本不会随便选择第一台设备。

传包完成后：

1. 在手机应用调测助手点击“应用管理”。
2. 找到 `/sdcard/haps/ai-quota-watch.hap`，执行安装，保持手机与手表蓝牙连接。
3. 打开“查看日志”等日志入口，检查安装各阶段完成，成功状态为 `errorCode: 0`。有错误时保留实际错误码；不能因进度弹窗消失就判成功。
4. 在手表应用列表打开“AI 用量”，确认能看到界面；切换已配置账号，等待刷新结束，核对额度。未配置账号显示提示属于预期。
5. 关闭电脑预览服务后，手表仍可借助配对手机查询。可以短暂断网验证上次缓存与错误提示，但不要把缓存当作实时数据。

只有第 3 步有证据才能说“安装到手表成功”，第 4 步完成才能说“手表运行验证完成”。不能用 `adb install xxx.hap` 安装，它不是手机 APK。

### 可选：macOS 原生 Java 启动崩溃

若原生 Java 出现 SIGBUS/崩溃，而非普通编译报错，可使用本项目已验证过的 Docker Java 21 方式。需要先安装并启动 Docker：

```sh
docker pull eclipse-temurin:21-jre
mkdir -p .local/java/bin
cp scripts/java-docker.sh .local/java/bin/java
chmod +x .local/java/bin/java
export JAVA_HOME="$PWD/.local/java"
export PATH="$JAVA_HOME/bin:$PATH"
# 保持 HUAWEI_SDK_ROOT 为实际的绝对路径。
npm run build:watch
npm run sign:watch
```

包装脚本挂载当前项目和只读 SDK，运行时禁用容器网络，不含作者电脑的固定路径。它只代理 `java`，没有代理 `keytool`；如生成 CSR 阶段也遇到宿主 Java 崩溃，可在同一个 JRE 容器中运行 `keytool`（挂载项目并使用同样路径参数），或使用可正常运行的配套 IDE。Docker 方案主要验证于 macOS，不保证替代每个平台的官方工具安装。

## 常见问题

| 现象 | 检查方向 |
| --- | --- |
| 手机只有“传输照片 / 传输文件 / 仅充电” | 选传输文件，再单独开启 USB 调试并允许电脑。此菜单不是手表调试入口。 |
| ADB 显示 unauthorized / 没有手机 | 解锁授权、数据线、USB 调试、USB 模式；macOS 再检查 libusb 服务后端。 |
| 助手找不到手表 | 先在运动健康确认蓝牙配对、设备连接与授权；不要把 USB 手机连接当作已连接手表。 |
| 签名失败 / 安装报签名相关错误 | 检查 P12、别名、密码、CER 是否配套，Profile 是否有效并覆盖相同包名、证书及手表 UDID。不要先卸载其他应用或废除证书。 |
| 安装报配置格式错误，曾出现错误码 40 | 保留 Lite FA 配置；当前工具 compile 为 26.0.0，target/compatible 为 `5.0.0(12)`，不要按手表系统号改成 26。 |
| 打开黑屏 | 确认 clean 后重建；保留 `entry/package.json` 的 CommonJS；检查 Lite JS 包依赖和 JerryScript 语法。 |
| 一直刷新 / 正在获取额度 | 检查手机网络与运动健康代理、Key 类型及权限；手表代码避免 `String.replace` / 正则；GLM 库存按顺序查询。浏览器能查到不等于手表网络已验证。 |
| Kimi Key 可调用模型但查不到套餐 | 使用 Kimi Code 账号与对应 Key，并在 Code 控制台确认套餐；不要把平台钱包 Key 或余额接口当作 Code 五小时/周额度。 |
| 刚改代码或 Key 却没更新 | 重新 prepare/build、签名和安装；确认选中了最新 HAP；构建脚本的 clean 不能省略。 |
| 想做成常显表盘 | 本仓库仍是普通前台应用；GT 6 第三方实时额度表盘通道未验证，证书安装流程不等于表盘数据接口。 |
