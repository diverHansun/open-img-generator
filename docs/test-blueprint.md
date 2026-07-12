# 项目测试规则

> 适用范围：AI Image Generator MVP
> 关联文档：docs/mvp/review.md、docs/mvp/api/constraints.md、docs/mvp/api/quickstart.md
> 最后确认：2026-07-12

---

## 一、测试分类

采用 4 类测试，文件后缀统一为：

| 类型 | 后缀 | 回答的质量问题 |
|------|------|----------------|
| unit | `.unit.test.ts` | 单个函数/类/模块的局部逻辑正确吗？ |
| contract | `.contract.test.ts` | 消费者可见的接口/DTO/输出格式稳定吗？ |
| integration | `.integration.test.ts` | 多个真实组件协作时行为正确吗？ |
| smoke | `.smoke.test.ts` | 环境、构建、启动、迁移可用吗？ |

### 1.1 unit

- 不访问真实网络、外部 API、外部进程
- 直接依赖使用 mock、stub 或 typed fake
- 执行速度应很快（通常 < 10ms / 用例）
- 失败时能精确定位到具体逻辑错误

### 1.2 contract

- 验证 API 路由的输入/输出结构、HTTP 状态码、错误形态
- 接口之下的业务层用 fake job-engine / fake providers 替换
- 保留 route handler 本身真实执行

### 1.3 integration

- 至少两个真实组件协作
- 使用真实 Drizzle + 临时 SQLite 文件、真实 storage 临时目录
- 只 mock 不可控外部依赖：fal.ai HTTP API、ZenMux HTTP API
- 文件名或目录应清楚说明集成了哪些模块

### 1.4 smoke

- 验证构建、启动、健康检查、数据库迁移
- 不深入验证业务逻辑

---

## 二、目录与命名规范

### 2.1 混合策略

- **单模块局部测试**：与被测源码同目录（co-located）
- **跨模块集成测试**：`tests/integration/<domain>/`
- **契约测试**：`tests/contract/<domain>/`
- **冒烟测试**：`tests/smoke/`

### 2.2 目录结构示例

```
src/lib/
  db/
    schema.ts
    queries/
      sessions.ts
      sessions.unit.test.ts
  prompt/
    process.ts
    process.unit.test.ts
  providers/
    adapters/
      fal.ts
      fal.unit.test.ts
    registry.ts
    registry.unit.test.ts
  storage/
    index.ts
    storage.unit.test.ts
    storage.integration.test.ts
  job-engine/
    validator.ts
    validator.unit.test.ts
    lifecycle.ts
    lifecycle.unit.test.ts
    orchestrator.ts
    orchestrator.integration.test.ts

tests/
  contract/
    generations-api.contract.test.ts
  integration/
    submit-generation.integration.test.ts
    get-generation-poll.integration.test.ts
    session-generations.integration.test.ts
  smoke/
    health.smoke.test.ts
    build.smoke.test.ts
```

### 2.3 文件命名

```
<subject>.<type>.test.ts
```

示例：
- `process.unit.test.ts`
- `fal.unit.test.ts`
- `generations-api.contract.test.ts`
- `submit-generation.integration.test.ts`

### 2.4 测试用例命名

描述**行为**而非实现细节：

- ✅ "returns completed when sync provider submits and stores images"
- ✅ "skips poll when another request is already advancing via optimistic lock"
- ❌ `testHandleRequest` / `test1` / `case3`

### 2.5 维护规则

- 模块移动时同步移动 co-located 测试
- 集中测试如果实际只验证单模块纯逻辑，应下沉到源码旁
- co-located 测试如果开始串联多个模块，应上移到 `tests/`

---

## 三、测试编写规范

### 3.1 Mock / Fake 边界

| 测试类型 | 替换范围 | 真实部分 |
|----------|----------|----------|
| unit | 被测对象的直接依赖 | 被测函数/类/模块自身 |
| contract | 接口之下的业务层 | route handler + 请求构造 |
| integration | fal/zenmux HTTP（MSW fake） | db、storage、被集成的真实组件 |
| smoke | 尽量不替换 | 真实启动/构建环境 |

### 3.2 外部 HTTP 替换

- 统一使用 **MSW** 拦截 fal.ai / ZenMux HTTP 请求
- 禁止 unit/integration 测试调用真实厂商 API
- 需要真实外部服务的测试必须通过环境变量显式启用，并在无凭据时自动 skip

### 3.3 数据库

- unit 测试使用 typed fake 或内存 SQLite
- integration 测试使用 **临时 SQLite 文件**（真实 better-sqlite3 + Drizzle），每个测试独立文件或独立 schema

### 3.4 文件系统

- integration 中 storage 使用 `fs.mkdtempSync` 创建的临时目录
- 测试结束后清理临时目录

