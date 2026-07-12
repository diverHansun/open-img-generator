# MVP API Quickstart

> 前置: 配置 `.env`、执行 `npm install`、`npm run dev`
> 约束: 见 [constraints.md](./constraints.md)

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
npm run db:push   # 实现阶段：初始化 SQLite schema
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

无 key 时返回 `[]`。

---

## 3. Sync 路径（ZenMux / openai/gpt-image-2）

```bash
curl -s -X POST http://127.0.0.1:3000/api/generations \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "zenmux",
    "model": "openai/gpt-image-2",
    "prompt": "A cat wearing a space helmet",
    "width": 1024,
    "height": 1024
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
    "provider": "fal",
    "model": "fal-ai/flux/schnell",
    "prompt": "A cat wearing a space helmet",
    "seed": 42
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
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo "$RESP" | jq
    break
  fi
  sleep 3
done
```

---

## 5. 带 Session 的生成

```bash
SESSION=$(curl -s -X POST http://127.0.0.1:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"title":"demo"}' | jq -r .id)

curl -s -X POST http://127.0.0.1:3000/api/generations \
  -H "Content-Type: application/json" \
  -d "{
    \"provider\": \"fal\",
    \"model\": \"fal-ai/flux/schnell\",
    \"prompt\": \"A dog\",
    \"sessionId\": \"$SESSION\"
  }" | jq

curl -s http://127.0.0.1:3000/api/sessions/$SESSION | jq
# generations 内 pending 项会被惰性 poll 推进
```

---

## 6. 常见错误

| HTTP | 含义 |
|------|------|
| 400 Provider not enabled | 未配置对应 env key |
| 400 Session not found | sessionId 无效 |
| 400 Sync provider supports count=1 only | zenmux 请求 count>1 |
| 201 status=failed | provider 调用失败，GET generation 查看 job.error |

---

## 7. 编码顺序（参考）

见 [review.md](../review.md) §7。
