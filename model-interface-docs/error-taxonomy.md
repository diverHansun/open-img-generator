# 图像 Provider 错误分类与安全诊断规范

> 状态：第一版运行时代码契约已实施；映射仅覆盖下文明确列出的官方信号。
> 最后核对：2026-07-20。
> 范围：`fal`、`zenmux`、`siliconflow`、`zhipu`、`doubao`、`qwen` 的图像生成调用。
> 目标：把上游的 HTTP / 业务错误映射为可行动、可测试、且不泄漏 prompt、参考图 URL 或签名结果 URL 的产品诊断。

## 1. 为什么需要这一层

Provider 的错误语义并不等价：

- ZenMux 用 HTTP 402 表示余额/订阅额度，并以 `error.type` 区分上游不可处理、模型不可用等原因；
- fal 在 422 的 `detail[].type` 中明确区分内容策略、字段校验和“未生成媒体”，并通过响应头表达是否可重试；
- 智谱与 Qwen 需要同时看 HTTP 状态和正文业务码，`429` 在不同业务码下可能是限流、余额或服务过载；
- Doubao 图像接口也返回业务错误字段，但公开文档的细粒度错误表需要按其版本和模型再次核实。

现有实现只在 [http-client.ts](../src/lib/providers/http-client.ts) 按 HTTP 状态映射为七类 `ProviderErrorCode`。这保证了最小实现的一致性，但会丢失上述差异：例如 ZenMux 的 402、模型不可用的 404、以及 Qwen / 智谱正文中可明确归类的内容拦截或余额错误。

本规范要求引入一个**安全诊断层**，而不是将 Provider 原始 `message` 直接展示或持久化。

## 2. 安全边界

### 2.1 可以保留、可用于产品提示的字段

| 字段 | 用途 | 约束 |
|---|---|---|
| `provider`、`model`、调用阶段 | 定位责任边界 | 非敏感 |
| HTTP 状态、上游机器码/类型 | 分类与重试策略 | 只保留 allowlist 中的码 |
| `providerRequestId` | 供应商工单/排查关联 | 限长、字符白名单；仅在失败任务的诊断编号处展示 |
| `retryable`、`Retry-After` | 调度与 UI 状态 | 延续现有有界退避 |
| 已解析的安全类别 | 用户提示与根因分析 | 枚举值，不取自上游自由文本 |
| 无内容的请求摘要 | 复现/对比 | 模型、数量、最终尺寸、选项键名、参考图数量、prompt 字符数 |
| 错误指纹 | 判断“同类错误是否反复出现” | 使用服务端密钥 HMAC；不使用裸 hash |

### 2.2 禁止持久化或默认显示的字段

- Provider 原始 `message`、整个错误 body、原始请求 body；
- fal `detail[].input`、`detail[].ctx`（可能含 prompt、文件、尺寸或 URL）；
- 签名图像 URL、参考图 URL、Base64 图片、改写后的 prompt；
- 可被用户输入直接控制的上游文案。

这一区分是必要的：fal 官方错误对象的 `input` 字段会直接回显输入；Qwen、智谱和 Doubao 的 `message` 也可能含参数值或资源 URL。产品应向用户说明“发生了哪一类问题、下一步如何处理”，而不是回显未受信任的第三方内容。

## 3. 建议的统一安全类别

下表是下一阶段实现的目标分类，`UPSTREAM_REJECTED` 刻意保留，避免在没有证据时把 422 错误误称为内容违规。

| 安全类别 | 用户可理解的含义 | 默认动作 |
|---|---|---|
| `AUTHENTICATION` | Provider 凭据不可用 | 停止重试；提示管理员检查密钥 |
| `BILLING_OR_ACCESS` | 余额、订阅、模型权限或实名/购买状态不足 | 停止重试；提示检查账户/模型权限 |
| `MODEL_OR_ENDPOINT` | 模型、API 路径或当前调用方式不支持 | 停止重试；提示切换模型或修正配置 |
| `INPUT_INVALID` | 参数、尺寸、数量、格式或资源约束不符合要求 | 停止重试；提示修改设置 |
| `CONTENT_POLICY` | 输入/输出被 Provider 的内容安全策略拦截 | 停止重试；提示修改内容，不回显触发规则 |
| `REMOTE_ASSET_UNAVAILABLE` | Provider 无法下载或读取参考资源 | 默认不自动重放提交；提示检查资源可访问性 |
| `RATE_LIMITED` | 用户/账户/平台请求频率或配额限流 | 按 Provider 指示退避；提示稍后自动重试 |
| `PROVIDER_OVERLOADED` | Provider 服务繁忙或临时过载 | 有界退避；显示处理中/稍后重试 |
| `REQUEST_TIMEOUT` | 本地或 Provider 明确超时 | 对已知未提交请求可重试；结果未知时不得盲目重放 |
| `NO_RESULT` | Provider 完成但未返回可存储图片 | 停止重试或按 Provider 文档决定；提示改写输入 |
| `STORAGE_FAILURE` | 已生成结果无法安全下载或落盘 | 重试存储阶段；不重新提交生成 |
| `UPSTREAM_REJECTED` | Provider 已收请求，但未提供足够安全的细分原因 | 停止重试；显示 Provider、模型、支持编号 |
| `UNKNOWN` | 不能安全或可靠地归类 | 保留支持编号，人工排查 |