### 3.5 工厂函数

统一放在 `tests/factories.ts`，为以下领域对象提供工厂：

```ts
makeSubmitGenerationParams(overrides = {})
makeNormalizedRequest(overrides = {})
makeProviderImageRef(overrides = {})
makeJobHandle(overrides = {})
makeProviderCapabilities(overrides = {})
```

规则：
- 默认值接近真实结构，但值可简化
- 每个测试自包含，不依赖其他测试运行后的状态
- 不使用真实生产数据

### 3.6 断言规范

- 使用 Vitest 内置 `expect`
- 断言**输出和副作用**，不验证内部私有方法调用
- 优先具体断言，避免 `toBeTruthy()` 等模糊断言
- 错误测试断言 `{ code, message, retryable }` 结构

### 3.7 异步与轮询

- 轮询测试使用受控 fake timer 或固定小 sleep
- 覆盖 `pending → running → completed` 与 `pending → failed` 状态迁移
- 覆盖并发 GET 的乐观锁行为

### 3.8 TDD 要求

- **核心逻辑强制 TDD**：validator、lifecycle.storeImages、状态机聚合、provider adapter 请求/响应解析
- 纯路由转发/API 层可后补 contract 测试
- 文档、类型调整不要求 TDD

### 3.9 禁止事项

- unit 测试调用真实外部服务
- 为方便测试给生产类增加 test-only 方法
- mock 被测对象自己的方法
- 使用无类型约束的万能 mock 掩盖接口错误
- 跨模块测试堆在一个文件里不按 domain 拆分
- 只断言"没抛错"却不验证实际状态或输出

---

## 四、CI 执行策略

### 4.1 package.json 脚本

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run **/*.unit.test.ts",
    "test:contract": "vitest run **/*.contract.test.ts",
    "test:integration": "vitest run **/*.integration.test.ts",
    "test:smoke": "vitest run **/*.smoke.test.ts",
    "preflight": "npm run typecheck && npm run test:unit && npm run test:contract"
  }
}
```

### 4.2 阶段递进

| 阶段 | 执行范围 | 失败后果 |
|------|----------|----------|
| 本地开发 | `npm run test:unit` 或相关测试 | 修复后继续 |
| 提交前 | `npm run preflight`（typecheck + unit + contract） | 阻断提交 |
| PR 检查 | preflight + integration | 阻断合入 |
| 合并前 | unit + contract + integration + build | 阻断合并 |
| 发布前 | 全部 + smoke | 阻断发布 |

### 4.3 速度预算

| 类型 | 单文件目标 | 全 suite 目标 |
|------|------------|---------------|
| unit | 秒级 | < 30s |
| contract | 秒级 | < 60s |
| integration | 十秒级 | < 5min |
| smoke | 视环境 | 视环境 |

### 4.4 失败处理原则

- unit/contract 失败 → 必须修复
- integration 失败 → 优先判断是分类错误、mock 边界错误还是实现问题
- smoke 失败 → 排查环境或基础设施
- flaky 测试 → 隔离到 quarantine，一周内修复或删除

---

## 五、与 MVP 编码顺序的配合

按 review.md §5 顺序编码时，**每个模块完成后即补充对应测试**：

1. db → schema + queries + `*.unit.test.ts`
2. prompt → `process.ts` + `process.unit.test.ts`
3. storage → downloadAndStore + getReadStream + unit/integration
4. providers → types + registry + fal/zenmux adapters + unit
5. job-engine → validator + lifecycle + orchestrator + unit/integration
6. API routes → route handlers + contract tests
7. 垂直切片 → 按 quickstart.md 两条路径跑 integration/smoke

---

## 六、附录

### 6.1 测试数据工厂模板

```ts
// tests/factories.ts
export function makeSubmitGenerationParams(overrides: Partial<SubmitGenerationParams> = {}): SubmitGenerationParams {
  return {
    provider: 'fal',
    model: 'fal-ai/flux/schnell',
    prompt: 'A cat wearing a space helmet',
    mode: 'text-to-image',
    count: 1,
    ...overrides,
  };
}
```

### 6.2 MSW 启用示例

```ts
// tests/msw/server.ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const server = setupServer(
  http.post('https://queue.fal.run/*', () => {
    return HttpResponse.json({ request_id: 'req-1', status_url: '...', response_url: '...' });
  }),
);
```

---

## 自检

- [ ] 所有新增测试文件遵循 `<subject>.<type>.test.ts` 命名
- [ ] unit 不访问真实网络/数据库/文件系统
- [ ] integration 使用临时 SQLite 文件与临时 storage 目录
- [ ] 外部厂商 API 统一用 MSW 替换
- [ ] 核心逻辑变更遵循 TDD 流程
