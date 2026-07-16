# MVP API Quickstart

> 前置: 配置 `.env`、执行 `npm install`、`npm run dev`
> 约束: 见 [constraints.md](./constraints.md)
> 修订: 2026-07-16 `sessionId` 必填；Project/Session 先创建；列表 GET 全部只读

---

## 1. 环境配置

复制并编辑 `.env`:

```bash
cp .env.example .env
# 至少配置其一:
# FAL_KEY=...
# ZENMUX_API_KEY=...
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
# 期望: { "status": "ok", "enabledProviders": ["fal"] 或 ["zenmux"] 或两者, "db": "ok" }
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

## 3. Sync 路径（ZenMux / openai/gpt-image-2）

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

## 4. Async 路径（fal / fal-ai/flux/schnell）

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
