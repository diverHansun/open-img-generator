# 2. 优化方案与改动面

## 2.1 方案总览

在 Improve 1 的 Provider 私有 ModelSpec 上，分别增加 Fal 和 Qwen 的强类型 profile。adapter 按 profile 选择请求构造/端点与响应解析，但继续实现同一个 `ImageProvider`。

## 2.2 Profile 设计

### Fal

```ts
type FalImageProfile =
  | { kind: 'flux-image-size'; ratioMap: Record<string, string> }
  | { kind: 'banana-aspect-ratio'; resolutions: readonly string[] };
```

Nano Banana 请求只发送官方支持的 `prompt/num_images/aspect_ratio/resolution/output_format` 与经 allowlist 的安全选项；不得发送 FLUX `image_size`。

### Qwen

```ts
type QwenImageProfile =
  | { kind: 'legacy-text2image-async'; path: string }
  | { kind: 'multimodal-sync'; path: string }
  | { kind: 'multimodal-async'; path: string };
```

`qwen-image-2.0-pro` 使用同步 profile；`wan2.7-image-pro` 优先异步 profile。两者均只构造文本 content，显式关闭 sequential/interleave/stream。

## 2.3 Phase 1：Fal 两模型

改动：

- `src/lib/providers/capabilities/fal.ts`（或 Improve 1 确立的 Fal spec 文件）：增加两个 spec 与 banana profile。
- `src/lib/providers/adapters/fal.ts`：把 body builder 按 profile 分派；Queue handle、poll、cancel、parseImages 继续共用。
- `src/lib/providers/adapters/fal.unit.test.ts`：字段互斥、比例、分辨率、数量、错误和结果测试。

能力边界：text-to-image；count 以当日官方上限与产品 fanout 约束较小者为准；默认 1K，避免首次 live test 产生不必要成本。

DoD：两个模型均经真实 3000 流程完成 count=1 生成、URL 转存、本地读取；FLUX Schnell 回归成功。

## 2.4 Phase 2：Qwen Image 2.0 Pro

改动：

- Qwen spec 增加 `qwen-image-2.0-pro` 和 `multimodal-sync`。
- 新建/抽取纯函数构造 `messages/content/text` 与解析同步 `output.choices[].message.content[]` 或当日官方实际响应；响应解析必须有大小界限并统一为 `ProviderImageRef`。
- 使用共享 180 秒同步预算；timeout 保持 `unknown`，job-engine 不自动重投。
- 尺寸/比例只发布真实 live 成功的集合；count 首批保守为 1，即使官方允许 1–6。

DoD：单测/集成覆盖同步成功、无图、内容审核、429、timeout；真实 count=1 生成并落盘。

## 2.5 Phase 3：Wan 2.7 Image Pro

- 增加 `wan2.7-image-pro` 与 `multimodal-async`。
- 使用当前地区的官方 async path，保存 bounded task ID；poll URL 必须由受信 base + externalId 重建。
- 请求仅含文本、`n=1`、非 sequential、非 stream；默认 1K/2K 的最终选择以当前官方地区和 live test 为准，首测用最低稳定成本。
- 解析任务成功结果并立即下载 24 小时临时 URL。

DoD：真实任务经历 durable pending/running/completed；服务轮询期间不阻塞一个三分钟 HTTP 请求；文件重载可读。

## 2.6 改动面

| 区域 | 修改 |
| --- | --- |
| `src/lib/providers/capabilities/fal.ts` | Fal model specs/profiles |
| `src/lib/providers/adapters/fal.ts` | profile body builder |
| `src/lib/providers/capabilities/qwen.ts` | Qwen model specs/profiles |
| `src/lib/providers/adapters/qwen.ts` | legacy/sync/async 分派与解析 |
| adapter unit tests | profile 请求/响应矩阵 |
| `tests/integration/` | 同 Provider 多 protocol lifecycle + storage |
| providers/model docs | 能力、数据流、测试和官方快照 |

公开 API、DB schema、job snapshot version 不变。

## 2.7 风险与回滚

- 单模型可通过删除 spec 回滚，已有模型/历史记录不受影响。
- 若 Wan async 在当前地区不可用，不降级为未经测试的 sync 自动重投；停止准入并报告地区/协议诊断。
- 若 Qwen sync 响应超过 HTTP JSON 上限，不能简单放大通用上限；优先确认是否返回 URL、是否需要专用 bounded inline reader。
- Fal model page schema变化只修改 banana profile 与测试，不改 FLUX profile。
- 不在健康检查或目录读取时探测真实 Provider，避免启动产生费用或不稳定。

## 2.8 不在本批

图片编辑、多图融合、连续组图、4K 首测、联网搜索、thinking 高档、流式输出、动态区域切换和 Kling 均不在范围。
