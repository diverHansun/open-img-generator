# providers 模块 · data-model

> 模块路径: `src/lib/providers/`
> 前置文档: goals-duty.md, architecture.md
> 文档顺序: ③ data-model(本文) → ④ dfd-interface → ⑦ test

---

本文档定义 providers 模块的核心数据结构。这些类型同时是 providers 与 job-engine 之间的**跨模块契约**——job-engine 通过引用这些类型与厂商交互，不应自行定义平行的厂商相关结构。

---

## 1. Core Concepts（核心概念）

| 概念 | 一句话 | 分类 |
|------|--------|------|
| **ImageProvider** | 一家厂商的适配器实例，暴露 submit/poll/cancel | Entity（有 id，registry 管理生命周期） |
| **NormalizedRequest** | 上层传入的厂商无关生成请求 | Value Object（不可变，每次调用新建） |
| **SubmitResult** | submit 的返回：sync 直接含图，async 含任务句柄 | Value Object |
| **JobHandle** | async 厂商的任务句柄，供 poll/cancel 使用 | Value Object |
| **PollResult** | 一次 poll 的状态快照：进行中 / 已完成 / 失败 | Value Object |
| **ProviderImageRef** | 厂商侧临时图片引用（URL + 元数据） | Value Object |
| **ProviderCapabilities** | 某 (provider, model) 支持的能力声明 | Value Object（静态配置） |
| **ProviderInfo** | 对外暴露的 provider 摘要（id + 模型列表 + capabilities） | Value Object |
| **ProviderModelSpec&lt;Profile&gt;** | Provider 内部的公开 capabilities 与私有协议 profile 绑定 | Internal Value Object |

---

## 2. Entity / Value Object 区分

### ImageProvider（Entity）

- **身份标识**: `id: ProviderId`（如 `"fal"`、`"zenmux"`）
- **生命周期**: registry 懒创建，进程内单例，随 env key 存在与否决定是否存在
- **可变部分**: 无（adapter 实例本身无状态，不持有任务状态）

### 其余概念均为 Value Object

- 无独立身份，不可变
- 每次 submit/poll 产生新实例
- 可安全序列化用于日志或测试断言

---

## 3. Key Data Fields（关键数据字段）

### 3.1 ProviderId

```
type ProviderId = "fal" | "zenmux" | "siliconflow" | "zhipu" | "doubao" | "qwen" | "kling"
```

当前已实现 `"fal"`、`"zenmux"`、`"siliconflow"`、`"zhipu"`、`"doubao"`、`"qwen"` 与 `"kling"`。Kling 使用独立 Kling API 和 Bearer key，不复用 DashScope。

### 3.2 ProviderMode

生成模式枚举，描述"这次请求要做什么类型的生成"：

```
type ProviderMode = "text-to-image" | "image-to-image"
```

当前已实现的首跑模型均支持 `text-to-image`；Doubao 与 Kling 另外声明了参考图图生图能力。API 通过统一的 `referenceImages` 参数传入参考图，adapter 再按厂商限制翻译。

### 3.3 NormalizedRequest

上层（job-engine）传入 providers 的统一请求体。**全部为运行时 Value Object**：随 `submit()` / `poll()` 调用存在，providers 与 db 均不对这些字段做持久化（`prompt` 由 job-engine 在写库时单独存入 `generations.prompt`）。

| 字段 | 含义 | MVP |
|------|------|-----|
| `prompt` | 生成提示词（已由 prompt 模块处理或透传） | 必填 |
| `mode` | 生成模式 | 默认 `text-to-image` |
| `width` | 目标宽度（像素） | 可选，capabilities 有默认值 |
| `height` | 目标高度（像素） | 可选，capabilities 有默认值 |
| `aspectRatio` | 宽高比字符串（如 `"16:9"`） | 可选，与 width/height 二选一 |
| `count` | 请求生成张数 | 可选，默认 1，受 capabilities.maxCount 约束 |
| `negativePrompt` | 负向提示词 | 可选，capabilities 声明是否支持 |
| `seed` | 随机种子 | 可选，capabilities 声明是否支持 |
| `referenceImages` | 参考图 URL/裸 Base64 列表（图生图用） | 可选；`image-to-image` 至少一张 |
| `providerOptions` | 厂商特技透传（松散键值） | 可选 |

**尺寸解析优先级**: `width`+`height` > `aspectRatio` > capabilities 默认值。adapter 负责翻译为厂商各自的尺寸字段（如 fal 的 `image_size`、zenmux 的 `size`）。

