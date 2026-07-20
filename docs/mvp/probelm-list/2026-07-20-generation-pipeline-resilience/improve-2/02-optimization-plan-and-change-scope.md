# 2. 优化方案与改动面

> 本文是后续实施会话的执行契约；规划会话不据此改代码。

## 2.1 方案总览

```text
sync provider submit
  └─ timeout = bounded SYNC_IMAGE_GENERATION_TIMEOUT_MS (default 180000)

remote image URL
  └─ normal HTTPS/public DNS policy
       ├─ public answers → allow
       └─ reserved answer → deny
            └─ exception only when HTTPS + exact configured hostname
               + every DNS answer inside 198.18.0.0/15 → allow
```

例外只改变 remote image 的**地址分类**；URL 长度、HTTPS、userinfo、redirect 每跳复核、25 MiB、MIME/magic、临时文件和 lease/DB checkpoint 一律保留。

## 2.2 设计决策

| ID | 选择 | 理由 | 放弃项与代价 |
|---|---|---|---|
| D1 | `TRUSTED_PROXY_IMAGE_HOSTS` 为逗号分隔的精确 hostname 列表，默认空 | 关闭代理无需配置；开启代理只授权 operator 明知的媒体 origin | 需在 CDN host 改变后更新配置；不使用 wildcard 以免扩大信任面 |
| D2 | 仅对列表 host 的**全部** DNS 结果均在 `198.18.0.0/15` 时例外 | 适配已实测的 TUN fake-IP；混合回答宁可失败 | 不支持未知代理映射段；未来有明确证据时另开批次 |
| D3 | 保持 `ALLOW_PRIVATE_IMAGE_URLS` 的现有 local-fake 用途，但不用于本方案 | 避免破坏测试兼容，同时不把生产兼容写成全局 bypass | 该旧开关仍具高风险，后续可单独收紧 |
| D4 | 四个 sync image adapter 使用一个默认 180 秒、可配置且上限为 180 秒的预算 | 请求本身包含完整生成执行，实测 30 秒不足；统一避免 Provider 漂移 | 会较长时间占用一个 per-provider slot；不延长 async submit |
| D5 | 结果未知仍为终态且不自动重投 | 三分钟后依然不能判断 Provider 是否已计费 | 仍存在保守 false-unknown；由 Provider 对账而非代码猜测解决 |
| D6 | 不迁移 SDK | 当前 raw fetch 已具 timeout、body-size、状态持久化和安全边界；SDK 不会消除 fal CDN 下载 | 放弃 SDK 的类型/便利 API；减少依赖和重试语义冲突 |

## 2.3 分阶段实施

### P1：代理映射安全例外

**目标**：在不开全局 private address bypass 的前提下，让精确配置的透明代理图片 host 可下载。

**改动**：

- `src/lib/storage/image-url-policy.ts`
  - 解析 `TRUSTED_PROXY_IMAGE_HOSTS`：trim、小写、去重、只接受合法 hostname；空/非法条目不产生授权。
  - 引入仅识别 IPv4 `198.18.0.0/15` 的函数；不得接受 `198.51.100/24` 或其他 reserved/private range。
  - 将例外放在现有 `isForbiddenAddress` 检查之前；必须同时满足 HTTPS、exact hostname、非空 DNS 结果且 `every()` 属于该段。
  - `allowPrivateAddresses` 为 true 时保持现有显式开发/测试行为，但不得成为实现 P1 测试的捷径。
- `src/lib/storage/index.ts`：初始和 redirect 仍复用同一个 options/policy；必要时只传递现有 options，禁止跳过 redirect 校验。
- `src/lib/storage/image-url-policy.unit.test.ts`、`src/lib/storage/index.unit.test.ts`：新增矩阵见 04。
- `.env.example`、`README.md`：记录精确 host 配置、仅适合透明代理的用途，以及禁止 `ALLOW_PRIVATE_IMAGE_URLS=true` 作为常规方案。

**DoD**：默认、未白名单、HTTP、LAN/loopback、mixed DNS、redirect 到未白名单 host 全部拒绝；代理开/关两种 Fal host 解析均通过对应预期。

### P2：同步生成三分钟预算

**目标**：把“等待生成完成”的同步 Provider 与“创建远端 task”的异步 Provider 分离。

**改动**：

