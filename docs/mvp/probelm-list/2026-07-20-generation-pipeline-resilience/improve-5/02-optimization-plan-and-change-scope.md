# 2. 优化方案与改动面

## 2.1 方案总览

将“生成”和“保存”分成两个明确的 durable checkpoint。Provider 结果一旦持久化，后续任何 retry-storage 都只消费该快照：

```text
Provider submit/poll
        │
        ▼
durable resultSnapshot + phase=storing
        │
        ├─ save succeeds ────────────────→ terminal/completed
        │
        └─ recoverable save failure
                    │
                    ▼
          phase=storage_blocked
          status=running
          resultSnapshot retained
                    │
           user fixes network/disk
                    │
           POST retry-storage (CAS)
                    │
                    ▼
               phase=storing ───────────→ only download/validate/store
```

Provider ModelSpec 同时声明精确的 known media hosts；环境变量只负责用户/部署追加。两者合并后仍由现有 URL policy 执行 DNS、HTTPS、重定向和地址校验。

## 2.2 Phase 1：修正 Doubao ModelSpec

### 改动

- `src/lib/providers/capabilities/doubao.ts`
  - `Seedream 5.0 Lite` 改为 `doubao-seedream-5-0-lite-260128`。
  - 不把 `doubao-seedream-5-0-260128` 保留为同名 alias。
- Doubao adapter/capability tests、provider catalog/API contract snapshots 同步更新。
- 增加一次安全的旧偏好处理：删除 `(doubao, doubao-seedream-5-0-260128)` 的 preference，或在受控迁移 helper 中映射到 Lite；首选删除旧偏好并使用新模型默认启用，避免替用户迁移可能代表非 Lite 的选择。
- 历史 Generation/Job 的 model 字段不改。

### 验证

- capability、模型页、生成 payload 三处均为 `doubao-seedream-5-0-lite-260128`。
- 使用真实 key 探测时，若仍返回 `model_or_endpoint`，保留上游 request id/code 并提示检查账号开通/Endpoint，而不是再归因于保存网络。

## 2.3 Phase 2：Provider 私有媒体主机声明

### 契约

在私有 ModelSpec 或 Provider adapter 内增加不可由客户端提交的字段：

```ts
type PrivateModelSpec = {
  // existing request/capability fields
  trustedProxyMediaHosts?: readonly string[];
};
```

约束：

- 只允许规范化后的精确 hostname，不允许 scheme、path、port、IP、wildcard。
- 只用于 `proxy_mapping_not_trusted` 的 `198.18.0.0/15` 特例，不跳过其他 URL 安全检查。
- 适配时根据 Provider 官方行为和真实响应确认，不自动学习。
- Qwen 初始加入 `dashscope-7c2c.oss-accelerate.aliyuncs.com`；现有 Fal/Zhipu 已知主机迁入各自私有 spec。
- `TRUSTED_PROXY_IMAGE_HOSTS` 保留为用户附加项，并在 `.env.example`/网络文档中解释用途。

### 数据流

```text
Provider/Model known hosts ─┐
                             ├─ normalized exact-host Set ─→ validateRemoteImageUrl
User env extra hosts ────────┘
```

如果同一 Provider 后续返回新域名，先以安全诊断暴露精确 hostname，再在确认归属后更新 ModelSpec 或让用户临时追加；不得自动放行父域。

## 2.4 Phase 3：`storage_blocked` 状态机

### 状态与转换

新增内部 phase，不新增公共 status：

```text
storing → storage_blocked
storage_blocked → storing | terminal
```

- 进入 blocked：`status='running'`，`phase='storage_blocked'`，`resultSnapshot` 保留，`requestSnapshot` 清空，lease/nextPollAt 清空，保存安全错误。
- 手动重试：原子 CAS `storage_blocked → storing`，清空旧 error、重置 download retry budget、`nextPollAt=now`。
- 成功：沿现有 `storing → terminal/completed`。
- 再失败：回到 `storage_blocked`，不清空 snapshot。
- blocked job 不进入 `listDueGenerationJobs()`，只有显式 retry 才恢复调度。
- `isTerminalPhase()` 不包含 blocked；Generation 聚合仍为 running。

### 哪些错误进入 blocked

| Storage diagnostic | 处理 | 理由 |
|---|---|---|
| `proxy_mapping_not_trusted` | blocked | 修改精确主机或 DNS 后可恢复 |
| `remote_dns_failed` | 先自动重试，耗尽后 blocked | DNS 可由用户/网络修复 |
| `remote_download_timeout` | 先自动重试，耗尽后 blocked | URL 仍可能有效 |
| `remote_download_failed` | 先自动重试，耗尽后 blocked | 上游瞬态/网络可恢复 |
| `remote_http_rejected` | blocked | 签名/鉴权可能临时；保留诊断与结果 |
| `remote_address_blocked` | blocked 但绝不自动放行 | 需确认 URL/网络安全，保留证据 |
| `local_write_failed` | blocked | 磁盘空间、权限、ownership 可修复 |
| `remote_url_invalid` | terminal failed | 同一无效 URL 重试无价值 |
| `remote_content_invalid` | terminal failed | 同一非法内容不可通过重试变安全 |
| result snapshot parse invalid | terminal failed | durable checkpoint 已损坏，不能安全继续 |