**公开宽高比约定**: `aspectRatio` 与 `supportedAspectRatios` 使用同一套公开字符串（如 `"1:1"`、`"16:9"`）。UI 与 job-engine 只认公开比；厂商枚举仅出现在 adapter 映射与 `supportedSizes`。

### 3.4 SubmitResult

submit 的返回，通过 `kind` 区分 sync/async：

```
type SubmitResult =
  | { kind: "sync"; images: ProviderImageRef[] }
  | { kind: "async"; handle: JobHandle }
  | { kind: "failed"; error: ProviderError }
```

| kind | 含义 | 适用厂商 |
|------|------|----------|
| `sync` | 当场完成；ZenMux/豆包优先内联 Base64，SiliconFlow/智谱返回临时 URL | zenmux、siliconflow、zhipu、doubao |
| `async` | 任务已提交，需后续 poll | fal、qwen、kling |
| `failed` | 单次调用失败（含超时、4xx、5xx） | 全部 |

### 3.5 JobHandle

async 厂商的任务句柄，providers 内部结构，job-engine 原样存储并在 poll 时传回。

| 字段 | 含义 | fal 映射 | Qwen 映射 |
|------|------|----------|----------|
| `providerId` | 厂商标识 | `"fal"` | `"qwen"` |
| `model` | 模型 id | `"fal-ai/flux/schnell"` | `"qwen-image-plus"` |
| `externalId` | 厂商侧任务 id | `request_id` | `task_id` |
| `statusUrl` | 状态查询 URL | submit 响应的 `status_url`（仅 exact-origin 后持久化） | 从受信 base + `externalId` 构建；字段为旧行兼容，不作为执行 URL |
| `responseUrl` | 结果获取 URL | submit 响应的 `response_url`（仅 exact-origin 后持久化） | 与 `statusUrl` 相同（成功响应内含结果；不信任旧字段） |
| `cancelUrl` | 取消 URL | submit 响应的 `cancel_url`（仅 exact-origin 后持久化） | `null`（当前官方 HTTP 接口未提供取消调用） |
| `submittedAt` | 提交时间（ISO 8601） | 本地记录 | 本地记录 |

Kling 映射：`externalId=data.task_id`，`statusUrl/responseUrl=/v1/images/generations/:taskId`，`cancelUrl=null`。Qwen/Kling 的 poll 每次都从已校验的 base URL 与编码后的 `externalId` 重建，因此旧数据库中的 URL 不可把 Bearer credential 导向其他 host。

job-engine 将 handle 序列化存入 `generation_jobs.provider_handle`（JSON），不在 providers 模块持久化。

### 3.6 PollResult

单次 poll 的快照：

```
type PollResult =
  | { status: "pending" }
  | { status: "running" }
  | { status: "completed"; images: ProviderImageRef[] }
  | { status: "failed"; error: ProviderError }
  | { status: "cancelled" }
```

| status | 含义 | fal 映射 |
|--------|------|----------|
| `pending` | 排队中 | `IN_QUEUE` |
| `running` | 生成中 | `IN_PROGRESS` |
| `completed` | 完成，images 可用 | `COMPLETED` + response 解析 |
| `failed` | 失败 | 错误响应或 response 含 error |
| `cancelled` | 已取消 | cancel 成功或厂商返回取消态 |

### 3.7 ProviderImageRef

厂商返回的单张图片引用。**不是持久化资产**，URL 会过期。

| 字段 | 含义 | 来源 |
|------|------|------|
| `url` | 厂商 CDN 临时 URL | fal: `images[].url`；zenmux: `data[].url` |
| `width` | 图片宽度 | 厂商响应或 null |
| `height` | 图片高度 | 厂商响应或 null |
| `contentType` | MIME 类型 | 厂商响应或推断（`image/png`） |
| `index` | 批次内序号（0-based） | 本地编号 |
| `revisedPrompt` | 厂商改写后的 prompt | zenmux 可能返回，fal 通常无 | MVP 丢弃，不入库 |

`index` 字段供 job-engine 写入 `images.index`，用于转存幂等（见 db/data-model §2.4）。

### 3.8 ProviderError

单次调用失败的错误描述：

| 字段 | 含义 |
|------|------|
| `code` | 机器可读错误码（见下方枚举） |
| `message` | 人类可读描述 |
| `retryable` | job-engine 是否可按当前 operation 的有界策略重试；不等同于 submit 可安全重放 |
| `httpStatus` | 原始 HTTP 状态码（如有） |
| `disposition` | `not_started` / `rejected` / `unknown`；submit 是否可安全重放的副作用事实 |
| `retryAfterMs` | Provider 返回的、已上限化的建议等待时间（如有） |

