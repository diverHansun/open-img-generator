# SiliconFlow 图像生成 API

> 协议：OpenAI 兼容（`/v1/images/generations`）。本文档基于公开信息整理，**接入前请以官方文档为准**。

---

## 1. 请求

```
POST https://api.siliconflow.com/v1/images/generations
Authorization: Bearer $SILICONFLOW_API_KEY
Content-Type: application/json
```

### 请求体（OpenAI 兼容，含 SiliconFlow 扩展）

```json
{
  "model": "Tongyi-MAI/Z-Image-Turbo",
  "prompt": "a corgi astronaut on the moon, photorealistic",
  "negative_prompt": "blurry, low quality",
  "image_size": "1024x1024",
  "batch_size": 1,
  "num_inference_steps": 20,
  "guidance_scale": 7.5,
  "seed": null
}
```

### 字段说明（按 OpenAI 兼容 + SiliconFlow 历史扩展归纳，**接入前必须按当前模型卡校验**）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 是 | 模型 id，见 [models.md](./models.md) |
| `prompt` | string | 是 | 正向提示词 |
| `negative_prompt` | string | 否 | 负面提示词（部分模型支持） |
| `image_size` | string | 否 | 形如 `"1024x1024"`；部分模型用 `"size"` |
| `batch_size` / `n` | int | 否 | 生成几张 |
| `num_inference_steps` | int | 否 | 采样步数（FLUX schnell 通常 4） |
| `guidance_scale` | float | 否 | CFG 引导强度 |
| `seed` | int / null | 否 | 随机种子 |
| `image` | string (URL/base64) | 否 | **图生图模式**的输入图（部分模型支持） |

---

## 2. 响应

```json
{
  "images": [
    {
      "url": "https://sf-result.aliyuncs.com/xxx.png"
    }
  ],
  "timings": { "inference": 1.234 },
  "seed": 123456789,
  "shared_id": "..."
}
```

### 设计含义

- 同 fal，返回的图片 URL 是 **临时存储链接**，必须立即下载、上传至我们自己的 R2，再写入 `images` 表。
- 对于按 token 计费的模型，**响应中可能不含 token 使用量**——SiliconFlow 是否回传 `usage.total_tokens` 需在接入时验证；如果不回传，业务侧需自行按 prompt 长度估算。

---

## 3. 错误响应

OpenAI 兼容的错误体：

```json
{
  "error": {
    "code": "invalid_request_error",
    "message": "...",
    "type": "..."
  }
}
```

| HTTP | 处理 |
|---|---|
| 401 | API Key 无效；系统级告警 |
| 403 | 余额不足 / 模型未开通；系统级告警 |
| 400 / 422 | 参数错或内容审核拒绝；**不退积分**（业务策略） |
| 429 | 限流；退避重试 |
| 5xx | 服务端故障；退避重试，耗尽后退积分 |

---

## 4. 调用模式：同步 vs 异步

**默认同步**：HTTP 请求会阻塞直到图片生成完毕（典型 5–30s）。

> **设计含义**：
> - worker 端单次调用占用一个 HTTP 连接 + 一个 worker 任务槽，时长 = 模型推理时长。
> - 与 fal queue 的"submit + poll"模式**协议形态不同**，必须在 `SiliconFlowProvider` 中用同一套 `ImageProvider` 接口"包"成异步语义（即：worker 内部 `await fetch(...)`，对外仍然走 BullMQ job 状态）。
> - 不要在 web/api 进程里直接调用 SiliconFlow——会阻塞 Node 事件循环里的其他请求（实际不会真的"阻塞"，但**会长时间占用文件描述符**，且无法被 BullMQ 重试机制覆盖）。**所有 provider 调用都集中在 worker**。

---

## 5. 图生图 / 图像编辑

SiliconFlow 对图生图的支持随模型不同：

- **部分模型**通过额外的 `image` 字段（URL 或 base64）接收参考图。
- **专门的图像编辑模型**（如 FLUX Kontext）可能走独立的 model_id 或独立端点。
- **当前公开信息不足以确认每个模型的具体协议**——接入图生图前需要单独验证。

接入策略：

1. MVP 阶段图生图只接 **fal.ai 的 FLUX Kontext / Nano Banana 等**（协议明确）。
2. 把 SiliconFlow 的图生图作为"待第二阶段验证"，业务层先按"只支持文生图"实现 SiliconFlow adapter。

---

## 6. 与 OpenAI SDK 复用

可以直接用 `openai` npm 包传入自定义 `baseURL`：

```ts
import OpenAI from "openai";
const sf = new OpenAI({
  apiKey: process.env.SILICONFLOW_API_KEY,
  baseURL: "https://api.siliconflow.com/v1",
});

const res = await sf.images.generate({
  model: "Tongyi-MAI/Z-Image-Turbo",
  prompt: "...",
  size: "1024x1024",
});
```

> **注意**：OpenAI SDK 的 `images.generate` 返回 `{ data: [{ url, b64_json }] }`，与 SiliconFlow 的 `{ images: [{ url }] }` 字段名可能不一致。**真实接入时需在 adapter 内做 normalization**——不要把 SDK 的返回类型直接当 SiliconFlow 的返回类型用。

---

## 待补条目

- [ ] 每个候选模型实际接受的参数集合
- [ ] 响应中是否回传 `usage`（token 数）
- [ ] 图生图协议细节（哪些模型支持 / 字段名 / 限制）
- [ ] 是否提供"webhook 回调"或"异步任务 ID"端点
- [ ] 海外站点对 `prompt` 中中文内容的支持情况
