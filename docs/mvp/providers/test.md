# providers 模块 · test

> 模块路径: `src/lib/providers/`
> 前置文档: goals-duty.md, architecture.md, data-model.md, dfd-interface.md
> 文档顺序: ⑦ test(本文)

---

## 1. Test Scope（测试范围）

### 覆盖

- registry 按 env key 启用/禁用 provider 的行为
- zenmux adapter 的请求翻译与响应解析（sync 路径）
- fal adapter 的请求翻译、submit 句柄解析、poll 状态机（async 路径）
- http-client 的超时与错误码映射
- capabilities 静态声明与 model 查询
- NormalizedRequest 到厂商请求体的字段映射

### 不覆盖

- job-engine 的任务编排与状态持久化（归属 job-engine test）
- storage 下载转存（归属 storage test）
- 真实厂商 API 端到端调用（归属集成测试，需真实 key，CI 不跑）
- prompt 模块处理逻辑（归属 prompt test）
- API 路由层（归属 API 集成测试）

---

## 2. Critical Scenarios（关键场景）

### 2.1 Registry 启用检测

| 场景 | 输入 | 预期 |
|------|------|------|
| FAL_KEY 存在 | env 含 FAL_KEY | listEnabled() 包含 fal |
| FAL_KEY 缺失 | env 无 FAL_KEY | listEnabled() 不包含 fal，不抛错 |
| 两个 key 都存在 | env 含 FAL_KEY + ZENMUX_API_KEY | listEnabled() 包含 fal 和 zenmux |
| 两个 key 都缺失 | env 无 key | listEnabled() 返回空数组 |
| getById 未启用 | getById("fal")，无 FAL_KEY | 抛出 ProviderNotEnabledError |

### 2.2 Zenmux Sync 路径

| 场景 | 输入 | 预期 |
|------|------|------|
| 正常文生图 | prompt="A cat", model="openai/gpt-image-2" | SubmitResult.kind="sync"，images 长度 >= 1，每张含 url |
| 指定尺寸 | width=1024, height=1024 | 请求体 size="1024x1024" |
| 指定张数 | count=2 | 请求体 n=2，images 长度 2 |
| 厂商 401 | mock 返回 401 | SubmitResult.kind="failed"，error.code="AUTH_FAILED" |
| 厂商 422 | mock 返回 422 | SubmitResult.kind="failed"，error.code="INVALID_REQUEST" |
| HTTP 超时 | mock 超时 | SubmitResult.kind="failed"，error.code="TIMEOUT" |

### 2.3 Fal Async 路径

| 场景 | 输入 | 预期 |
|------|------|------|
| 正常 submit | prompt="A cat", model="fal-ai/flux/schnell" | SubmitResult.kind="async"，handle.externalId 非空 |
| poll pending | mock status=IN_QUEUE | PollResult.status="pending" |
| poll running | mock status=IN_PROGRESS | PollResult.status="running" |
| poll completed | mock status=COMPLETED + response 含 images | PollResult.status="completed"，images 含 url |
| poll failed | mock 5xx | PollResult.status="failed"，error.code="PROVIDER_ERROR" |
| cancel | mock 202 | 正常返回，不抛错 |
| cancel 已完成任务 | mock 400 | 抛出 ProviderError |

### 2.4 Capabilities 查询

| 场景 | 输入 | 预期 |
|------|------|------|
| 已知模型 | capabilities("openai/gpt-image-2") | 返回完整 ProviderCapabilities，protocol="sync" |
| 未知模型 | capabilities("nonexistent") | 返回 null |
| fal 模型 | capabilities("fal-ai/flux/schnell") | protocol="async"，supportsSeed=true |

### 2.5 请求翻译

| 场景 | 输入 | 预期 |
|------|------|------|
| 默认尺寸 | 无 width/height/aspectRatio | zenmux 使用 "1024x1024"；fal 使用 "square_hd" |
| aspectRatio 优先 | aspectRatio="16:9"，无 width/height | 翻译为厂商支持的对应尺寸 |
| providerOptions 透传 | providerOptions={ "guidance_scale": 7 } | fal 请求体含 guidance_scale（fal 认识的字段） |

---

## 3. Integration Points（集成点测试）

### 3.1 与 job-engine 的契约

| 验证点 | 方式 |
|--------|------|
| SubmitResult 的 kind 枚举与 job-engine 分支匹配 | 类型导出一致性检查（TypeScript 编译） |
| JobHandle 可 JSON 序列化/反序列化 | 单元测试：serialize → deserialize → poll 可正常调用 |
| ProviderImageRef.url 为有效 URL 格式 | adapter 测试中断言 url 以 https:// 开头 |
| ProviderError.retryable 字段存在 | 各错误码映射测试覆盖 |

### 3.2 与外部厂商 API 的隔离

| 验证点 | 方式 |
|--------|------|
| adapter 不硬编码 API key | 代码审查 + 测试用 mock env |
| http-client 正确注入 Authorization | mock fetch 断言 header |
| fal 使用 `Key $FAL_KEY` 格式 | mock fetch 断言 header 值 |
| zenmux 使用 `Bearer $ZENMUX_API_KEY` 格式 | mock fetch 断言 header 值 |

---

## 4. Verification Strategy（验证策略）

### 4.1 单元测试（主力）

- **框架**: 项目标准测试框架（实现阶段确定，建议 vitest）
- **位置**: `src/lib/providers/__tests__/`
- **mock 策略**: mock `http-client` 层（不 mock fetch 全局），传入预设响应
- **覆盖重点**: adapter 请求翻译、响应解析、registry 启用逻辑

### 4.2 契约测试

- 导出 types 的 TypeScript 编译检查：`npm run typecheck` 确保 types 无循环依赖
- JobHandle JSON round-trip 测试

### 4.3 手工验证（可选，开发阶段）

- 配置真实 FAL_KEY + ZENMUX_API_KEY
- 通过 API 端点发起真实生成，确认 sync/async 两条路径端到端可用
- 不在 CI 中运行

### 4.4 测试文件建议布局

```
src/lib/providers/__tests__/
├── registry.test.ts
├── adapters/
│   ├── fal.test.ts
│   └── zenmux.test.ts
├── http-client.test.ts
└── fixtures/
    ├── fal-submit-response.json
    ├── fal-poll-completed.json
    └── zenmux-generate-response.json
```

---

## 自检（提交前）

- 每个 Critical Scenario 可追溯到 goals-duty 中的一条 Duty
- sync 与 async 路径均有独立测试场景
- 明确区分单元测试（mock）与真实 API 测试（手工）
- 未测试 job-engine/storage 的职责（边界清晰）