## 4. Provider 官方错误对照

### 4.1 ZenMux（OpenAI Images API）

官方错误参考明确建议以 `error.type` 做程序判断、以 `message` 做展示，并建议保存 `X-ZenMux-RequestId` 以便支持排查。这里的“展示”不适用于本产品直接回显：我们的用户输入可能被嵌入消息，应先转换为上表的安全类别。

| 官方信号 | 安全类别 | 重试 | 用户提示重点 |
|---|---|---|---|
| HTTP 400 / `invalid_params` | `INPUT_INVALID` | 否 | 检查模型、数量、尺寸和可选参数 |
| HTTP 413 / `invalid_params` | `INPUT_INVALID` | 否 | 提示词或请求体超过限制 |
| HTTP 402 / `insufficient_credit`、`reject_no_credit`、`quote_exceeded` | `BILLING_OR_ACCESS` | 否 | 检查余额、订阅额度和 Key 类型 |
| HTTP 404 / `invalid_model`、`model_not_available`、`model_not_supported` | `MODEL_OR_ENDPOINT` | 否 | 检查模型名、套餐与 API 兼容性 |
| HTTP 422 / `provider_unprocessable_entity_error` | `UPSTREAM_REJECTED` | 否 | 先提示移除高级参数或换模型；**不可臆断为内容违规** |
| HTTP 429 / `rate_limit` | `RATE_LIMITED` | 是 | 按退避策略重试 |
| HTTP 500、502、503、504 | `PROVIDER_OVERLOADED` | 是 | 有界退避；保留 `X-ZenMux-RequestId` |

本次 ZenMux 历史故障正属于这一行：当前只有 `INVALID_REQUEST`，没有历史 `error.type` 或请求 ID，因此可确认“被 HTTP 400/422 拒绝”，不能事后断言为审核或某一个参数。

官方来源：