- 新增最小的 `src/lib/providers/timeout-policy.ts`（或同等单职责模块）：解析 `SYNC_IMAGE_GENERATION_TIMEOUT_MS`，默认 `180_000`；接受正整数，越界/非法回落默认，最大不能超过 `180_000`。不要在每个 adapter 重复环境变量解析。
- `src/lib/providers/adapters/{zenmux,siliconflow,zhipu,doubao}.ts`：向既有 HTTP helper 显式传入该 timeout；保留 36 MiB inline-response ceiling、错误映射及 `unknown` disposition。
- 不修改 `fal.ts`、`qwen.ts`、`kling.ts` 的 submit/poll/cancel timeout，也不修改 storage 60 秒下载预算、limiter 30 秒入队预算或 `POLL_LEASE_MS=300_000`。
- `src/lib/providers/timeout-policy.unit.test.ts`（新增）、四个 adapter unit tests、必要的 `http-client.unit.test.ts`：断言四个 sync adapter 实际传入 180 秒预算，async adapter 不变；超时结果仍为 unknown，绝不变为安全重投。
- `docs/mvp/providers/{architecture,dfd-interface,test}.md`、`docs/mvp/job-engine/architecture.md`：同步 timeout/queue/lease 预算关系与不重试原因同步。

**DoD**：在 fake timer/typed fetch 下，31 秒未完成的 sync 请求不 abort，180 秒到达时 abort 且产出 `PROVIDER_OUTCOME_UNKNOWN`；异步 Provider 继续使用 30 秒 submit 和现有 15 秒 poll。

### P3：回归、真实验收与交接

**目标**：确认 P1/P2 不只在 mock 中成立，且用户可继续在同一服务上手测。

**改动与执行**：

- 更新 `docs/mvp/storage/architecture.md`、`docs/mvp/providers/test.md`、`.env.example`、README 与本目录的实施状态。
- 依序运行相关 unit、`npm run preflight`、`npm run test:integration`、`npm run test:smoke`、`git diff --check`。
- 用户授权后，以当前 `.env` 启动 `npm run dev`，浏览器只选一个目标、`count=1`：分别验证 fal（开启代理的代理映射路径）与 ZenMux（同步等待）；记录 generation ID、终态、图片可读性和是否发生重复提交，不记录 prompt/key/签名 URL。
- 测试完成后**不停止该 dev server**；在最终交接中给出 URL、PID/端口、最后日志位置与已知状态，等待用户手测。除非用户要求或进程异常，后续不主动终止。

**DoD**：所有自动化通过；受控 live flow 不产生自动二次 submit；服务保持可访问。

## 2.4 按目录的改动面

| 路径 | 新增 | 修改 | 删除 | 说明 |
|---|---:|---:|---:|---|
| `src/lib/storage/` | 0 | policy/tests | 0 | 精确 host + proxy-mapped IP 例外 |
| `src/lib/providers/` | 1 policy + tests | 四个 sync adapter、HTTP/adapter tests | 0 | 统一三分钟 sync 预算 |
| `src/lib/job-engine/` | 0 | 文档/必要测试 | 0 | 验证 5 分钟 lease 仍覆盖预算，不改语义 |
| `.env.example`, `README.md` | 0 | 配置说明 | 0 | 最小安全操作说明 |
| `docs/mvp/{storage,providers,job-engine}/` | 0 | 权威事实 | 0 | 与运行时对齐 |

## 2.5 配置、兼容与 API

```dotenv
# Comma-separated exact HTTPS media hostnames that a local transparent proxy
# maps into 198.18.0.0/15. Empty by default; this is not a private-network bypass.
TRUSTED_PROXY_IMAGE_HOSTS=

# Applies only to synchronous image-generation adapters; valid values are
# positive integer milliseconds up to 180000. Defaults to 180000.
SYNC_IMAGE_GENERATION_TIMEOUT_MS=180000
```

没有数据库迁移、公开 API DTO 或浏览器请求 payload 改动。环境变量在重启 Next 服务后生效；不支持运行中热更新。

## 2.6 风险与回滚

| 风险 | 防御 | 回滚 |
|---|---|---|
| 白名单错填扩大边界 | exact hostname、固定 `/15`、HTTPS、全 DNS answers、redirect 重检、默认空 | 清空 `TRUSTED_PROXY_IMAGE_HOSTS` 并重启，立即恢复默认拒绝 |
| CDN host 轮换 | 安全失败而非模糊放行；日志含无敏感类别 | 验证新 host 后显式加入配置 |
| 三分钟占用 slot 导致排队 | 仅 sync adapter 受影响；现有 provider limiter 仍有 30 秒队列预算 | 配置较低合法值或回退代码；不扩大 queue/lease |
| timeout 仍发生结果未知 | 保持无重投、指向 Provider 对账 | 无数据回滚；按现有 terminal semantics 处理 |
| live 测试产生费用 | 明确授权、单模型/单张、记录 ID | 不自动重试，不运行在 CI |

## 2.7 与 00 对齐检查

- P1 实现精确白名单而非全局 private bypass。
- P2 将所有 sync Provider 统一为三分钟，不改 async 语义。
- P3 要求 live E2E 后服务保持运行，并把分批 commit 作为实施约束。

## 2.8 不在本批

SDK 迁移、ZenMux SSE/partial image 产品体验、远端代理协议检测、多代理 CIDR 支持、跨进程 worker、Provider 计费对账 API、既有 unknown Job 恢复和 UI 视觉改动均留在后续独立议题。
