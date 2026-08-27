# 4. 测试与验收标准

> 遵循 `docs/test-blueprint.md`。默认自动化使用 fake adapters、临时 DB 与临时 storage，不读取真实 API key。真实 Provider 测试必须显式执行、控制数量，并确认 retry-storage 的 submit 调用次数始终为零。

## 4.1 测试层次

| 类型 | 覆盖 |
|---|---|
| Unit | ModelSpec、host 规范化、phase 转换、错误分类、cancel、view mapper、polling |
| Contract | retry-storage API、JobView、错误码、重复请求 |
| Integration | 持久 blocked、重启、部分落盘、CAS/lease、snapshot cleanup、Fake-IP resolver |
| Build/Smoke | schema compatibility、真实 `npm run build`、3000 服务启动/重启 |
| Live Provider | Doubao Lite、Qwen 两模型的生成→转存；只做最小付费请求 |
| Browser | 生成、blocked 文案、修复条件后重试保存、收藏与重启读取 |

## 4.2 模型标识

| ID | 场景 | 验证点 |
|---|---|---|
| MOD-01 | Doubao capability | UI 名称 `Seedream 5.0 Lite` 唯一对应 `doubao-seedream-5-0-lite-260128` |
| MOD-02 | submit payload | adapter 发送 Lite 标识，不发送旧非 Lite 标识 |
| MOD-03 | 旧 preference | 不影响新模型默认可用；不能通过 API重新启用已移除标识 |
| MOD-04 | 历史记录 | 旧 job model 字段保持原值，详情仍可查看 |
| MOD-05 | Provider 拒绝 | 显示 model/endpoint 诊断与 request id，不误报 storage/network |

## 4.3 Fake-IP 与 SSRF

| ID | 场景 | 验证点 |
|---|---|---|
| NET-01 | 系统代理关闭，DNS 返回公网 IP | 已知/未知 HTTPS 公网域名按正常策略下载 |
| NET-02 | Qwen 已知主机解析 198.18/15 | Provider 私有精确 allowlist 允许继续，完成 TLS/redirect/content 校验 |
| NET-03 | 未知主机解析 198.18/15 | 拒绝 `proxy_mapping_not_trusted`，暴露安全 hostname |
| NET-04 | 已知主机解析 127/8、10/8、169.254/16 | 仍拒绝，不因 known host 绕过 SSRF |
| NET-05 | redirect 到未知 Fake-IP 主机 | 每跳重新校验并拒绝 |
| NET-06 | env 追加精确主机 | 仅该主机生效；scheme/path/wildcard/IP 配置被忽略或拒绝 |
| NET-07 | 开关路由器代理后重试 | 公网解析与 Fake-IP 解析都能完成同一安全保存链路 |

## 4.4 状态机与持久化

| ID | 场景 | 验证点 |
|---|---|---|
| JOB-01 | retryable 下载错误未耗尽 | 保持自动 storing retry，不提前 blocked |
| JOB-02 | 自动重试耗尽 | `running/storage_blocked`，snapshot 保留，request snapshot 清空 |
| JOB-03 | 非 retryable proxy mapping/local write | 直接 blocked，安全 error 保留 |
| JOB-04 | invalid URL/content/snapshot | `failed/terminal`，不提供 retry-storage |
| JOB-05 | worker due scan | blocked job 不被自动 claim，无热循环 |
| JOB-06 | 服务重启 | blocked row、error、snapshot 和按钮语义保持 |
| JOB-07 | state transition | 只允许 storing→blocked→storing/terminal；terminal 不复活 |
| JOB-08 | Generation 聚合 | blocked job 使 Generation 保持 running，但 UI 显示等待保存 |

## 4.5 只重试保存 no-replay

