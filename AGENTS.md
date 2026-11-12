# AI 接手部署指南

## 交流与范围

- 优先中文；多个选项标明“★推荐”；不确定的账号、包名、设备或不可逆选择先问用户。
- 保持实现简单，不做无关重构。用户要求部署时，完成能做的准备、构建和验证，不能只给操作建议。
- 先读 README.md 和 docs/SETUP.md。本仓库是华为 Lite Wearable **手表应用**，手机用于配对、联网和安装桥接。表盘试验不在本仓库，不要为本应用申请主题设计师权限。

## 从检查到安装

1. 检查 Node 24+、Python 3、华为 SDK / Hvigor / 配套 Java、ADB；运行 `npm test`。缺工具时给出官方来源，不伪造 HAP。
2. 识别用户华为手机及配对手表，确认运动健康与应用调测助手可用。已验证 GT 6 + Mate 30；其他设备先核对，不承诺通用兼容。
3. 从环境变量或 `.secrets/` 读取用户自己的 Key，不输出值。可先运行 `npm run preview` 验证账号查询；至少配置一个账号即可，标签目前固定为三个。
4. 检查 `entry/src/main/config.json` 的 bundleName 与用户自己的开发者中心应用记录。新用户首次登记前请确认包名；已有部署保留匹配的包名、证书和 Profile。
5. 仅在用户已授权创建调试资源时，按 SETUP 指南操作浏览器，创建缺少的应用记录、调试证书、手表登记和 Profile。优先复用匹配的有效材料，不吊销、删除用户已有资源。
6. 用户本人处理登录、认证、扫码、验证码和手机 USB 授权。浏览器有上传/下载能力就使用；工具拒绝访问文件时，让用户手工选择准备好的文件，不能绕过访问限制。仅上传 CSR，不上传 P12、密码或 API Key。
7. 准备 `.secrets/watch-signing/config.json` 和密码文件；设置 `HUAWEI_SDK_ROOT`、`HVIGORW`，必要时设置 `JAVA_HOME`。执行 `npm run build:watch`、`npm run sign:watch`。
8. 执行 `npm run push:phone`，通过手机 UI 的“应用调测助手 → 应用管理”选择 HAP 安装到配对手表。有 Android 控制工具就继续操作；否则交付精确的手动步骤。HAP 不是 APK，不使用 `adb install`；GT 6 的此流程不使用全智能 WATCH 的 HDC 安装教程。
9. 核对助手安装日志；再打开手表应用，确认已配置账号的刷新结束、数值/错误状态正确。区分“构建完成”“已传到手机”“手表安装成功”“手表运行验证完成”，没有证据的阶段不能宣称完成。

需要用户交互时，明确说明当前页面、等待的动作、已完成内容；继续完成不依赖该动作的工作。可以将进度记录在已忽略的 `.local/setup-state.json`，不包含 Key、密码或私钥。没有手机、浏览器登录或必要工具时，完成本机可交付部分，说明具体阻塞点，不承诺零人工安装。

## 不泄露凭据

- `.secrets/`、`.local/`、生成的 `entry/src/main/js/MainAbility/common/` 文件、构建目录和 HAP 不进入提交。
- 自用 HAP 内含 API Key，不能公开发布，也不能使用作者的 Key / 证书给他人部署。
- 不打印完整响应、Authorization、密码、私钥或含 Key 的生成文件；错误和截图同样需要避免这些字段。不要把签名密码直接写进 shell 命令历史。
- 开源检查以 Git 实际待提交文件为准，不能只依赖 `.gitignore`。不要在报告中复述扫描命中的秘密。

## 保持真机兼容

- 保留 Lite FA 模型：`legacyAppTasks` / `legacyHapTasks`，`entry/package.json` 为 CommonJS；根目录工具脚本为 ESM。
- 当前配套工具 modelVersion / compileSdkVersion 为 `26.0.0`；target / compatible 为 `5.0.0(12)`。不要按手表系统号随意改成 26，曾导致安装配置格式错误。
- 手表代码不使用 RegExp 或 `String.replace`，使用已验证的 `split/join`。保留短 label 引用 `$string:app_name`、两个图标和 INTERNET 权限说明。
- 构建必须先 clean；签名对象是 Lite BIN，再由官方工具打包 HAP。SDK 此版本的 `verify-app -inForm bin` 会进入 ELF 校验路径，不把它当 Lite BIN 安装验签结论。
- GLM 先查额度再查重置库存，避免真机并发错误；保留超时、账号隔离、旧请求回调保护和离线标记。
- 只读查询额度和重置库存，不调用模型、不请求重置兑换接口。Kimi 显示五小时和周额度；不猜测月额度。
