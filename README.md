# Open Image Generator

开源的多 Provider AI 生图工作台，本地优先（Next.js + SQLite）。支持 fal.ai、ZenMux、SiliconFlow、智谱、豆包、通义 Qwen 等生图服务：配置哪个 Provider 的 API Key，就启用哪个；前端从后端读取已启用模型与能力约束，提交并轮询真实生成任务，图片转存到本地。另有 macOS Electron 桌面版。

## 快速开始

要求 Node.js 20/22/24 LTS。

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