| ID | 场景 | 验证点 |
|---|---|---|
| RET-01 | 合法 retry-storage | CAS 到 storing，下载既有 ref，最终 completed |
| RET-02 | adapter spy | submit 调用次数为 0；async Provider poll 也不重新创建任务 |
| RET-03 | 同一按钮双击/并发请求 | 最多一个 transition/lease；无重复图片/文件 |
| RET-04 | 重试再次失败 | 回到 blocked，snapshot 仍存在，可再次尝试 |
| RET-05 | 两张图已保存一张 | 只处理缺失 index，已保存图片 ID/path 不变 |
| RET-06 | URL 在等待中失效 | 安全 blocked/terminal 由分类决定，不转为 submit |
| RET-07 | 非 blocked job 调 API | 409/当前状态；completed/failed/cancelled 均不复活 |
| RET-08 | snapshot 缺失/损坏 | 拒绝重试并安全终止，不读取 request snapshot 重建请求 |

## 4.6 取消与删除

| ID | 场景 | 验证点 |
|---|---|---|
| CAN-01 | 取消单个 blocked job | terminal/cancelled；snapshot/staging 清理；Provider cancel=0 |
| CAN-02 | 取消含 blocked + polling 的 Generation | blocked 本地终止，polling 按既有远程取消，各自不串线 |
| CAN-03 | retry 与 cancel 并发 | 单一 CAS winner；无状态复活或孤儿文件 |
| CAN-04 | 删除 blocked Generation | DB、snapshot、staging 清理；不 submit/poll |

## 4.7 API、UI 与日志

| ID | 场景 | 验证点 |
|---|---|---|
| UI-01 | blocked detail | 文案为“生成已完成，但图片尚未保存”，显示安全诊断和 hostname |
| UI-02 | 重试按钮 | 明示不会重新生成/计费；点击期间禁用；恢复轮询 |
| UI-03 | 多 Provider | 只给 blocked job 按钮，Doubao Provider 失败不显示保存重试 |
| UI-04 | terminal storage-invalid | 不显示按钮，错误码/文案一致 |
| LOG-01 | blocked/retry events | JSONL 与 stderr 可关联 job/request；无 URL/prompt/key/path |
| LOG-02 | 重复/拒绝重试 | 安全 reason 可排查，不输出 raw error |

## 4.8 真实 Provider 验收

### 前置记录

- 记录 `scutil --proxy`、默认网关与三个测试域名 DNS 结果。
- 不输出 API key；记录 app run id、Generation id、Provider request id 与安全诊断。
- 使用真实 `mvp`、真实 `.env`、3000 端口；不得让临时 DB/root 指向生产 `data/images`。

### 最小用例

1. Doubao Seedream 5.0 Lite 生成一张低成本测试图，确认请求标识和 Provider 接纳。
2. Qwen `qwen-image-2.0-pro` 生成一张，确认 OSS URL 在路由器 Fake-IP 下立即安全落盘。
3. Qwen `wan2.7-image-pro` 生成一张，确认相同链路。
4. 使用 fake adapter 或受控 DNS 注入制造一次 `storage_blocked`；修复条件后在浏览器点击“重试保存”。
5. 通过 adapter counter/日志证明该操作没有新的 submit；图片可收藏、服务重启后仍可读取。

不建议为了制造 blocked 对真实已付费 URL 临时删除白名单；自动化注入能更可靠证明 no-replay。真实环境只验证正常落盘与 UI 路径。

## 4.9 执行门禁

定向阶段：

```bash
npm run test:unit -- --run src/lib/job-engine src/lib/storage src/lib/providers
npm run test:contract
npm run test:integration
git diff --check
```

最终门：

```bash
npm run preflight
npm run test:release
npm run build
git diff --check
```

若 package scripts 不支持上述带路径语法，按现有 Vitest 配置使用等价命令，不为迎合文档修改测试框架。

## 4.10 发布标准

- Lite 模型标识在 catalog、请求与 UI 一致，旧历史未被篡改。
- 路由器 Fake-IP 开启与关闭两种场景都能保存已知 Provider 图片；未知/私网主机仍 fail closed。
- 所有 recoverable 保存失败保留 durable result snapshot 并进入 storage_blocked。
- 用户只重试保存后成功落盘，Provider submit=0；重复点击、重启、部分落盘均幂等。
- 取消/删除可清理 blocked 资源，不触发 Provider 调用。
- 错误码、中文文案、诊断 hostname 与日志一致且脱敏。
- unit/contract/integration/release/build、3000 浏览器和最小真实 Provider 验收全部通过。
