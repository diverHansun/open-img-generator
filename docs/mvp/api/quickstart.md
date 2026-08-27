# MVP API Quickstart

> 前置: 配置 `.env`、执行 `npm install`、`npm run dev`
> 约束: 见 [constraints.md](./constraints.md)
> 修订: 2026-07-16 `sessionId` 必填；Project/Session 先创建；列表 GET 全部只读；补充 Kling、auth、cancel、worker

---

## 1. 环境配置

复制并编辑 `.env`:

```bash
cp .env.example .env
# 至少配置其一（按你要验证的 Provider 选择）:
# FAL_KEY=...
# ZENMUX_API_KEY=...
# SILICONFLOW_API_KEY=...
# ZHIPU_API_KEY=...
# ARK_API_KEY=...
# DASHSCOPE_API_KEY=...
# KLING_API_KEY=...（独立 Kling API，不复用 DashScope）
```

若设置了 `APP_AUTH_TOKEN`，先建立单用户 cookie（后续 curl 加 `-b cookies.txt -c cookies.txt`）：

```bash
curl -s -c cookies.txt -X POST http://127.0.0.1:3000/api/auth/session \
  -H "Content-Type: application/json" \
  -d '{"token":"'$APP_AUTH_TOKEN'"}' | jq
```

启动:

```bash
npm install
npm run db:migrate
npm run dev
```

健康检查:

```bash
curl -s http://127.0.0.1:3000/api/health | jq
# 期望: { "status": "ok", "enabledProviders": [已配置 key 的 provider id...], "db": "ok" }
```

---

## 2. 列出已启用 Provider

```bash
curl -s http://127.0.0.1:3000/api/providers | jq
```

无 key 时返回 `[]`。检查各 model 的 `supportedAspectRatios`（公开比，非空）。

先创建本次 quickstart 使用的 Project / Session（之后每个生成请求都引用它）：

```bash
PROJECT=$(curl -s -X POST http://127.0.0.1:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"title":"quickstart"}' | jq -r .id)

SESSION=$(curl -s -X POST http://127.0.0.1:3000/api/projects/$PROJECT/sessions \
  -H "Content-Type: application/json" \
  -d '{"title":"first session"}' | jq -r .id)
```

---

## 3. Sync 路径（ZenMux 示例；SiliconFlow / 智谱 / Doubao / Qwen / Wan 同为同步提交）

Qwen 新增的文生图模型可将 target 替换为 `{ "provider": "qwen", "model": "qwen-image-3.0" }`、`qwen-image-3.0-pro` 或 `qwen-image-2.0-pro-2026-06-22`；标准 Wan 2.7 使用 `{ "provider": "qwen", "model": "wan2.7-image" }`。本批示例仍只传文本 prompt。

```bash
curl -s -X POST http://127.0.0.1:3000/api/generations \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cat wearing a space helmet",
    "sessionId": "'"$SESSION"'",
    "aspectRatio": "1:1",
    "targets": [
      { "provider": "zenmux", "model": "openai/gpt-image-2" }
    ]
  }' | jq
```

期望 `201`:

```json
{
  "id": "...",
  "status": "completed",
  "links": { "self": "/api/generations/..." }
}
```

取图:

```bash
GEN_ID="..."   # 上一步 id
curl -s http://127.0.0.1:3000/api/generations/$GEN_ID | jq
# images[0].url → /api/images/{imageId}

curl -s -o out.png http://127.0.0.1:3000/api/images/{imageId}
```

---

## 4. Async 路径（fal / Wan Pro / Kling）

下面先用 fal 展示轮询流程。Wan Pro 可将 target 换成 `{ "provider": "qwen", "model": "wan2.7-image-pro" }`；Kling 换成 `{ "provider": "kling", "model": "kling-v3" }`，服务端使用独立 Kling API。Kling 图生图可将 `mode` 设为 `image-to-image` 并传一张 `referenceImages`。详情 GET 才是用户手动推进入口；若开启 worker，则由后台扫描 due job。

提交:

```bash
curl -s -X POST http://127.0.0.1:3000/api/generations \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cat wearing a space helmet",
    "sessionId": "'"$SESSION"'",
    "aspectRatio": "1:1",
    "seed": 42,
    "targets": [
      { "provider": "fal", "model": "fal-ai/flux/schnell" }
    ]
  }' | jq
```

期望 `201 { "status": "pending", "links": { "self": "..." } }`

轮询（客户端必须执行）:

```bash
GEN_ID="..."
while true; do
  RESP=$(curl -s http://127.0.0.1:3000/api/generations/$GEN_ID)
  STATUS=$(echo "$RESP" | jq -r .status)
  echo "status=$STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then
    echo "$RESP" | jq
    break
  fi
  sleep 3
done
```

取消仍在运行的 generation（Kling/Wan Pro 会立即停止本地 poll，并记录 `CANCEL_UNSUPPORTED`）：

```bash
curl -s -X POST -b cookies.txt \
  http://127.0.0.1:3000/api/generations/$GEN_ID/cancel | jq
```

---

## 5. 扇出（fal + zenmux）

```bash
curl -s -X POST http://127.0.0.1:3000/api/generations \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A red balloon over a quiet lake",
    "sessionId": "'"$SESSION"'",
    "aspectRatio": "1:1",
    "count": 1,
    "targets": [
      { "provider": "fal", "model": "fal-ai/flux/schnell" },
      { "provider": "zenmux", "model": "openai/gpt-image-2" }
    ]
  }' | jq
```

随后按 §4 轮询同一 `id`，直到 `status` 终态；`jobs.length` 应为 2。

---

## 6. Project / Session 与只读历史

```bash
curl -s http://127.0.0.1:3000/api/projects | jq
curl -s http://127.0.0.1:3000/api/projects/$PROJECT/sessions | jq
curl -s "http://127.0.0.1:3000/api/generations?sessionId=$SESSION&limit=10" | jq
curl -s "http://127.0.0.1:3000/api/sessions/$SESSION?include=generations" | jq
```

最后两个列表请求都**不会**推进 pending/running job。只有
`GET /api/generations/:id` 会推进 poll。缺少 `sessionId` 的 POST → 400。
---

## 7. 常见错误

| HTTP | 含义 |
|------|------|
| 400 Provider not enabled | 未配置对应 env key |
| 400 Session not found / missing | sessionId 缺失或无效 |
| 400 Sync provider supports count=1 only | zenmux target 的 count>1 |
| 400 不支持的 aspectRatio | 某 target 的 capabilities 不含该公开比 |
| 400 targets 空/重复 | 非法 targets |
| 201 聚合 status=failed | 全部 job 失败；GET 查看各 job.error |
| 201/GET 聚合 completed 但某 job failed | 部分成功；见 constraints §8 |

---

## 8. 编码顺序（参考）

1. providers: fal 公开 `supportedAspectRatios` + 映射表
2. job-engine: `targets[]` 扇出 + 聚合 + 锁收紧
3. api/constraints + quickstart 对齐
4. web-ui workbench

模块文档: `docs/mvp/job-engine/`、`docs/mvp/providers/`、`docs/mvp/web-ui/`。
