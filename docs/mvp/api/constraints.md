# MVP API 运行时约束

> 适用范围: MVP 纯 API 阶段
> 关联文档: job-engine/dfd-interface.md, db/data-model.md, storage/dfd-interface.md

本文档闭合并行审查中发现的运行时语义缺口。编码时必须遵守。

---

## 1. 部署与安全前提

| 约束 | 说明 |
|------|------|
| **localhost-only（MVP 默认）** | 服务应绑定 `127.0.0.1` 或仅在受信网络内访问。MVP **无 auth、无 rate limit**。暴露公网将导致 API key 盗刷与磁盘被恶意填满。 |
| 启动诊断 | 若 `registry.listEnabled()` 返回空数组，启动时打印 `WARNING: no providers enabled`。`GET /api/health` 返回 `enabledProviders: []`。 |
| API key | 仅存于服务端环境变量，永不通过 API 响应返回。 |

---

## 2. 客户端 poll 契约（async / fal）

fal 等 async provider **不会**在 POST 后自动完成；推进完全依赖客户端轮询。

| 项 | 建议值 |
|----|--------|
| 首次 poll | POST 返回 `201 { status: "pending" }` 后立即或 2s 内发起第一次 GET |
| 轮询间隔 | 2s → 5s 退避（最多 5s 间隔） |
| 放弃条件 | 连续 poll 超过 10 分钟仍 pending/running → 客户端停止；服务端状态保留，用户可稍后 GET 继续推进 |
| 厂商 URL 过期 | fal CDN URL 有时效（通常数小时）。**必须在过期前完成 poll + 转存**。长时间不 poll 可能导致转存 404 → generation `failed` |
| POST 响应 | 含 `links.self`，指向 `GET /api/generations/:id` |

客户端伪代码:

```
POST /api/generations → { id, status, links }
if status == "pending":
  loop:
    GET links.self → view
    if view.status in ("completed", "failed", "cancelled"): break
    sleep(backoff)
```

---

## 3. Sync 路径阻塞与 count 限制

zenmux 等 sync provider 在 `POST /api/generations` 请求线程内完成: provider HTTP + 逐张 downloadAndStore。

| 约束 | 值 |
|------|-----|
| MVP sync count 上限 | **1**（validator 拒绝 sync provider 的 count > 1） |
| provider submit 超时 | 30s |
| 单张 storage 下载超时 | 60s |
| 部署建议 | MVP 定位为 **long-running 本地进程**（`next dev` / `next start`）。不建议部署到短超时 serverless（如 30s 硬限制）而不改架构 |

async provider（fal）不受 sync count=1 限制，仍受 capabilities.maxCount 约束。

---

## 4. 并发 GET 与幂等

多个客户端同时对同一 `pending` generation 发 GET 时:

| 机制 | 说明 |
|------|------|
| 乐观锁 | `lifecycle.advance(job)` 开始时: `UPDATE generation_jobs SET status='running', updated_at=? WHERE id=? AND status IN ('pending','running')`；影响行数 0 则跳过 poll（另一请求已在推进） |
| 转存幂等 | `db.imageExists(jobId, index)` 为 true 则跳过该张 downloadAndStore |
| 已完成不 poll | generation 已 `completed`/`failed`/`cancelled` 时，GET 不再调用 provider.poll |

---

## 5. 部分转存失败

当 count > 1（仅 async）或厂商返回多张图时:

- 逐张 `downloadAndStore`；**任一张失败** → 立即停止剩余张数
- 已成功的 `images` 记录**保留**
- job 与 generation 状态均为 `failed`
- `job.error` 写入 StorageError（含已成功的 index 列表可在 message 中描述）
- 不自动重试；客户端发起新 generation

---

## 6. 数据库事务

| 操作 | 事务要求 |
|------|----------|
| createGeneration + createGenerationJob | **同一 SQLite transaction**（步骤 3） |
| updateJob + updateGeneration（状态变更） | 同一 transaction |
| createImage | 可在转存成功后单独提交；失败时已写入的 image 不 rollback 文件 |

---

## 7. 时间戳更新规则

| 表 | updated_at 更新时机 |
|----|---------------------|
| sessions | 创建时；updateSession(title)；touchSession（新 generation 关联） |
| generations | 每次 status 变更时 |
| generation_jobs | 每次 status / error / provider_handle 变更时 |
| images | 不更新（不可变） |

---

## 8. generation 状态聚合规则

由 generation 下所有 job 状态推导（MVP 仅 1 job，规则仍完整定义）:

| job 状态组合 | generation.status |
|-------------|-------------------|
| 任一 job `failed` | `failed` |
| 任一 job `cancelled`（且无 failed） | `cancelled` |
| 所有 job `completed` | `completed` |
| 任一 job `running`（且无 failed/cancelled） | `running` |
| 其余 | `pending` |

---

## 9. storage 安全

`getReadStream(storagePath)` 必须:

1. 将 `storagePath` 与 `LOCAL_STORAGE_DIR` 拼接后 **canonicalize**
2. 断言结果路径仍在 `LOCAL_STORAGE_DIR` 下（防 `../` 路径遍历）
3. 不存在则 NotFoundError

---

## 10. 错误 HTTP 映射（API 层）

| 错误类型 | HTTP | body 示例 |
|----------|------|-----------|
| ValidationError | 400 | `{ "error": "..." }` |
| NotFoundError | 404 | `{ "error": "Not found" }` |
| provider 失败（已落库） | 201 | `{ "id", "status": "failed", "links" }` |
| StorageError（转存阶段） | GET 200 时 generation.status=`failed` | GenerationView.job.error |

---

## 自检

- 与 job-engine dfd-interface、db data-model 无矛盾
- 编码者无需猜测 poll 间隔、并发行为、部分失败语义