数据库写入提交失败时，如果文件已回滚/删除且 snapshot 仍有效，进入 blocked；只有快照自身无效才 terminal。

### 部分落盘

Image 表的 `(jobId, index)` 去重与 `imageExists()` 继续作为 checkpoint。重试时从 snapshot 中寻找第一个尚未落盘的 index；已有图片保持不变。最后一张提交成功后才清理整个 snapshot/staging。

## 2.5 Phase 4：retry-storage API 与 UI

### API

新增：

```text
POST /api/generations/:generationId/jobs/:jobId/retry-storage
```

返回当前 JobView。服务层要求：

1. job 属于 generation；
2. status=running、phase=storage_blocked；
3. resultSnapshot 非空且可解析；
4. cancellation 未请求；
5. 使用单条条件 UPDATE/CAS，重复点击返回当前状态或安全 409；
6. 只调度 `storing`，代码路径不持有/不调用 Provider submit 方法。

授权沿用当前本机应用会话和 generation API 边界；请求记录 requestId，但不记录远程 URL。

### JobView

增加：

```ts
waitingForStorage?: boolean;
canRetryStorage?: boolean;
```

blocked job 的 error 继续包含安全 code/message/storageDiagnostic/hostname。前端不得仅依据 public status 判断所有任务“仍自动进行”；`waitingForStorage` 时停止自动轮询或降频，等待用户操作。

### UI

- 生成页和 Generation detail 同时展示：`生成已完成，但图片尚未保存`。
- 显示既有安全诊断及“重试保存”按钮；按钮旁明确“不会重新生成或重复计费”。
- 点击时锁定按钮，成功进入 storing 后恢复轮询；重复点击不创建第二执行者。
- `remote_url_invalid`/`remote_content_invalid` 等 terminal 错误不展示重试保存。
- 多 job Generation 只对 blocked job 显示按钮，不重跑已完成或 Provider 失败的 job。

## 2.6 取消、删除、重启与保留

- blocked job 取消：本地直接 `terminal/cancelled`，清理 snapshot/staged refs；不进入 Provider cancelling，因为上游生成已经完成。
- Generation 取消：同样按 phase 分支处理 blocked jobs；其他 polling/dispatching job 保持现有远程取消语义。
- Generation 删除：继续收集并清理所有 result snapshots，blocked 记录不例外。
- 服务重启：blocked 数据留在 SQLite，详情页可见；worker 不自动重试。
- 本批不为 snapshot 增加独立 TTL。它随显式重试、取消、Generation 删除清理；后续再设计与 7 天保留规则一致的到期终态和通知，不能静默删除。

## 2.7 可观测性

在现有安全日志增加固定事件：

| event | 字段 |
|---|---|
| `storage.blocked` | jobId、generationId、provider、model、safe code/category/hostname |
| `storage.retry_requested` | jobId、generationId、requestId |
| `storage.retry_started` | jobId、attempt |
| `storage.retry_completed` | jobId、storedCount、outcome |
| `storage.retry_refused` | jobId、safe reason |

禁止记录 Prompt、API key、完整 Provider response、签名 URL、Base64 或绝对 storage path。

## 2.8 改动面

| 层 | 预计修改 |
|---|---|
| Provider | Doubao ModelSpec；私有 trusted media hosts；capability tests |
| Storage | URL policy 接收 provider/model known hosts；诊断与 tests |
| Job engine | state-machine、due query、store failure classifier、cancel、view mapper、tests |
| DB query | blocked transition、retry CAS、旧 preference cleanup；无 schema migration |
| API | retry-storage route、error mapping、contract tests |
| Web client | JobView 字段、API client、polling semantics |
| UI/i18n | generate/detail blocked state、按钮、错误说明 |
| Observability | bounded safe events |
| Docs/config | `.env.example`、Provider/network/job lifecycle 文档 |

`generation_jobs.phase` 当前为 text 且没有 DB CHECK，`result_snapshot` 已存在，因此预期不需要 schema v6。若实施发现数据库层存在未记录的枚举约束，必须先停下重新评审迁移。

## 2.9 实施批次与提交建议

1. `fix(providers): align Seedream Lite model identifier`
2. `fix(storage): trust provider-owned fake-ip media hosts`
3. `feat(jobs): pause recoverable storage failures`
4. `feat(generations): retry storage without regeneration`
5. `docs(network): explain router fake-ip and storage retry`

每批保持定向测试通过；状态机与 API/UI 可以分提交，但在最终合并前必须整体可用，不能留下 blocked 无操作入口。

## 2.10 回滚

- 模型标识批次可独立回滚；历史记录不受影响。
- trusted host 批次可移除 Provider 内建项并退回 env-only；不可回滚为全网段放行。
- lifecycle/API/UI 必须成组回滚。回滚前若已有 blocked rows，先提供只读检查/迁移，将其安全终止或在旧代码不可见时保留，不能直接部署不认识新 phase 的 worker。
- 所有回滚均不得把 retry-storage 改为 submit generation。
