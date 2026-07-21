# Open Image Generator

多 Provider 文生图工作台。当前首批接入 fal.ai 与 ZenMux，前端会从后端读取已启用模型和能力约束，再提交并轮询真实生成任务。

## 本地开发

项目使用偶数版本 Node.js LTS；推荐 Node.js 24。

```bash
nvm use
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)。Provider API Key 只配置在根目录 `.env`，不要写进前端代码。

至少配置一家 Provider：

```dotenv
FAL_KEY=
ZENMUX_API_KEY=
```

修改 `.env` 后需要重新启动开发服务。若未配置任何 Provider，页面会保持可访问并展示真实空状态，但不会允许提交生成任务。

### 网络可靠性与透明代理

ZenMux、SiliconFlow、智谱和豆包这类同步生图 API 的完整生成响应默认最多等待 3 分钟；环境变量 `SYNC_IMAGE_GENERATION_TIMEOUT_MS` 只能设为不超过 `180000` 的正整数毫秒，非法值会安全回退到 3 分钟。fal、Qwen、Kling 的异步 submit/poll 预算不受此项影响；已开始但超时的生图请求仍会进入“结果未知”，系统不会自动重投可能已收费的请求。

ZenMux 与豆包在官方响应允许时优先接收 Base64，并通过有界 staging 直接落入本地文件，减少一次临时 CDN 下载。fal、SiliconFlow、智谱、Qwen、Kling 仍按厂商契约返回 URL，job-engine 会在任务完成后立即执行 HTTPS/DNS/IP、大小、MIME 与 magic 校验并转存，不把临时 URL 当作历史资产。

若本机透明代理把确认过的外部图片 CDN 解析为 `198.18.0.0/15`，可配置精确 host 白名单，例如：

```dotenv
TRUSTED_PROXY_IMAGE_HOSTS=v3b.fal.media
```

该例外只接受 HTTPS、精确 hostname 且全部 DNS 结果均在该 `/15`；每次 redirect 会重新检查。代理关闭时保持为空即可。请勿以 `ALLOW_PRIVATE_IMAGE_URLS=true` 作为常规方案：它仅供本地 fake provider 开发使用，会放宽所有 private 地址检查。

保存失败时，任务详情只显示安全失败类别和可验证的下载 hostname，用于区分 DNS、fake-IP 未信任、下载超时、上游链接失效、内容校验和本地写入错误；不会显示签名 URL、Prompt、上游响应体或本机绝对路径。

### 图片保留与导出

图片字节保存在 `LOCAL_STORAGE_DIR`（默认 `./data/images`），SQLite 只保存 Generation/Job、图片元数据和清理墓碑。未收藏图片默认保留 7 天；`IMAGE_RETENTION_DAYS=0` 可关闭自动过期。收藏图片持续保留，直到用户主动删除。下载只导出一份副本，不延长应用内部副本的保留期；自动过期或单图删除后，历史仍保留并显示对应原因。

## 生产运行

```bash
npm run db:migrate
npm run build
npm start
```

生产环境应为 `DATABASE_URL` 和 `LOCAL_STORAGE_DIR` 使用持久化目录，并确保运行用户具有读写权限。

## 验证

```bash
npm run typecheck
npm test
npm run build
```
