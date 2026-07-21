# 2. 优化方案与改动面

## 2.1 方案总览

为每家 Provider 建立内部 `ModelSpec<Profile>` 映射。公开目录只获得 `spec.capabilities` 投影；adapter 在 `submit` 前按 model 查 spec，并依据强类型 profile 构造请求。ModelSpec 不从 `src/lib/providers/index.ts` 导出。

```text
provider-config/UI/job
        │ public ProviderCapabilities only
        ▼
Provider adapter ── model id ──> private ModelSpec/Profile
        │                              │
        └──────── request/parse strategy ──> safe HTTP client
```

## 2.2 设计决策

| 决策 | 选择 | 理由 | 放弃项与代价 |
| --- | --- | --- | --- |
| ModelSpec 可见性 | providers 内部、不从 public index 导出 | 厂商变化不污染跨模块契约 | 不能由 UI 直接解释 profile，这是有意边界 |
| 组织方式 | 每 Provider 一个 spec 文件/映射，profile 为 Provider 专属 union | 精准修改，避免全局枚举 | 文件数增加，但变化归属清晰 |
| capabilities | 从 ModelSpec 投影为现有数组 | catalog/UI 无破坏性变化 | 需要防止 capabilities 与 profile 重复维护 |
| 动态发现 | 不做 | 启动稳定、KISS | 新模型需发布代码 |
| SiliconFlow | 先 live probe，成功后入目录 | 官方目录动态变化 | 实施结果可能只交付一个或零个候选 |
| SDK | 继续原生安全 HTTP | 保留超时、大小、redirect、诊断语义 | 手写少量映射代码 |

## 2.3 Phase 1：无行为变化的 ModelSpec 迁移

目标：七家现有模型全部进入各自私有 ModelSpec，公开 API/行为不变。

预计改动：

- 新增 `src/lib/providers/model-spec.ts`：仅 providers 内部使用的最小泛型和投影 helper；不从 public index 导出。
- 调整 `src/lib/providers/capabilities/{fal,zenmux,siliconflow,zhipu,doubao,qwen,kling}.ts`，每家保留自身 profile 类型、spec 表及 capabilities 投影。
- 调整七个 adapter：提交前获取本 Provider spec；未知 model 返回 `INVALID_REQUEST/not_started`，不发网络请求。
- 更新 `src/lib/provider-config/catalog.ts` 的导入，但响应 DTO 不变。

DoD：七家现有模型的 unit/contract/integration 回归通过；生成的 `/api/providers` 与改造前语义等价；无 DB migration。

## 2.4 Phase 2：ZenMux 与 Doubao 模型

### ZenMux

- 增加 `openai/gpt-image-1.5`，profile=`openai-images`。
- 标准尺寸限定为 `1024x1024`、`1536x1024`、`1024x1536`；Base64 结果继续内联交给 storage。
- `quality/output_format` 仅通过 allowlist provider options 传递，禁止覆盖 model/prompt/n/size。

### Doubao

- 增加 `doubao-seedream-4-5-251128`。
- 增加 `doubao-seedream-5-0-260128`；实施时核对官方是否要求/接受 `doubao-seedream-5-0-lite-260128` 别名，目录只保留真实调用成功且官方推荐的一个 ID。
- profile 保存模型级支持尺寸、seed、输出格式与请求默认值，避免继续沿用 Seedream 4.0 假设。
- 本批强制 `sequential_image_generation=disabled`、count=1，不开启联网搜索或组图。

DoD：请求体与官方字段一致；每个模型至少一个 mocked success/error 测试；真实 count=1 最小分辨率生成成功并落盘。

## 2.5 Phase 3：SiliconFlow 探测与条件接入

1. 使用当前已配置密钥，分别以 count=1、官方推荐的最低稳定尺寸调用两个候选。
2. 探测必须走应用 adapter/HTTP/storage 链路，不能用独立 curl 成功替代产品链路验证。
3. `Tongyi-MAI/Z-Image-Turbo` 成功才增加 spec；`Tongyi-MAI/Z-Image` 同理，二者独立判定。
4. 若返回 model-not-found/not-available：保留安全 diagnostic 和文档结果，不加入 capabilities。
5. SiliconFlow profile 必须显式记录是否允许 `batch_size`；官方当前声明该字段只适用于 Kolors，Z-Image 请求不得盲目发送。

DoD：成功候选完整生成并立即转存；远程 URL 失效不影响本地读取；失败候选不会出现在模型页。

## 2.6 兼容、风险与回滚

- 无数据库 schema 变化；历史 model 字符串不改写。
- 已有模型 spec 不删除，避免未完成 job 在部署后失去解析器。
- 单模型新增可通过删除对应 spec 回滚；ModelSpec 基础设施若有问题可独立回滚到原 capabilities 数组。
- 真实 API 返回与文档不一致时，以安全失败为准，不放宽响应大小、redirect 或 URL 信任策略。
- 新模型沿用“用户选择才调用”语义；不得在启动、健康检查或模型列表读取时产生付费请求。

## 2.7 文档更新

- 更新 `docs/mvp/providers/{architecture,data-model,dfd-interface,test}.md`。
- 更新对应 `model-interface-docs/`：核验日期、模型 ID、profile、尺寸、URL 过期与错误码。
- 不创建自检报告文件。

## 2.8 不在本批

Fal/Qwen Improve 2 模型、图片编辑、多图融合、动态目录、模型价格展示、自动健康探测和 Kling 新模型均不在本批。