```
type ProviderErrorCode =
  | "AUTH_FAILED"        // 401, API key 无效
  | "QUOTA_EXCEEDED"     // 403, 余额不足
  | "INVALID_REQUEST"    // 422, 参数/内容审核拒绝
  | "RATE_LIMITED"       // 429
  | "PROVIDER_ERROR"     // 5xx, 厂商侧故障
  | "TIMEOUT"            // 单次 HTTP 超时
  | "UNKNOWN"            // 无法分类
```

### 3.9 ProviderCapabilities

某 (provider, model) 的显式能力声明，供 `GET /api/providers` 与 job-engine 校验。

| 字段 | 含义 |
|------|------|
| `providerId` | 厂商标识 |
| `model` | 模型 id |
| `displayName` | 人类可读名称 |
| `modes` | 支持的 ProviderMode 列表 |
| `maxCount` | 单次请求最大张数 |
| `supportedSizes` | 支持的尺寸列表（如 `["1024x1024", "512x512"]`） |
| `supportedAspectRatios` | 支持的宽高比（如 `["1:1", "16:9"]`） |
| `supportsNegativePrompt` | 是否支持负向提示词 |
| `supportsSeed` | 是否支持 seed |
| `protocol` | `"sync"` 或 `"async"` |
| `defaultSize` | 未指定尺寸时的默认值 |

### 3.10 ProviderInfo

`GET /api/providers` 返回的摘要：

| 字段 | 含义 |
|------|------|
| `id` | ProviderId |
| `displayName` | 厂商显示名 |
| `models` | 该厂商已启用的模型 capabilities 列表 |

---

## 4. MVP 首跑模型的 Capabilities 声明

### zenmux / openai/gpt-image-2、openai/gpt-image-1.5

| 字段 | 值 |
|------|-----|
| protocol | `sync` |
| modes | `["text-to-image"]`（MVP）；capabilities 预留 `image-to-image` |
| maxCount | 4（OpenAI Images API `n` 参数上限） |
| supportedSizes | `["1024x1024", "1536x1024", "1024x1536"]` |
| supportedAspectRatios | `["1:1", "3:2", "2:3"]` |
| supportsNegativePrompt | false |
| supportsSeed | false |
| defaultSize | `"1024x1024"` |

### fal / fal-ai/flux/schnell

| 字段 | 值 |
|------|-----|
| protocol | `async` |
| modes | `["text-to-image"]` |
| maxCount | 4 |
| supportedSizes | `["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]`（厂商枚举，供映射/调试） |
| supportedAspectRatios | `["1:1", "4:3", "3:4", "16:9", "9:16"]`（**公开比，须非空**） |
| supportsNegativePrompt | false |
| supportsSeed | true |
| defaultSize | `"square_hd"` |

#### fal 公开比 → image_size 映射（adapter 内部）

| aspectRatio | image_size |
|-------------|------------|
| `1:1` | `square_hd` |
| `4:3` | `landscape_4_3` |
| `3:4` | `portrait_4_3` |
| `16:9` | `landscape_16_9` |
| `9:16` | `portrait_16_9` |

未指定 aspectRatio/width/height 时使用 `defaultSize`（`square_hd`）。

#### zenmux 公开比 → size 映射（adapter 内部）

| aspectRatio | size |
|-------------|------|
| `1:1` | `1024x1024` |
| `3:2` | `1536x1024` |
| `2:3` | `1024x1536` |

**扇出交集提示**: fal ∩ zenmux 的公开比目前主要为 `1:1`。web-ui 多选两模型时宽高比选项取交集；服务端仍按每 target 校验。

### siliconflow / Kwai-Kolors/Kolors、Tongyi-MAI/Z-Image-Turbo

| 字段 | 值 |
|------|-----|
| protocol | `sync` |
| modes | `["text-to-image"]` |
| maxCount | 1（当前同步 job-engine 约束；厂商 batch 能力暂不向上暴露） |
| supportedSizes | `["1024x1024", "960x1280", "768x1024", "720x1440", "720x1280"]` |
| supportedAspectRatios | `["1:1", "3:4", "1:2", "9:16"]` |
| supportsNegativePrompt | true |
| supportsSeed | true |
| defaultSize | `"1024x1024"` |

Kolors profile 允许 `batch_size`；Z-Image Turbo profile 明确禁止发送该 Kolors 专属字段。当前产品仍统一限制同步模型 `maxCount=1`。`Tongyi-MAI/Z-Image` 在真实密钥完成产品链路探测前不进入公开目录。

