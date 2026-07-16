# providers 模块 · dfd-interface

> 模块路径: `src/lib/providers/`
> 前置文档: goals-duty.md, architecture.md, data-model.md
> 文档顺序: ④ dfd-interface(本文) → ⑦ test

---

## 1. Context & Scope（上下文与范围）

### 交互模块

| 方向 | 模块 | 交互内容 |
|------|------|----------|
| 上游调用方 | job-engine | 传入 NormalizedRequest，接收 SubmitResult / PollResult |
| 上游调用方 | API 层（经 job-engine 或直接） | 通过 registry 获取 ProviderInfo 列表 |
| 下游依赖 | 外部厂商 API | fal.ai queue API、ZenMux OpenAI Images API |
| 平级模块 | prompt | job-engine 在调用 providers 前先经 prompt 模块处理 prompt；providers 不直接依赖 prompt |

### 本文档范围

- 描述数据如何进入/离开 providers 模块
- 定义 providers 对外暴露的函数接口
- 明确数据归属

不描述: job-engine 内部编排、storage 转存流程、API 路由细节。

---

## 2. Data Flow Description（数据流描述）

### 2.1 查询已启用 Provider 列表

```
API 层
  → registry.listEnabled()
    → 遍历注册的 provider id
    → 检查对应 env key 是否存在
    → 存在: 读取 capabilities 静态表，组装 ProviderInfo
    → 不存在: 跳过（静默，不报错）
  → 返回 ProviderInfo[] 给 API 层
```

### 2.2 Sync 路径（zenmux / openai/gpt-image-2）

```
job-engine
  → 构造 NormalizedRequest（prompt 已由 prompt 模块处理）
  → registry.getById("zenmux")
  → provider.submit(req, "openai/gpt-image-2")
    → zenmux adapter: NormalizedRequest 翻译为 OpenAI Images API 请求体
      - prompt → prompt
      - width+height 优先，否则 aspectRatio 经映射表 → size（如 "1:1"→"1024x1024"）
      - count → n
    → http-client: POST https://zenmux.ai/api/v1/images/generations
    → zenmux adapter: 解析响应 data[].url → ProviderImageRef[]
  → 返回 SubmitResult { kind: "sync", images: [...] }
→ job-engine 拿到 images[].url，交给 storage 下载转存
```

### 2.3 Async 路径 — Submit（fal / fal-ai/flux/schnell）

```
job-engine
  → 构造 NormalizedRequest
  → registry.getById("fal")
  → provider.submit(req, "fal-ai/flux/schnell")
    → fal adapter: NormalizedRequest 翻译为 fal queue 请求体
      - prompt → prompt
      - width+height 若可推导则用之；否则 aspectRatio 经映射表 → image_size（如 "1:1"→"square_hd"）
      - seed → seed（若有）
      - count → num_images
    → http-client: POST https://queue.fal.run/fal-ai/flux/schnell
    → fal adapter: 解析响应 request_id / status_url / response_url / cancel_url
      → 组装 JobHandle
  → 返回 SubmitResult { kind: "async", handle: JobHandle }
→ job-engine 将 handle 序列化存入 generation_jobs.provider_handle
→ generation 状态置为 pending
```

### 2.4 Async 路径 — Poll（fal，惰性推进）

```
job-engine（在 GET /api/generations/:id 时触发）
  → 从 generation_jobs 读取 provider_handle
  → registry.getById("fal")
  → provider.poll(handle)
    → fal adapter: GET handle.statusUrl
    → 解析状态:
      - IN_QUEUE → PollResult { status: "pending" }
      - IN_PROGRESS → PollResult { status: "running" }
      - COMPLETED → GET handle.responseUrl → 解析 images → PollResult { status: "completed", images }
      - 错误 → PollResult { status: "failed", error }
  → 返回 PollResult 给 job-engine
→ job-engine 根据 status 更新 generation_jobs 状态
→ 若 completed: 将 images[].url 交给 storage 下载转存
```

### 2.5 Async 路径 — Cancel（MVP 预留，API 不暴露）

