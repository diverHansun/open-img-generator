# fal.ai 接口文档

> 来源：本目录文档由 AI 根据 [fal.ai](https://fal.ai) 公开内容整理，整理时间 2026-05-19。
> 涉及"价格 / 限流 / 具体接口字段"等可能随时间变动，**接入前请以官方文档为准**。

fal.ai 是一个面向开发者的 AI 模型 API 平台，最显著的特点是：

1. **统一队列协议**：所有图像/视频/3D 模型都通过同一套 `queue.fal.run` 协议提交、查询、取结果，**不是按模型暴露不同 endpoint**。
2. **模型生态丰富**：聚合了 FLUX、Nano Banana、GPT Image、Seedream、Kling 等多家主流模型，按 model_id 切换。
3. **支持 webhook**：可以选择推送结果到自己的 URL，避免轮询。

本目录包含：

| 文件 | 内容 |
|---|---|
| [README.md](./README.md) | 本文件：平台综述、认证、限流概念 |
| [queue-api.md](./queue-api.md) | 队列 API 协议：提交 / 查询状态 / 取结果 / 取消 / webhook |
| [models.md](./models.md) | 模型目录（含 model_id slug 与已知定价） |

---

## 认证

所有请求需在 Header 中携带：

```
Authorization: Key $FAL_KEY
```

`$FAL_KEY` 在 [fal.ai 控制台](https://fal.ai/dashboard/keys) 创建。

---

## 调用模式对比

| 模式 | 适用 | 说明 |
|---|---|---|
| **Queue API**（推荐） | 几乎所有图像/视频模型 | 异步，submit → 拿 request_id → 轮询状态 / 等 webhook → 取结果 |
| **Real-time (WebSocket)** | 低延迟实时模型 | 不在本文档范围 |
| **Streaming** | 部分模型 | 不在本文档范围 |

> 对一个常规的"用户点生成 → 等结果"流程，**统一走 Queue API** 即可。

---

## 关键约束（接入时需注意）

1. **结果 URL 是 fal CDN 的临时链接**：生成的图像/视频默认存储在 fal 侧，链接有过期时间。**必须在我们自己的存储中镜像一份**（业务层落 R2 / S3）。
2. **webhook 设计**：fal 的 webhook 是一次性投递，**没有原生重试与签名验签机制**（按当前文档观察）。如果用 webhook，必须辅以"最长 N 分钟后退回到轮询兜底"。
3. **限流**：未在公开页面看到统一限流说明，按 model 与账户级别分别限流。**接入时应在 worker 层做per-provider 令牌桶**，而不是依赖 fal 报错才退避。
4. **NSFW 内容审核**：部分模型会返回 `has_nsfw_concepts: true` 而非直接拒绝；业务层需自行判定是否展示。

---

## 与本项目（AI 绘图网站）的对应关系

- **fal.ai 是本项目的两大主力 provider 之一**，承担"高级档"的主要模型（Nano Banana、GPT Image、FLUX Pro 等）。
- 在 `packages/providers/fal/` 中实现 `FalProvider implements ImageProvider`，封装 queue 协议。
- webhook 接收端点：`POST /api/webhooks/fal`（业务层路由）。

---

## 待补条目

以下信息当前未确认，需要在实际接入前查阅官方文档或控制台补全：

- [ ] FLUX 系列（schnell / dev / pro / ultra）的单图价格
- [ ] GPT Image 2 的单图价格
- [ ] 各模型的典型生成时长（用于 worker 超时配置）
- [ ] 账户级 QPS / 并发上限
- [ ] webhook 是否提供签名校验头（如有，对应字段名）
- [ ] 图像编辑模型（FLUX Kontext / FLUX 2 Pro）的 `image_url` 输入限制（格式 / 大小 / 张数）
