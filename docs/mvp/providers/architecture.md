# providers 模块 · architecture

> 模块路径: `src/lib/providers/`
> 前置文档: goals-duty.md (已确认)
> 文档顺序: ① goals-duty → ② architecture(本文) → ③ data-model → ④ dfd-interface → ⑦ test

---

## 1. Architecture Overview（总体架构）

providers 模块由四个子组件组成，依赖方向单向向下：

```
registry ──→ adapter(s) ──→ http-client
    │
    ├──→ capabilities (静态模型能力)
    ├──→ limiter (job-engine 调用边界)
    └──→ types (共享类型，被各子组件引用)
```

| 子组件 | 职责 |
|--------|------|
| **types** | 定义模块内外的共享数据结构：NormalizedRequest、SubmitResult、ProviderCapabilities 等。是整个系统与厂商之间的"通用语言"。 |
| **registry** | 按 env key 判断启用状态，懒初始化 adapter 实例，对外提供 `listEnabled()` 与 `getById(id)`。是模块唯一对外入口（除 types 导出外）。 |
| **adapter** | 每家厂商一个文件，实现 ImageProvider 契约：请求翻译、HTTP 调用、响应解析。当前已含 `fal.ts`、`zenmux.ts`、`siliconflow.ts`、`zhipu.ts`、`doubao.ts`、`qwen.ts` 与独立 Kling `kling.ts`。 |
| **http-client** | 封装 fetch 调用：caller deadline、默认超时、manual redirect、2 MiB 流式 JSON 上限与统一错误元数据。具体 API key 由 adapter 读取 `env > user-config` 后传入；adapter 不直接裸调 fetch。 |
| **timeout-policy** | 解析同步生图完整响应的有界预算；四个 sync adapter 共用 180 秒上限，避免在 adapter 内分散读取环境变量。 |
| **endpoint-policy** | 校验可配置 Provider base、bounded external ID 与 Fal exact-origin 动态 URL；把 DB/Provider 返回的字符串隔离在带凭据的请求边界之外。 |

**依赖规则**:
- registry 依赖 adapter 与 types
- adapter 依赖 http-client 与 types
- http-client 仅依赖 types（错误类型）
- adapter 可依赖 endpoint-policy；endpoint-policy 不依赖 adapter、http-client 或业务层
- types 不依赖任何子组件
- adapter 之间互不依赖
- 模块整体不依赖 job-engine、storage、db

---

## 2. Design Pattern & Rationale（设计模式与理由）

### 2.1 Adapter 模式

每家厂商一个 adapter 文件，把异质协议翻译成统一 ImageProvider 接口。

- **支撑目标**: Design Goal #1（新增厂商成本最小化）、#2（协议差异藏在统一接口身后）
- **变化点隔离**: 厂商 API 字段、认证方式、响应格式变化只影响对应 adapter

### 2.2 Registry 模式

集中管理 provider 实例的创建与查询，按 env key 决定启用。

- **支撑目标**: Design Goal #4（按需启用、缺 key 不报错）
- **懒初始化**: 首次 `getById` 时才创建 adapter 实例，避免启动时因缺 key 抛错

### 2.3 策略式协议分支（非完整 Strategy 框架）

sync 与 async 两种协议形态通过 ImageProvider 接口上的可选方法（`poll`/`cancel`）区分，而非引入独立的策略类层次。

- **支撑目标**: Design Goal #2，同时控制复杂度
- **未采用完整 Strategy 类层次的原因**: 当前仍是少量厂商、两种协议，独立策略类会增加文件数但不减少变化点

### 2.4 未使用的模式

| 模式 | 不采用原因 |
|------|-----------|
| Factory Method | registry 已承担实例创建职责，再加 Factory 是重复抽象 |
| Observer / Event | providers 是无状态调用层，无事件发布需求 |
| Decorator | 重试/限流策略由 job-engine 触发；`providers/limiter.ts` 仅提供被 job-engine 调用的 per-provider semaphore，不改变 adapter 职责 |

---

## 3. Module Structure & File Layout（模块结构与文件组织）

```
src/lib/providers/
├── index.ts                 # 对外导出: registry 函数 + 全部 types
├── types.ts                 # 共享数据结构（详见 data-model.md）
├── registry.ts              # 启用检测 + 懒初始化 + listEnabled/getById
├── http-client.ts           # fetch 封装（deadline、manual redirect、bounded JSON、错误映射）
├── timeout-policy.ts         # sync 生图 submit 的共享三分钟预算
├── endpoint-policy.ts       # 受信 base / task ID / exact-origin 动态 URL
├── adapters/
│   ├── fal.ts               # fal.ai async queue adapter
│   ├── zenmux.ts            # ZenMux sync OpenAI Images API adapter
│   ├── siliconflow.ts        # SiliconFlow sync image generations adapter
│   ├── zhipu.ts              # Zhipu GLM-Image sync adapter
│   ├── doubao.ts              # Doubao/Ark Seedream sync adapter
│   └── qwen.ts                # Qwen Image/DashScope async adapter
└── capabilities/
    ├── fal.ts               # fal 各 model 的 capabilities 声明
    ├── zenmux.ts            # zenmux 各 model 的 capabilities 声明
    ├── siliconflow.ts        # SiliconFlow 各 model 的 capabilities 声明
    ├── zhipu.ts              # Zhipu 各 model 的 capabilities 声明
    ├── doubao.ts              # Doubao 各 model 的 capabilities 声明
    └── qwen.ts                # Qwen 各 model 的 capabilities 声明
```

