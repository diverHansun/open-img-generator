# Open Image Generator

开源的多 Provider AI 生图工作台，本地优先（Next.js + SQLite）。支持 fal.ai、ZenMux、SiliconFlow、智谱、豆包、通义 Qwen 等生图服务：配置哪个 Provider 的 API Key，就启用哪个；前端从后端读取已启用模型与能力约束，提交并轮询真实生成任务，图片转存到本地。另有 macOS Electron 桌面版。

## 快速开始

要求 Node.js 20/22/24 LTS；仓库以 Node.js 24 为团队默认版本（`.nvmrc`）。不要使用 Node.js Current 版本运行迁移或测试，因为 SQLite 原生依赖只在受支持的 LTS ABI 上验证。

```bash
nvm install && nvm use
node --version    # 应显示 v24.x
```

macOS 也可以使用 Homebrew + direnv，代替上面的 nvm 步骤。安装 `node@24` 并配置好 shell 的 direnv hook 后，项目的 `.envrc` 会仅在本目录中优先使用 Node 24，不改变全局 Node。

```bash
# 已安装的工具不必重复安装
brew install node@24 direnv
# 先审查仓库 .envrc 的内容，再授权该文件
# 它目前只将 Homebrew node@24/bin 放到 PATH 前面
direnv allow .
direnv exec . node --version    # 应显示 v24.x
```

`direnv: ... .envrc is blocked` 是文件尚未授权（或内容改变后需要重新授权），不是安装失败。授权后，在已启用 hook 的终端重新进入项目目录即可自动加载；已有终端需等下一个提示符执行 hook。脚本、IDE 任务等不加载 shell hook 的环境可显式运行 `direnv exec . npm run build` / `direnv exec . npm run dev`。不要通过禁用 direnv 检查或强制切换全局 Homebrew Node 来解决。

`engine-strict=true` 会阻止在不受支持的版本上安装依赖，但不能替代运行时的版本切换。如果曾在其他 Node 主版本下安装过依赖，请先切换到 Node 24，再执行 `npm ci`。这会重新构建 SQLite 等原生依赖，使其 ABI 与当前运行时一致；不要复用由其他主版本生成的 `node_modules`。若只出现 `better-sqlite3` 的 `NODE_MODULE_VERSION` 错误，也可在确认 Node 24 后执行 `npm rebuild better-sqlite3`，无需删除数据库。

```bash
cp .env.example .env.local   # Windows PowerShell: Copy-Item .env.example .env.local
npm ci
npm run dev
```

`npm run dev` 会自动迁移数据库并监听 [http://localhost:3000](http://localhost:3000)。

在 `.env.local` 中至少配置一家 Provider（缺 key 的 Provider 静默不启用）：

```dotenv
FAL_KEY=
ZENMUX_API_KEY=
SILICONFLOW_API_KEY=
ZHIPU_API_KEY=
ARK_API_KEY=
DASHSCOPE_API_KEY=
```

修改 `.env.local` 后需重启开发服务。API Key 只配置在 `.env.local`，不要写进前端代码。

本地数据默认保存在 `./data/`（SQLite、图片、配置、日志），可参考 `.env.example` 中的 `DATABASE_URL`、`LOCAL_STORAGE_DIR` 等变量覆盖。

## 生产运行

```bash
npm run build
npm start
```

`prestart` 会以 production 模式自动迁移数据库。

## macOS 桌面版

```bash
npm run desktop:dev                              # 开发模式
npm run desktop:package:mac:arm64                # 打包 Apple Silicon DMG
npm run desktop:package:mac:x64                  # 打包 Intel DMG
```

签名、公证等分发细节见 [macOS 分发指南](./docs/mvp/desktop-shell/macos-distribution.md)。

## 测试

```bash
npm run typecheck
npm test
npm run build
```

## 许可证

[Apache License 2.0](./LICENSE)。第三方 Provider 的服务条款、商标和生成内容权利不由本项目许可证授予。