```
job-engine（后续前端"取消"功能时）
  → provider.cancel(handle)
    → fal adapter: PUT handle.cancelUrl
  → 返回成功/失败
→ job-engine 更新 generation_jobs 状态为 cancelled
```

MVP 不实现取消 API 端点，但 fal adapter 实现 cancel 方法，接口契约预留。

### 2.6 失败路径（通用）

```
任意 adapter 内 HTTP 调用失败
  → http-client 映射 HTTP 状态码为 ProviderError
  → adapter 返回 SubmitResult { kind: "failed", error } 或 PollResult { status: "failed", error }
→ job-engine 记录错误，更新 generation 状态为 failed
→ 不在 providers 内重试
```

---

## 3. Interface Definition（接口定义）

### 3.1 registry.listEnabled()

| 属性 | 值 |
|------|-----|
| 输入 | 无 |
| 输出 | `ProviderInfo[]` |
| 同步/异步 | 同步 |
| 副作用 | 无（只读 env + 静态 capabilities） |

### 3.2 registry.getById(id: ProviderId)

| 属性 | 值 |
|------|-----|
| 输入 | provider id |
| 输出 | `ImageProvider` 实例 |
| 同步/异步 | 同步 |
| 失败 | 抛出 `ProviderNotEnabledError`（该 id 无 env key 或 adapter 未实现） |

### 3.3 ImageProvider.submit(req, model)

| 属性 | 值 |
|------|-----|
| 输入 | `NormalizedRequest` + model id 字符串 |
| 输出 | `SubmitResult` |
| 同步/异步 | 同步（函数本身同步返回；async 厂商返回的 SubmitResult.kind 为 "async"） |
| 超时 | adapter 内通过 http-client 设置（建议 30s submit 超时） |
| 副作用 | 向外部厂商发起 HTTP 请求 |

### 3.4 ImageProvider.poll(handle)（仅 async provider）

| 属性 | 值 |
|------|-----|
| 输入 | `JobHandle` |
| 输出 | `PollResult` |
| 同步/异步 | 同步 |
| 超时 | 建议 15s poll 超时 |
| 副作用 | 向外部厂商发起 1-2 次 HTTP 请求（status + 可能的 response） |

### 3.5 ImageProvider.cancel(handle)（仅 async provider）

| 属性 | 值 |
|------|-----|
| 输入 | `JobHandle` |
| 输出 | `void`（成功）或抛出 `ProviderError` |
| 同步/异步 | 同步 |
| MVP | 实现但不暴露 API |

### 3.6 ImageProvider.id 与 ImageProvider.capabilities

| 属性 | 值 |
|------|-----|
| id | `ProviderId` 只读属性 |
| capabilities | `(model: string) => ProviderCapabilities | null` |

---

## 4. Data Ownership & Responsibility（数据归属与责任）

| 数据 | 创建 | 更新 | 销毁 | 责任模块 |
|------|------|------|------|----------|
| NormalizedRequest | job-engine | 不可变 | 调用结束 | job-engine 创建，providers 只读 |
| SubmitResult / PollResult | providers (adapter) | 不可变 | 返回后 | providers 创建，job-engine 消费 |
| JobHandle | providers (fal adapter) | 不可变（句柄本身不变） | job-engine 在任务终结后随 job 记录归档 | providers 创建，job-engine 持久化 |
| ProviderImageRef | providers (adapter) | 不可变 | 厂商 URL 过期 | providers 创建，job-engine 须在过期前交给 storage |
| ProviderError | providers (adapter) | 不可变 | 返回后 | providers 创建，job-engine 记录到 job |
| ProviderInfo / Capabilities | providers (静态配置) | 随代码部署 | - | providers 拥有 |
| 厂商 API Key | 环境变量 | 运维更新 | - | 部署环境拥有，providers 只读取 |

---

## 自检（提交前）

- 每条数据流可对应到 data-model.md 中的概念
- sync 与 async 两条路径均已描述
- 失败路径有明确归属（providers 返回 error，job-engine 决定后续）
- poll 由 job-engine 惰性触发，providers 不自主轮询