**稳定对外接口**（其他模块可依赖）:
- `src/lib/providers/index.ts` 导出的 types 与 registry 函数

**内部实现**（不应被外部直接 import）:
- `adapters/*`、`http-client.ts`、`capabilities/*`

**capabilities 独立文件的理由**:
- capabilities 声明会随模型增加而膨胀，与 adapter 的协议翻译逻辑正交
- 前端 `GET /api/providers` 需要 capabilities 但不需 adapter 实现细节

---

## 4. Architectural Constraints & Trade-offs（约束与权衡）

### 4.1 HTTP 直调，不用厂商 SDK

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: 原生 fetch** | 需手写请求/响应解析 | 协议语义清晰；async provider 不被 SDK 封装成阻塞式 await；依赖更少 |
| 放弃: fal SDK | SDK 省少量样板代码 | SDK 把 submit+polling 封装为一次 await，与 job-engine 惰性推进语义冲突 |

### 4.1.1 同步与异步的 timeout 边界

ZenMux、SiliconFlow、智谱和 Doubao 的 `submit()` 成功响应本身承载完整图片，统一使用 `SYNC_IMAGE_GENERATION_TIMEOUT_MS`：默认 180 秒、只接受不大于 180 秒的正整数毫秒，非法配置回退默认值。fal、Qwen、Kling 的 submit 仅创建远端 task，继续使用 HTTP helper 的 30 秒 submit / 15 秒 poll 默认值。任何已进入网络的 submit 超时仍是 `unknown`，由 job-engine 终态收口，绝不自动重放。

### 4.2 capabilities 静态声明，不运行时探测

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: 代码内静态表** | 新增模型需手动更新 capabilities 文件 | 启动无额外 HTTP 调用；前端可即时展示选项 |
| 放弃: 调厂商 API 动态获取 | 数据"更准确" | 多数厂商无统一能力查询 API；增加启动延迟与失败面 |

### 4.3 透传字段（providerOptions）由 adapter 自行解析

NormalizedRequest 中含 `providerOptions?: Record<string, unknown>`，各 adapter 从中取自己认识的字段。

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: 松散透传** | 类型安全弱 | 不需要为每家厂商特技改 NormalizedRequest 核心字段 |
| 放弃: 强类型 per-provider 请求 | 类型安全强 | 每增一家厂商需改核心类型，违反 Goal #1 |

### 4.4 Provider 分批接入

当前已完成 Batch 1（SiliconFlow、智谱）、Batch 2（Doubao/Ark、Qwen/DashScope）与 Batch 3（Kling 独立 API）。Doubao 是同步响应，Qwen/Kling 是创建任务 + poll 异步流程；Kling 标准图片端点单次最多 1 张参考图、最多 9 张结果，标准协议没有远程取消端点。

Kling adapter 使用 `https://api-singapore.klingai.com`（可由 `KLING_BASE_URL` 覆盖），`POST/GET /v1/images/generations`，Bearer `KLING_API_KEY`；不复用 DashScope 鉴权或 URL。标准端点没有远程 cancel，因此取消由 job-engine 本地标记兜底。

### 4.5 公开宽高比 vs 厂商 size 枚举

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: capabilities 暴露公开 `supportedAspectRatios`；adapter 内维护 ratio→vendor size 表** | 每家一张映射表 | web-ui / job-engine 用同一套比字符串；扇出共享 `aspectRatio` 可行 |
| 放弃: UI 直接展示 fal 的 `square_hd` 等 | 无映射表 | 跨厂商无法共享选项；违反扇出 UX |

**尺寸解析优先级**（不变）: `width`+`height` > `aspectRatio` > `defaultSize`。

**无法映射**: adapter 返回 `SubmitResult.kind="failed"` / `INVALID_REQUEST`，或由 job-engine 在校验阶段用 capabilities 拦截（优先校验拦截）。

---

## 自检（提交前）

- 每个子组件能追溯到 goals-duty 中的至少一条 Design Goal 或 Duty
- 未引入 goals-duty Non-Duties 中的能力（存图、扇出、写库等）
- 公开宽高比映射归属 adapter，不泄漏到 job-engine
- 文件布局体现"加一家厂商 = 加一个 adapter 文件"的扩展路径
