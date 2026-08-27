# 4. 测试与验收标准

> 遵循 `docs/test-blueprint.md`：默认自动化不读取真实 key、不访问真实厂商；live browser flow 必须由用户显式授权且不进入 CI。

## 4.1 测试范围

| 类型 | 覆盖范围 | 外部边界 |
|---|---|---|
| Unit | hostname 配置、地址分类、timeout policy、adapter timeout 传递、错误 disposition | 注入 DNS resolver / typed fetch |
| Integration | URL 下载与 redirect 仍经 policy、staging/DB/lifecycle 不变 | MSW + 临时 SQLite/storage |
| Contract | 无新增公开 API；确认现有 Job 终态和安全 DTO 不回归 | route handler + fake 下游 |
| Smoke | build、migration、startup/readiness | 正常本地命令 |
| Live browser E2E | 开/关代理真实网络、Provider、图片读取、无重复提交 | 用户明确授权的真实 `.env` 与浏览器 |

## 4.2 关键场景

| ID | 场景 | 类型 | 验证点 | Phase |
|---|---|---|---|---|
| PXY-01 | 默认公网 HTTPS URL | Unit | 不配置白名单仍允许公网地址 | P1 |
| PXY-02 | 配置 Fal host + 单一 `198.18.0.125` | Unit | 允许 proxy-mapped exception | P1 |
| PXY-03 | 未配置 host + `198.18.0.125` | Unit | 拒绝 | P1 |
| PXY-04 | 配置 host + `10.x` / `127.x` / `169.254.x` | Unit | 仍拒绝 | P1 |
| PXY-05 | HTTP、URL credential、wildcard-like entry | Unit | 仍拒绝/不授权 | P1 |
| PXY-06 | mixed public + `198.18/15` DNS answers | Unit | 拒绝，不能由一个 fake answer 放宽整域 | P1 |
| PXY-07 | 初始 host 合法、redirect 到未白名单 proxy host | Integration | 每跳重检且拒绝，不创建图片文件 | P1 |
| PXY-08 | 开关代理等价矩阵 | Script/manual | 同一 configured host 在 fake-IP 与公网 resolver 下均按预期；脚本输出 PASS | P1 |
| TMO-01 | 四个 sync adapter | Unit | 调用的 HTTP options 是 180000ms | P2 |
| TMO-02 | sync request 31 秒未返回 | Unit/fake timer | 未因旧 30 秒预算 abort | P2 |
| TMO-03 | sync request 到 180 秒 | Unit/fake timer | abort、safe error 为 unknown；不得调用第二次 submit | P2 |
| TMO-04 | fal/Qwen/Kling | Unit | submit 仍 30 秒，fal/Kling poll 15 秒 | P2 |
| TMO-05 | queue/lease | Unit/integration | 30 秒排队 + 180 秒 submit 不越过 5 分钟 dispatch lease；未发生二次 submit | P2 |
| REG-01 | storage content/MIME/magic/25MiB | Unit/integration | P1 不放松既有转存安全规则 | P1 |
| LIVE-01 | fal、代理开启 | Browser | 单模型 count=1；completed 图片可由 `/api/images/:id` 读取 | P3 |
| LIVE-02 | fal、代理关闭 | Browser | 同一配置在公网 DNS 正常落盘 | P3 |
| LIVE-03 | ZenMux | Browser | Stage 可超过 30 秒等待至 terminal；没有自动新建第二单 | P3 |
| LIVE-04 | 服务交接 | Manual | E2E 后 dev server 仍在运行，用户可继续提交/查看历史 | P3 |

## 4.3 集成边界

- DNS resolver 必须由 `RemoteImageUrlPolicyOptions.resolveHostname` 注入；测试不能依赖开发机的代理状态。
- Provider adapter tests 不读取 `.env` 的真实 key；只断言 timeout options 和安全错误分类。
- storage integration 继续使用临时目录，验证拒绝后 `.tmp`、staging 和 image row 均不遗留。
- live E2E 的真实 Provider 仅在 P3、自动化全绿后执行；记录 generation ID 和结果，不记录完整 prompt、Authorization、key 或签名 URL。

## 4.4 回归命令

实施各批次至少运行对应测试文件，P3 运行：

```bash
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:smoke
git diff --check
```

若某命令失败，先修复并从受影响层级向上重跑；禁止以重复执行直到偶然绿色为验收。

## 4.5 发布/交接门

| 项 | 通过标准 |
|---|---|
| P1 安全 | PXY-01 至 PXY-07 全部通过；默认空配置仍拒绝 proxy/private 地址 |
| P2 韧性 | TMO-01 至 TMO-05 通过；无 async timeout 扩张、无 submit 自动重试 |
| 自动化 | 项目约定的 typecheck/unit/contract/integration/smoke 通过 |
| Live | 用户授权的 fal 与 ZenMux flow 有明确终态；至少一张图片可读；无重复费用请求证据 |
| 运行状态 | dev server 没有被 E2E 清理；最终交接报告写明访问 URL 和运行状态 |
| 提交 | P1/P2/P3 分别形成单一逻辑目的 commit，未混入 Gallery/locale 既有修改 |

## 4.6 本次执行结果（2026-07-20）

- 自动化：`npm run preflight`、`npm run test:integration`、`npm run test:smoke`、`git diff --check` 均通过；额外的 P1/P2 定向测试覆盖 proxy mapping、redirect、4 个 sync adapter、fal/Qwen/Kling async timeout 与 31s/180s fake timer 边界。
- Live：用户授权后，ZenMux 单模型/单图和配置 `TRUSTED_PROXY_IMAGE_HOSTS=v3b.fal.media` 的 fal 单模型/单图均进入 `completed`，图片可经本地图片 API 读取；未执行重复 submit。
- 服务：`npm run dev` 保持运行，等待人工继续验证。未为了测试切换用户的系统代理；代理关闭的公网 DNS 行为由 PXY-01/PXY-08 的注入 resolver 覆盖，建议操作者切换代理后复测一次。

## 4.7 对抗性审查

| 攻击面 | 防御 | 残余风险 |
|---|---|---|
| 恶意 Provider URL 指向内网 | 默认 DNS/IP 全拒绝；例外需精确 host + 全部 fake-IP 答案 | native fetch 仍有 DNS rebinding TOCTOU，沿用现有明确边界 |
| 白名单被写成 wildcard | parser 仅收 exact valid hostname；测试拒绝 wildcard-like value | operator 仍需审慎维护 `.env` |
| timeout 后重复收费 | sync timeout 只延长；`unknown` 仍 terminal/no replay | Provider 没有可查询 id 时仍需人工对账 |
| SDK 默认重试改变语义 | 本批不加 SDK；现有 retry/disposition 测试持续覆盖 | 未来 SDK 引入必须单独审核 retry 配置 |
| live E2E 后服务被清理 | P3 手动进程管理与交接门 | 用户机器重启或终端退出仍会结束 dev server |
