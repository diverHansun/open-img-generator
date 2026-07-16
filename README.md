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
