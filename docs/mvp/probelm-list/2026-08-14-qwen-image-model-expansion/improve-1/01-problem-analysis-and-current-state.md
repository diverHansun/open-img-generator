# 1. 问题基线与当前实施状态

> 时间口径：2026-08-14；基线为当前 `mvp` 分支，尚未实施本批代码改动。

## 1.1 核心问题

1. `src/lib/providers/capabilities/qwen.ts` 仍把 `qwen-image-plus` 与 legacy profile 作为 Qwen 模型目录的一部分，旧协议已不是本批目标。
2. `src/lib/providers/adapters/qwen.ts` 的请求构造同时承载 legacy、Qwen multimodal sync 和 Wan multimodal async 三种方言；删除 legacy 后需要保留清晰的 Qwen sync/Wan sync/Wan async 边界。
3. Qwen 3.0 与 Qwen 2.0 新快照属于 multimodal sync；`wan2.7-image` 也有独立的 multimodal sync 参数，不能直接复用 Wan Pro 的 async 参数或 Qwen 2.0 的负面提示词参数。
4. 公开 capabilities 必须与本批产品边界一致：即便官方支持图生图，本批也只能声明 `text-to-image`，否则生成页没有参考图输入会形成能力虚报。
5. 旧测试、provider registry 断言、当前 providers 文档和 quickstart 仍引用 `qwen-image-plus`，删除协议后需要同步收敛。

## 1.2 现有 Qwen 实现

### capabilities 与 ModelSpec

`src/lib/providers/capabilities/qwen.ts` 当前声明：

| ModelSpec | profile | 公开模式 | protocol |
|-----------|---------|----------|----------|
| `qwen-image-plus` | `legacy-text2image-async` | text-to-image | async |
| `qwen-image-2.0-pro` | `multimodal-sync` | text-to-image | sync |
| `wan2.7-image-pro` | `multimodal-async` | text-to-image | async |

公开能力由 `modelCapabilities(qwenModelSpecs)` 投影，前端不会看到 profile；这条信息隐藏边界应保留。

### adapter

`src/lib/providers/adapters/qwen.ts` 当前通过 `buildRequestBody()` 按 profile 分派：

- legacy profile 使用 `input.prompt` 和 `text2image/image-synthesis`。
- Qwen 2.0 Pro sync 使用 `input.messages[].content[].text` 和完整图片响应。
- Wan Pro async 使用 `image-generation/generation`、`X-DashScope-Async`、task poll，并显式关闭 sequential/thinking。

删除 legacy 后，`poll()` 仍需保留，因为 Wan Pro 继续使用 async task lifecycle。

### 生成产品边界

`src/lib/job-engine/validator.ts` 已能识别 `image-to-image` 与 `referenceImages`，但 `src/components/generate/generate-compose.tsx` 没有参考图上传输入。当前生成页只提交 prompt、比例、数量、seed、negative prompt 等文生图参数。因此本批只能声明文生图。

## 1.3 测试现状与缺口

- `src/lib/providers/adapters/qwen.unit.test.ts` 仍以 `qwen-image-plus` 作为默认 legacy async 测试模型，需要改为新增或保留的合法模型。
- `src/lib/providers/registry.unit.test.ts` 断言 `qwen-image-plus` 存在，需要改为新模型集合，同时增加旧模型不存在断言。
- `tests/integration/sync-generation.integration.test.ts` 已有 Qwen 2.0 Pro sync lifecycle，可作为新增 Qwen sync 模型回归基线。
- `tests/integration/async-generation.integration.test.ts` 已有 Wan 2.7 Pro async lifecycle，不应因删除 legacy 协议而删除或改成 sync。
- 现有测试缺少 `wan2.7-image` sync 请求参数互斥断言，也缺少 Qwen 3.0/最新快照的 model ID 级别覆盖。

## 1.4 文档与代码对照

| 文档 | 当前代码 | 差距 |
|------|----------|------|
| `docs/mvp/providers/data-model.md` | 描述 `qwen-image-plus`、Qwen sync、Wan async | 需要更新为新模型目录和三种实际协议边界 |
| `docs/mvp/providers/test.md` | Qwen 正常 submit 仍写 legacy async | 需要改成 Qwen 3/Qwen 2 sync、Wan 标准 sync、Wan Pro async |
| `docs/mvp/api/quickstart.md` | Qwen 示例使用 `qwen-image-plus` | 应改为 `qwen-image-3.0` 或保留模型 `qwen-image-2.0-pro` |
| `model-interface-docs/qwen/` | 已有 2.0/Wan 文档，缺少本批官方快照 | 增加本批官方资料快照，记录只开放文生图的产品取舍 |

## 1.5 跨模块影响

- Provider registry、catalog、Models API 会自动从 Qwen capabilities 投影获得新模型，无需变更公开 DTO。
- job-engine 的 `ProviderCapabilities`、snapshot version、数据库 schema 不需要变更。
- 旧 model 字符串可能存在于历史 generation/job/preferences；本批不删除数据库记录，不增加迁移；新 dispatch 对不再声明的模型返回 `INVALID_REQUEST/not_started`。
- URL 结果仍由现有 storage 链路及时转存，Qwen 24 小时临时 URL 约束不变。

## 1.6 SWE 原则审视摘要

- 信息隐藏：Qwen 模型方言继续留在 `capabilities/qwen.ts` 与 `adapters/qwen.ts`，不污染 job-engine。
- KISS/YAGNI：本批只增加四个文生图 ModelSpec，不为图生图提前改造生成页。
- 高内聚：Wan 标准 sync 与 Wan Pro async 通过不同 profile 表达，避免把参数差异隐藏在 model 字符串条件中。
- 可验证性：先删 legacy 的失败测试和补新 profile 的失败测试，再实施最小代码；sync/async lifecycle 分别用现有 MSW/typed fake 边界验证。
