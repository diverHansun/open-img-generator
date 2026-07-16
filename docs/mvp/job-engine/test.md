# job-engine 模块 · test

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md, architecture.md, dfd-interface.md, use-case.md
> 文档顺序: ⑦ test(本文)
> 项目级规则: 遵循 `docs/test-blueprint.md`（若有）；本文件只补充扇出相关场景
> 修订说明: 2026-07-15 增加 targets 扇出 / 聚合 / 锁收紧场景

---

## 1. Test Scope（测试范围）

### 覆盖

- submitGeneration：单 target 与多 target（事务写 N jobs、逐 target dispatch）
- 每 target 校验（aspectRatio、sync count=1、negativePrompt）
- seed：不支持的 target 省略；支持的 target 传入
- getGeneration：并行 advance 多个 async job；聚合 status
- 部分失败隔离（一 job failed 不影响另一 job completed）
- poll lease：pending/running 均可 claim；并发第二次跳过、过期后可恢复
- storeImages 幂等与单 job 内部分转存失败
- NormalizedRequest 显式 pick（无 provider/model/sessionId）

### 不覆盖

- providers 内 aspectRatio→厂商 size 映射表（归属 providers test）
- web-ui 交集算法（归属 web-ui test）
- 真实厂商 E2E（手工 / 可选集成）

---

## 2. Critical Scenarios（关键场景）

### 2.1 Submit — 单 target（回归）

| 场景 | 预期 |
|------|------|
| zenmux sync 成功 | 1 job completed；images 含 contentType/sizeBytes/index |
| fal async 成功 | 1 job pending；providerHandle 非空 |
| session 不存在 | ValidationError；无 generation |
| sync count=2 | ValidationError |

### 2.2 Submit — 扇出

| 场景 | 预期 |
|------|------|
| targets=[fal, zenmux]，aspectRatio=1:1 | 1 gen + 2 jobs；zenmux 可 completed；fal pending；聚合 pending/running |
| targets 为空 | ValidationError |
| targets 重复 (provider,model) | ValidationError |
| aspectRatio=16:9（zenmux 不支持） | ValidationError；无库记录 |
| fal submit 失败 + zenmux 成功 | fal job failed；zenmux completed；聚合 completed |
| 两 target 均失败 | 聚合 failed |

### 2.3 Seed 裁剪

| 场景 | 预期 |
|------|------|
| seed=42，targets 含 fal+zenmux | 发给 fal 的 NormalizedRequest 含 seed；发给 zenmux 的不含 seed；整单不 400 |

### 2.4 Get — 多 job 推进

| 场景 | 预期 |
|------|------|
| 两 async pending，mock 均 completed | 两次 storeImages；聚合 completed |
| 一 job 已 completed，一 job pending | 只 poll pending 那个 |
| generation 已全部终态 | 不调用 poll |

### 2.5 乐观锁

| 场景 | 预期 |
|------|------|
| 并发两次 advance 同一 pending job | 仅一次 poll；另一次 lease claim 行数 0 跳过 |
| job 已 running、无 lease | 可继续 poll，且 claim 不把 status 改写为锁状态 |
| lease 已过期 | 下一次 GET 成功 claim 并恢复 poll |

### 2.6 转存

| 场景 | 预期 |
|------|------|
| 单 job 第 2 张 download 失败 | 该 job failed；index0 保留；其他 job 不变 |
| imageExists 为 true | 跳过 download |

### 2.7 事务

| 场景 | 验证 |
|------|------|
| createGeneration + N createGenerationJob | 同一 transaction；失败则全部回滚 |

---

## 3. Integration Points（集成点测试）

| 验证点 | 方式 |
|--------|------|
| 每 target 收到正确 model + 裁剪后的 NormalizedRequest | mock provider.submit 断言 |
| 聚合函数与 constraints §8 一致 | 单元表驱动测试 |
| GET session/history 只读，不调用 getGeneration 推进 | API/合同测试 |

---

## 4. Verification Strategy（验证策略）

- 单元: mock providers/prompt/storage/db
- 集成: 内存 SQLite + 真实 transaction + mock HTTP
- 合同: POST/GET JSON 形状含 `targets` / 多 `jobs`
- 回归: 保留原单模型路径用例（`targets` 长度为 1）

---

## 自检（提交前）

- 扇出、部分成功聚合、seed 裁剪、锁收紧均有场景
- 不测试 UI 交集或 adapter 映射表细节