- [ZenMux API Error Codes Reference](https://zenmux.ai/docs/guide/advanced/error-codes.html)
- [ZenMux Create Image](https://zenmux.ai/docs/api/openai/generate-an-image)

### 4.2 fal（Queue API）

fal 是目前公开错误语义最完整的 Provider。请求失败可包含 `detail[]`；每个对象的 `type` 才是稳定机器码，`msg` 仅适合作为人类可读信息，`input` 不得保存。fal 还提供 `X-Fal-Retryable` 和 `X-Fal-Error-Type`，应优先于泛化 HTTP 重试判断。

| 官方信号 | 安全类别 | 重试 | 备注 |
|---|---|---|---|
| 422 / `content_policy_violation` | `CONTENT_POLICY` | 否 | 可安全提示“内容无法由该服务处理” |
| 422 / `image_too_small`、`one_of`、`feature_not_supported` 等校验类 | `INPUT_INVALID` | 否 | 可由类型映射到尺寸、枚举或功能不支持 |
| 422 / `no_media_generated` | `NO_RESULT` | 否 | 不是下载/存储失败 |
| 500 / `internal_server_error` | `PROVIDER_OVERLOADED` 或 `UNKNOWN` | 看 `X-Fal-Retryable` | 不能仅凭 500 假定一定可重试 |
| 504 / `generation_timeout` | `REQUEST_TIMEOUT` | 看 `X-Fal-Retryable` | 与本地 HTTP 超时区分 |
| Queue `COMPLETED` 且含 `error_type` | 按 `error_type` 映射 | 按官方队列语义 | 队列会对部分 503、504、连接错误自行重试 |

官方来源：

- [fal Model Errors](https://fal.ai/docs/documentation/model-apis/errors)
- [fal Asynchronous Inference](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [fal Platform Headers](https://fal.ai/docs/documentation/model-apis/common-parameters)

### 4.3 SiliconFlow

SiliconFlow 官方目前将 HTTP 状态作为首层分类，并要求结合正文 `message` 定位细节；公开材料未给出一套适用于全部图像模型的稳定内容审核业务码。因此实现应安全地保存 allowlist 中的数值 `code`（若有），但在未有明确映射前不可由自由文本推断内容违规。

| 官方 HTTP 信号 | 安全类别 | 重试 |
|---|---|---|
| 400 | `INPUT_INVALID` | 否 |
| 401 | `AUTHENTICATION` | 否 |
| 403 | `BILLING_OR_ACCESS` | 否 |
| 429 | `RATE_LIMITED` | 是 |
| 503 / 504 | `PROVIDER_OVERLOADED` | 是 |
| 500 | `UNKNOWN` 或 `PROVIDER_OVERLOADED` | 有界重试 |

官方来源：[SiliconFlow Error Handling](https://docs.siliconflow.cn/en/faqs/error-code)。

### 4.4 智谱（Zhipu / BigModel）

智谱明确要求同时解析 HTTP 状态与正文业务码。只看 HTTP 429 会误把余额、用户限流、平台过载混为一谈；`1301` 则是有明确定义的内容安全拦截。

| 官方业务码 | 安全类别 | 重试 | 说明 |
|---|---|---|---|
| 1000–1004 | `AUTHENTICATION` | 否 | 鉴权失败、缺失或过期 |
| 1113 | `BILLING_OR_ACCESS` | 否 | 账户欠费 |
| 1210、1213–1215 | `INPUT_INVALID` | 否 | 参数缺失、非法或互斥 |
| 1211、1212、1220–1222 | `MODEL_OR_ENDPOINT` | 否 | 模型、方法、权限或接口不可用 |
| 1261 | `INPUT_INVALID` | 否 | Prompt 超长 |
| 1301 | `CONTENT_POLICY` | 否 | 官方明确为输入/输出安全拦截 |
| 1302、1303、1304、1308 | `RATE_LIMITED` | 是或等待额度刷新 | 具体等待时间可由 Provider 返回 |
| 1305、1312 | `PROVIDER_OVERLOADED` | 是 | 平台/模型访问量过大 |
| HTTP 500、业务码 500 | `PROVIDER_OVERLOADED` | 是 | 有界退避 |

官方来源：

- [智谱 API 错误码](https://docs.bigmodel.cn/cn/api/api-code)
- [智谱内容安全](https://docs.bigmodel.cn/cn/guide/platform/securityaudit)
- [智谱速率限制](https://docs.bigmodel.cn/cn/api/rate-limit)

### 4.5 豆包（Volcengine Ark）

图片生成响应的顶层 `error.code` / `error.message`，以及部分成功图片的 `data[].error.code` / `message` 都是正式协议字段。图像请求可能部分成功，不能把某张图片的错误误判为整个 generation 全部失败。

官方错误码页现可通过浏览器读取。运行时代码只采用其中的稳定 `Code` 字段；`Message` 中的 `Request ID` 不解析，避免从自由文本提取或保存数据。若响应有结构化 `request_id`，才经过字符白名单保留。

| 官方业务码 | 安全类别 | 重试 | 说明 |
|---|---|---|---|
| `MissingParameter`、`InvalidParameter` | `INPUT_INVALID` | 否 | 缺少或非法请求参数 |
| `InvalidEndpoint.ClosedEndpoint` | `PROVIDER_OVERLOADED` | 是 | 推理接入点关闭或暂时不可用 |
| `InvalidEndpoint.*` | `MODEL_OR_ENDPOINT` | 否 | 非法或不可用接入点 |
| `SensitiveContentDetected*`、`*SensitiveContentDetected*` | `CONTENT_POLICY` | 否 | 官方明确的输入/输出敏感内容或策略限制 |
| `AuthenticationFailed`、`InvalidApiKey` | `AUTHENTICATION` | 否 | 凭据不可用 |
| `Arrearage`、`InsufficientBalance`、`InsufficientQuota` | `BILLING_OR_ACCESS` | 否 | 账户余额或配额不足 |
| `RateLimitExceeded`、`TooManyRequests` | `RATE_LIMITED` | 是 | 速率限制 |

未知 Ark 业务码只按 HTTP 状态保守分类，不展示原始 `message`。单张 `data[].error` 的部分成功语义仍是后续结果模型改造项，不能把一张失败图覆盖为整任务失败。

官方来源：

- [Ark 图片生成 API](https://www.volcengine.com/docs/82379/1299023)
- [本仓库 Ark 图像协议摘录](./doubao/seedream-image-and-edit.md)

### 4.6 千问（DashScope / Model Studio）

Qwen 图像接口在提交或任务完成失败时返回 `request_id`、`code`、`message`。官方错误页已明确多个可安全映射的业务码；应保留码和 `request_id`，不保存自由文本。

| 官方信号 | 安全类别 | 重试 | 说明 |
|---|---|---|---|
| 400 / `InvalidParameter` | `INPUT_INVALID` | 否 | 请求体、模型参数或规格错误 |
| 400 / `DataInspectionFailed`、`data_inspection_failed` | `CONTENT_POLICY` | 否 | 官方说明为输入/输出疑似不当内容 |
| 400 / `InvalidParameter.DataInspection` | `REMOTE_ASSET_UNAVAILABLE` | 否 | Provider 在检查阶段下载媒体超时；不是内容审核 |
| 400 / `Arrearage` | `BILLING_OR_ACCESS` | 否 | 账单逾期或账户不可用 |
| 401 / `InvalidApiKey`、`invalid_api_key` | `AUTHENTICATION` | 否 | Key 或 Key/地域端点配对错误 |
| 404 / `NotFound`、模型不支持当前协议 | `MODEL_OR_ENDPOINT` | 否 | 模型、工作区或路径错误 |
| 429 / `Throttling*` | `RATE_LIMITED` | 是 | 区分请求频率、突发与 TPS/TPM 配额 |
| 429 / `CommodityNotPurchased`、`*BillOverdue` | `BILLING_OR_ACCESS` | 否 | 不能按普通限流自动重试 |

官方来源：

- [Model Studio Error Codes](https://help.aliyun.com/en/model-studio/error-code)
- [Qwen Image API](https://help.aliyun.com/en/model-studio/qwen-image-api)

## 5. 与当前实现的差距

| 位置 | 当前行为 | 影响 |
|---|---|---|
| `mapHttpStatusToErrorCode()` | 统一 400/401/402/403/404/422/429/5xx 的稳定调度码 | 新的诊断类别补足 Provider 差异，稳定码不承担细粒度用户文案 |
| `ProviderHttpError` | 短暂持有受信响应头并提供只读读取方法 | Adapter 只提取文档定义的请求 ID；不会持久化任意 header |
| 各 adapter `mapError()` | 解析官方 code/type 并分类 | 原始 message 仍仅在内存中用于 Adapter 调试，生命周期不持久化它 |
| Qwen `poll()` | 对已知机器码按类别映射 | 未知终态失败保留为 `UPSTREAM_REJECTED` |
| `serializeSafeJobError()` | 保存分类、已识别机器码与安全请求编号 | 写入和读出各做一次 provider-id 绑定的白名单验证 |
| 终态生命周期 | 清除 `requestSnapshot` | 无法在历史任务中对比最终尺寸、参数键与模型配置 |

## 6. 已实施原则与后续工作

1. **在 HTTP 层提取而非保存 body。** 已将少量受信响应头、`error.code`、`error.type`、fal `detail[].type` 解析为受控枚举；`message` 不会传入持久化模型。
2. **保存最小诊断摘要。** 当前终态任务保留安全类别、已识别机器码和 Provider 请求 ID；继续清除 prompt、参考图 URL 和 Provider 原始 body。错误指纹和无内容请求摘要是后续增强，不在本次范围内。
3. **分类优先于文案。** 前端只根据安全类别和 retry 状态选择本地化文案；绝不直接渲染上游 `message`。
4. **重试由“副作用事实 + 类别”共同决定。** 4xx 明确拒绝默认不重放；429/5xx 仅在文档与响应标记允许时有界退避；结果未知仍保持“不盲目重放”。
5. **将支持编号分层展示。** 普通用户看到行动建议；“复制诊断编号”可在高级排障区提供，管理员/日志可关联 Provider request ID。
6. **所有 Provider 均有保守兜底。** ZenMux、fal、Zhipu、Qwen、Doubao 使用上表已核对的码表；SiliconFlow 只按其官方 HTTP 语义分类，不从自由文本猜测原因。

## 7. 验收问题

后续错误提示和根因分析实现必须能回答以下问题：

1. 能否区分 ZenMux 402 余额、404 模型不可用、422 上游拒绝，并保存 `X-ZenMux-RequestId`？
2. 能否区分 fal 的 `content_policy_violation`、输入校验和 `no_media_generated`，且不保存 `input`？
3. 能否区分 Zhipu 1301 内容策略、1302 限流、1305 过载和 1113 欠费？
4. 能否区分 Qwen 的 `DataInspectionFailed` 与 `InvalidParameter.DataInspection`，避免把参考图下载失败误说成内容违规？
5. 对未知错误，是否只显示安全通用提示与诊断编号，而未泄漏 prompt、URL、Base64 或 Provider 原文？
6. 同一输入连续失败时，是否能依据安全请求摘要和错误 HMAC 判断“同类重复”，但不能反推出输入内容？
