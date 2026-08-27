# 2. 优化方案与改动面

## 2.1 方案总览

保持单一 Qwen provider、现有 `ProviderModelSpec` 和 job-engine 契约不变，只调整 Qwen 的静态 ModelSpec、adapter 方言分派和相关文档/测试。

```text
Qwen ModelSpec
  ├─ qwen-image-3.0-pro       ─┐
  ├─ qwen-image-3.0            ├─ multimodal-sync
  ├─ qwen-image-2.0-pro-...   ─┘
  ├─ qwen-image-2.0-pro       ─── multimodal-sync（保留）
  ├─ wan2.7-image              ─── wan-multimodal-sync
  └─ wan2.7-image-pro          ─── wan-multimodal-async（保留）
```

删除 `legacy-text2image-async` profile；不删除 Qwen 的 `poll()` 共用逻辑，因为 Wan Pro 仍依赖 task poll。

## 2.2 设计决策

| 决策项 | 选择 | 理由 | 放弃选项 | 代价 |
|--------|------|------|----------|------|
| Qwen 3.0 协议 | multimodal sync | 官方同步接口返回完整 choices 图片；复用已有 180 秒同步预算 | 为 Qwen 3 强行走异步 | 失去 durable task 轮询，但降低本批复杂度 |
| Qwen 最新快照 | 独立 model ID，复用 Qwen sync profile | 快照 ID 是官方可调用的稳定字符串；与 alias 分开便于回滚 | 只更新 alias、不注册快照 | 无法按用户指定模型选择 |
| Wan 标准版 | 新增 `wan-multimodal-sync` profile | Wan 参数含 `thinking_mode`/`enable_sequential`，不能复用 Qwen sync | 复用 `multimodal-sync` 或 Wan Pro async | 增加一个离散 profile，但协议边界清晰 |
| 产品模式 | 公开 capabilities 只填 `text-to-image` | 当前生成页没有参考图上传 | 同时声明 `image-to-image` | 官方能力暂不能从 UI 使用 |
| legacy 删除 | 从静态目录、adapter、测试、当前模块文档删除 | 用户明确要求停止旧模型支持 | 保留兼容别名 | 旧未完成任务不再可继续 dispatch，属于已确认兼容性代价 |
| 默认尺寸 | 继续使用当前保守的 1K 比例映射 | 官方允许更高分辨率，但本批先控制费用与 live 验收风险 | 首批默认 2K/4K | 需要后续单独扩展尺寸能力 |

## 2.3 分阶段实施

### Phase 1：ModelSpec 与 adapter 方言

- 修改 `src/lib/providers/capabilities/qwen.ts`：删除 legacy；新增 3 个 Qwen sync model 和 `wan2.7-image` sync model；保留现有 Qwen 2.0 Pro、Wan Pro。
- 修改 `src/lib/providers/adapters/qwen.ts`：删除 legacy body/parser 分支；新增 Wan sync body 分支；保留 Qwen sync、Wan async、task poll 和错误映射。
- DoD：所有六个目标/保留模型可由 adapter 找到；`qwen-image-plus` 在 submit 前返回 `INVALID_REQUEST/not_started`；Qwen/Wan sync 请求字段精确。

### Phase 2：测试与集成

- 修改 Qwen adapter unit tests、registry tests。
- 增加 Qwen 3.0 Pro、Qwen 3.0、最新快照和 Wan 标准版的 sync body/response 测试。
- 增加 Wan 标准版通过 route + job-engine + MSW + storage 的 sync integration；保留 Wan Pro async integration。
- DoD：目标测试、typecheck、unit、contract、integration 通过。

### Phase 3：当前文档与运行验收

- 更新 `docs/mvp/providers/{architecture,data-model,dfd-interface,test}.md` 和 `docs/mvp/api/quickstart.md` 中的当前支持说明。
- 新增本批 `model-interface-docs/qwen/qwen-image-3-and-models.md`。
- 执行 `npm run build`、`npm run test:release` 或在当前环境记录无法执行的具体原因。
- 启动开发服务，使用 WebUI 选择 Qwen provider 中新增模型，提交一次 count=1、低风险 prompt 的真实文生图，验证生成状态、图片显示与本地历史读取。

## 2.4 改动面

| 区域 | 修改 | 删除/新增 |
|------|------|-----------|
| `src/lib/providers/capabilities/qwen.ts` | model/profile 静态目录 | 删除 legacy spec；新增 4 个 spec |
| `src/lib/providers/adapters/qwen.ts` | body/parser 分派 | 删除 legacy builder；新增 Wan sync builder |
| `src/lib/providers/adapters/qwen.unit.test.ts` | 请求/响应/错误测试 | 删除 legacy 测试；新增 4 个 sync 模型覆盖 |
| `src/lib/providers/registry.unit.test.ts` | 模型目录断言 | 删除 plus 断言，增加新模型和旧模型不存在断言 |
| `tests/integration/sync-generation.integration.test.ts` | sync lifecycle | 增加 Wan standard sync case |
| 当前 providers/API 文档 | 支持矩阵与示例 | 删除当前文档中的 plus 支持描述 |
| `model-interface-docs/qwen/` | 官方资料快照 | 新增 Qwen 3/最新快照/Wan standard 文档 |

## 2.5 API、协议与兼容

- 不变更 `ProviderCapabilities`、`ImageProvider`、`NormalizedRequest`、数据库 schema、snapshot version 和公开 `/api/providers` DTO。
- `qwen-image-3.0-pro`、`qwen-image-3.0`、`qwen-image-2.0-pro-2026-06-22` 使用 `/api/v1/services/aigc/multimodal-generation/generation`，返回 `output.choices[].message.content[].image`。
- `wan2.7-image` 使用同一同步 endpoint，显式保持 `enable_sequential=false`、`thinking_mode=true`，不发送 Qwen 专属 `negative_prompt`。
- `wan2.7-image-pro` 继续使用 `/api/v1/services/aigc/image-generation/generation` + `X-DashScope-Async: enable`，不在本批重构。
- `qwen-image-plus` 新请求被 adapter 前置拒绝；旧历史 job 不被迁移或伪造为新模型。

## 2.6 风险与回滚

- 新模型可逐个删除 spec 回滚，不需要数据库迁移。
- 若 Qwen 3.0 在当前账号仍为邀测或返回 model-not-found，不把真实失败伪装成成功；保留代码和单测，live 验收记录失败原因。
- 若 Wan 标准 sync 返回字段与 Qwen choices 不同，新增专用 parser 分支，不放宽通用 parser。
- Qwen URL 仍有约 24 小时有效期；WebUI 验收必须验证图片已落盘并可从历史重新读取。
- 删除 legacy 是有意兼容性变更；不恢复旧协议作为隐式 fallback。

## 2.7 与 00 边界对齐

- 00 要求删除 plus/legacy：Phase 1 删除 spec/builder/tests，Phase 3 更新当前文档。
- 00 要求纯文生图：四个新增 capabilities 只声明 `text-to-image`，不改生成页参考图输入。
- 00 要求保留旧的新协议模型：Qwen 2.0 Pro 与 Wan Pro 保留并在 Phase 2 回归。

## 2.8 不在本批

图生图、图片编辑、参考图上传、多图融合、组图、4K 默认输出、动态模型目录、价格/限流 UI、区域自动配置、SDK 替换和数据库迁移。
