# 1. 问题基线与当前实施状态

> 基线：2026-07-20、`d508fcc` 之后的工作树；本文只描述现状，不把目标实现写成既成事实。

## 1.1 问题陈述

1. 远端图片安全预检把真实透明代理的 fake-IP 与恶意/内网地址等同处理，fal 已生成的有效 JPEG 因而不能入库。
2. 四个同步图片生成 adapter 都继承 30 秒 POST timeout；真实 ZenMux 成功曾耗时 26.6 秒，另有三次失败约为 30.0 秒，容错窗口明显过窄。
3. 当前安全 Job DTO 故意不保存原始 URL/网络异常，正确地保护了敏感信息，却使本机 operator 无法从用户提示区分“代理映射被拒”与普通落盘失败。

## 1.2 运行数据流

```text
Provider API / queue
  → adapter 返回 URL 或 data URL
  → lifecycle.persistProviderImages / storeNextImage
  → storage.downloadAndStore
  → image-url-policy: HTTPS + DNS/IP + redirect 预检
  → 临时文件、magic-byte 校验、SQLite image checkpoint
```

fal 的异步任务已通过 `queue.fal.run` poll 返回 image URL；本机 DNS 将其中的 `v3b.fal.media` 解析为 `198.18.0.125`。`isForbiddenIpv4()` 在 [src/lib/storage/image-url-policy.ts](../../../../../src/lib/storage/image-url-policy.ts) 将 `198.18/15` 认定为非公网，`validateRemoteImageUrl()` 随即拒绝。该 URL 的 HTTP 响应实际为 `200 image/jpeg`、JPEG magic bytes 正确，故问题不在 Provider 生成、文件格式或本地目录权限。

## 1.3 storage / 网络边界现状

### goals-duty

storage 负责从临时 Provider URL 写入稳定本地资产，不负责调用 Provider API；见 `docs/mvp/storage/goals-duty.md`。其输入必须仍按不可信网络输入处理。

### architecture 与数据流

- [src/lib/storage/image-url-policy.ts](../../../../../src/lib/storage/image-url-policy.ts) 要求 HTTPS、拒绝 URL credential/loopback，并对 DNS 全部答案执行地址分类。
- [src/lib/storage/index.ts](../../../../../src/lib/storage/index.ts) 在初始 URL 与每一次手动 redirect 重新调用 policy，最多 3 次 redirect、全程 60 秒、最大 25 MiB、MIME 与 magic bytes 一致才 rename。
- `ALLOW_PRIVATE_IMAGE_URLS` 是全局开关；一旦启用会跳过所有 private/reserved address 判断，无法满足本批最小授权原则。

### non-functional 风险

安全策略本身正确地防止 Provider 返回内网 URL 造成 SSRF，但不能表达“已被 operator 明确允许的透明代理地址映射”。若简单放宽到任意 private address，会把 Provider 控制的 hostname 与内网访问能力错误耦合。

### test 缺口

[src/lib/storage/image-url-policy.unit.test.ts](../../../../../src/lib/storage/image-url-policy.unit.test.ts) 覆盖一般公网/私网与测试 fake provider，但没有“精确 host + 198.18/15 + 其他地址仍拒绝”的矩阵；`storage/index` 也没有覆盖 redirect 后失去例外资格。

## 1.4 Provider timeout 现状

| 类型 | Provider | 当前调用 | 当前上限 | 风险 |
|---|---|---|---:|---|
| 同步图片生成 | ZenMux、SiliconFlow、智谱 | `postJson` / inline variant | 30 秒 | 已生成/计费但本地未收到完整响应，进入 `outcome_unknown` |
| 同步图片生成 | 豆包 | inline `postJson` | 30 秒 | 同上 |
| 异步 submit | fal、Qwen、Kling | `postJson` | 30 秒 | 只需取得任务句柄，不应长占执行 slot |
| async poll | fal、Qwen、Kling | `getJson` | 15 秒 | 读取状态而非生成执行 |
| 图片下载 | storage | native `fetch` | 60 秒 | 独立的下载/retry 预算 |

代码锚点：默认 POST 在 [src/lib/providers/http-client.ts](../../../../../src/lib/providers/http-client.ts)；四个 sync adapter 在 `adapters/{zenmux,siliconflow,zhipu,doubao}.ts`；Provider capability 的 `protocol` 字段见 [src/lib/providers/types.ts](../../../../../src/lib/providers/types.ts)。Worker dispatch lease 为五分钟（`POLL_LEASE_MS`），本地 Provider limiter 排队为 30 秒，见 `src/lib/job-engine/lifecycle.ts` 与 `src/lib/providers/limiter.ts`。

## 1.5 use-case 与恢复语义

当前 `dispatchQueuedJob()` 对已经开始的、无法确认结果的 submit 保守写入 `PROVIDER_OUTCOME_UNKNOWN`，不重复收费请求。这与 improve-1 的副作用安全目标一致，不能为了三分钟 timeout 而改成重试。增加等待窗口只能降低误判频率，不能承诺 exactly-once。

## 1.6 跨模块一致性与文档差距

| 文档/实现 | 当前事实 | gap |
|---|---|---|
| `docs/mvp/storage/architecture.md` | 只接受公网 HTTPS | 未描述透明代理兼容的最小例外 |
| `docs/mvp/providers/*` | 统一 HTTP helper | 未区分 sync execution timeout 与 async submit timeout |
| `docs/mvp/job-engine/architecture.md` | dispatch lease 5 分钟 | 未说明 sync execution 上限与 queue/lease 的预算关系 |
| UI i18n | `STORAGE_ERROR` 显示通用安全存储失败 | operator 缺少安全、可行动的分类诊断 |

## 1.7 SWE 原则审视摘要

- **正确性优先于表面可用性**：不以全局 private-address 放行掩盖代理问题；这是最小权限和信息隐藏的应用。
- **SRP/内聚**：地址允许判定留在 storage policy；Provider adapter 只声明同步请求的 timeout，不让每个 adapter 自行发明网络安全规则。
- **KISS/YAGNI**：不用 SDK 迁移、全局代理检测、CIDR DSL 或新的网络服务。仅增加当前证据需要的精确 hostname 与固定映射段。
- **可验证性**：DNS resolver 既有依赖注入点足以覆盖绝大多数安全矩阵；真实 Provider 只作为最后受控验证。

## 1.8 改动影响面

`src/lib/storage/image-url-policy.ts`、storage/lifecycle tests、`src/lib/providers/http-client.ts` 或专属 timeout policy、四个 sync adapter 与测试、`.env.example`、README、storage/providers/job-engine 文档和 improve-2 测试契约均会修改；数据库 schema、公开 Generation API 与浏览器组件不应改变。
