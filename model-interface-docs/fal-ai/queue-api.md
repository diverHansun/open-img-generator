# fal.ai Queue API 协议

> 来源：fal.ai 官方文档 `https://docs.fal.ai/model-endpoints/queue`（2026-05-19 抓取）

fal 的所有图像/视频/3D 模型对外都通过同一套队列协议交互。**先 submit、再 poll 或等 webhook、最后取 response**。

---

## 1. 提交请求（submit）

```
POST https://queue.fal.run/{model-id}
Authorization: Key $FAL_KEY
Content-Type: application/json

{
  "prompt": "...",
  ... // 其余字段按 model-id 不同而不同
}
```

**model-id 示例**：
- `fal-ai/nano-banana`
- `fal-ai/flux/schnell`
- `fal-ai/flux-pro/v1.1-ultra`
- `fal-ai/openai/gpt-image-2`

### 响应

```json
{
  "request_id": "abc-123-...",
  "status_url":  "https://queue.fal.run/{model-id}/requests/{request_id}/status",
  "response_url":"https://queue.fal.run/{model-id}/requests/{request_id}/response",
  "cancel_url":  "https://queue.fal.run/{model-id}/requests/{request_id}/cancel"
}
```

> **设计含义**：submit 返回的是"任务句柄"，并非生成结果。把 `request_id` 落库到 `jobs` 表的 `provider_request_id` 字段。

---

## 2. 查询状态（polling）

```
GET https://queue.fal.run/{model-id}/requests/{request_id}/status[?logs=1]
Authorization: Key $FAL_KEY
```

### 状态枚举

| 状态 | 含义 |
|---|---|
| `IN_QUEUE` | 已收到请求，等待 runner |
| `IN_PROGRESS` | 正在生成（带 `?logs=1` 可拉到日志） |
| `COMPLETED` | 已完成，可去 response_url 取结果 |

> **设计含义**：worker 端可以按 1s/2s/5s 退避节奏轮询，**不要密集轮询**——fal 没有公开统一限流，但密集轮询有被限流风险。

---

## 3. 取结果（response）

```
GET https://queue.fal.run/{model-id}/requests/{request_id}/response
Authorization: Key $FAL_KEY
```

返回模型特定的结果体（图模型一般是 `{ images: [{ url, width, height, content_type }], ... }`，具体字段以模型为准）。

> **设计含义**：拿到 `images[].url` 后立即下载、上传到 R2，写入 `images` 表。**不要把 fal CDN 的 URL 直接交给前端**——会过期。

---

## 4. 取消请求

```
PUT https://queue.fal.run/{model-id}/requests/{request_id}/cancel
Authorization: Key $FAL_KEY
```

| 响应码 | 含义 |
|---|---|
| `202 Accepted` | 取消请求已提交 |
| `400 Bad Request` | 任务已完成，无法取消 |

> **设计含义**：用户在前端点"取消"时，业务层应**先标记 job 为 `cancelling`**，再请求 fal 取消。即使取消失败，业务侧也按取消处理（不退积分则视具体 SLA 决策，建议退）。

---

## 5. Webhook（替代轮询）

在 submit 时附加 query 参数：

```
POST https://queue.fal.run/{model-id}?fal_webhook=https://your-server.com/webhook
```

任务完成后 fal 主动 POST 到你的回调地址，body 形如：

```json
{
  "request_id": "abc-123-...",
  "status": "COMPLETED",   // 或 "ERROR"
  "payload": { /* 与 response_url 取到的内容一致 */ }
}
```

### 风险与对策（重要）

- **没有原生签名验签机制**（按当前文档观察）→ webhook 路由必须在 URL 中带**不可猜测的 secret**，例如 `https://your-server.com/api/webhooks/fal/{secret}/{job_id}`，并在业务层校验 `job_id` 与 `request_id` 是否匹配。
- **没有重试承诺** → worker 必须保持**轮询兜底**：webhook 没收到时，超过 N 分钟（按模型典型生成时长 ×3 取值）后退回轮询。
- **顺序无保证** → 在 `jobs` 表中用状态机控制状态转移，防止"先收到 COMPLETED，后又收到 IN_PROGRESS"导致状态被回退（接入时按时间戳取 max）。

---

## 6. 错误响应（部分常见）

| HTTP | 含义 | 处理 |
|---|---|---|
| 401 | API Key 无效 | 系统级告警，停止重试 |
| 403 | 余额不足 / 模型未开通 | 系统级告警，停止重试 |
| 422 | 参数校验失败（含内容审核拒绝） | 不重试，按"用户输入错"反馈，**不退积分**（与业务策略一致） |
| 429 | 触发限流 | 退避重试 |
| 5xx | fal 侧故障 | 退避重试，**重试次数耗尽后退积分** |

---

## 7. SDK vs HTTP

fal 官方提供 `@fal-ai/serverless-client`（TypeScript）和 Python SDK。**MVP 阶段建议直接用 HTTP**（fetch），原因：

1. SDK 把 submit + polling 封装成一次 await，**与我们的 worker 解耦语义冲突**——worker 处理一个 job 时，不应阻塞在 polling 内（占用 worker slot）。
2. HTTP 协议稳定、字段语义清晰，便于在 `FalProvider` 中按状态机推进。
3. 减少一个依赖。

后期若发现 webhook 签名等高级特性可通过 SDK 拿到，再切换不迟。