#### SiliconFlow 公开比 → image_size 映射（adapter 内部）

| aspectRatio | image_size |
|-------------|------------|
| `1:1` | `1024x1024` |
| `3:4` | `960x1280` |
| `1:2` | `720x1440` |
| `9:16` | `720x1280` |

### zhipu / glm-image

| 字段 | 值 |
|------|-----|
| protocol | `sync` |
| modes | `["text-to-image"]` |
| maxCount | 1 |
| supportedSizes | `["1280x1280", "1568x1056", "1056x1568", "1472x1088", "1088x1472", "1728x960", "960x1728"]` |
| supportedAspectRatios | `["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]` |
| supportsNegativePrompt | false |
| supportsSeed | false |
| defaultSize | `"1280x1280"` |

智谱 adapter 固定使用 `quality="hd"` 与 `watermark_enabled=true`，`user_id` 从 `ZHIPU_USER_ID` 读取，单用户默认值为 `local-user`。

### doubao / Seedream 4.0、4.5、5.0 Lite

| 字段 | 值 |
|------|-----|
| protocol | `sync` |
| modes | `["text-to-image", "image-to-image"]` |
| maxCount | 1（当前同步 job-engine 约束） |
| supportedSizes | `["2K", "4K"]` |
| supportedAspectRatios | `["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]` |
| supportsNegativePrompt | false |
| supportsSeed | true |
| defaultSize | `"2K"` |

Doubao adapter 使用独立 Ark API（默认 `https://ark.cn-beijing.volces.com/api/v3`），文生图/图生图统一提交 `images/generations`；`referenceImages` 映射为 `image[]`，当前默认关闭组图并优先请求内联 Base64，仍兼容 URL fallback。

当前 ModelSpec ID 为 `doubao-seedream-4-0-250828`、`doubao-seedream-4-5-251128`、`doubao-seedream-5-0-260128`；三者首批保持单张、非流式、`sequential_image_generation=disabled`，优先请求 `b64_json` 立即落盘。

### qwen / qwen-image-plus

| 字段 | 值 |
|------|-----|
| protocol | `async` |
| modes | `["text-to-image"]` |
| maxCount | 1（Qwen Image Plus HTTP API 固定 n=1） |
| supportedSizes | `["1664*928", "1472*1104", "1328*1328", "1104*1472", "928*1664"]` |
| supportedAspectRatios | `["16:9", "4:3", "1:1", "3:4", "9:16"]` |
| supportsNegativePrompt | true |
| supportsSeed | true |
| defaultSize | `"1664*928"` |

Qwen adapter 使用 DashScope `text2image/image-synthesis` 创建任务，并通过 `GET /tasks/:taskId` 惰性 poll；任务和图片 URL 有效期约 24 小时，job-engine 必须及时转存。

---

## 5. Lifecycle & Ownership（生命周期与归属）

| 数据 | 创建者 | 存活范围 | 销毁 |
|------|--------|----------|------|
| ImageProvider 实例 | registry（懒创建） | 进程生命周期 | 进程退出 |
| NormalizedRequest | job-engine | 单次 submit 调用 | GC |
| SubmitResult / PollResult | adapter | 单次调用 | 返回给 job-engine 后由 job-engine 决定是否持久化 |
| JobHandle | fal / qwen adapter（submit 时） | 从 submit 到 completed/failed/cancelled | job-engine 在 generation_jobs 中持久化，providers 不持有 |
| ProviderImageRef | adapter（解析响应时） | 厂商 URL 有效期（通常数小时） | URL 过期后不可下载；job-engine 须在过期前转存 |
| ProviderCapabilities | capabilities 静态文件 | 编译时存在 | 随代码部署更新 |
| ProviderModelSpec/profile | Provider capabilities 文件 | 编译时存在，仅 providers 内部可见 | 随对应 Provider 协议更新 |
| ProviderError | adapter（错误时） | 单次调用 | 返回给 job-engine |

**关键边界**: providers 产出的 ProviderImageRef.url 是临时资源。持久化由 job-engine 调用 storage 模块完成，providers 不感知转存结果。

---

## 自检（提交前）

- 所有概念均可在 dfd-interface.md 的数据流中找到使用场景
- ProviderImageRef 明确标注为临时资源，与 db 模块的 Image 实体区分
- SubmitResult/PollResult 的 kind/status 枚举覆盖 sync + async 两种协议路径
- 当前 Batch 1/2 模型的 capabilities 与对应厂商 API 文档一致；同步 provider 的 `maxCount=1` 是现有 job-engine 约束，而非厂商能力上限
