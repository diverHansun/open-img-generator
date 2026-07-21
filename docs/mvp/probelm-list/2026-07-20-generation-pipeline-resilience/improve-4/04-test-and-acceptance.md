# 4. 测试与验收标准

> 遵循 `docs/test-blueprint.md`：unit/contract/integration/smoke 分层；DB 与 storage 成对使用临时路径；默认测试不读取真实凭据、不访问 Provider。真实 handle 恢复必须显式、只读、逐任务执行。

## 4.1 测试范围

| 类型 | 覆盖 |
|---|---|
| Unit | missing/favorite 不变量、ownership marker/lock、媒体 refs、日志脱敏/轮转、guarded restore |
| Contract | Gallery tombstone DTO、nullable URL、410/requestId；收藏/删除兼容 |
| Integration | 两套 DB/root 配对、cleanup、missing read、JSONL、恢复事务、image/video orphan |
| Smoke | restart、默认/绝对路径、build、真实迁移 DB 不变 |
| Browser | Gallery 墓碑、取消收藏、来源详情、刷新/重启；不制造付费任务 |
| Manual recovery | 备份、三条 favorite restore、既有 Fal/Qwen handle 只读 poll |

## 4.2 Favorite 与 Gallery

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| FAV-01 | available 收藏文件被外部删除后 GET | Integration | 410 `IMAGE_MISSING`；image tombstone；favorite 行仍存在 |
| FAV-02 | listFavorites 含 missing favorite | Unit/Contract | 返回 `url:null`、`availability:storage_missing`、removedAt 与 lineage |
| FAV-03 | Gallery missing tile | Component/Browser | 无 `<img src>`/broken preview；显示缺失；可查看来源和取消收藏 |
| FAV-04 | missing image 新增收藏 | Contract | 仍拒绝，不允许把任意 tombstone 新收藏 |
| FAV-05 | missing favorite 取消收藏 | Contract/Integration | 只删除 favorite；image tombstone 保留 |
| FAV-06 | 显式单图/Generation 删除 | Integration | 继续删除 favorite；不被新 preserve 逻辑阻止 |
| FAV-07 | retention 与 favorite | Unit | 收藏 available image 不进入候选；missing favorite 不被 cleanup 删除 |

## 4.3 Storage ownership

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| OWN-01 | 空 root + DB A | Unit/Integration | 原子创建 marker；后续 read/write/cleanup 可用 |
| OWN-02 | root 文件集合与 DB A refs 精确一致 | Integration | 旧安装安全认领，文件不变 |
| OWN-03 | root 有未知正式文件 | Integration | 拒绝自动认领，不删除任何文件，记录 refusal |
| OWN-04 | DB B 指向 DB A root | Integration | marker mismatch；write/delete/cleanup fail closed；A 文件保留 |
| OWN-05 | 相同 DB/root 服务重启 | Smoke | owner hash 稳定，图片读取与生成不受影响 |
| OWN-06 | marker malformed/unsupported version | Unit | 安全拒绝，不覆盖 marker、不泄漏内容 |
| OWN-07 | 两个 cleanup 同 root | Integration | 只有一个获得 lock；另一个 skipped，无重复删除 |
| OWN-08 | stale lock | Unit/Integration | 仅满足明确 stale 条件才回收并审计 |
| OWN-09 | DB 合法路径改变 | Manual/Integration | 默认拒绝；显式维护认领前无破坏性动作 |

## 4.4 Media cleanup

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| MED-01 | image path referenced | Integration | orphan scan 保留 |
| MED-02 | video path referenced | Integration | MP4 超过 grace 仍保留 |
| MED-03 | durable staging referenced | Unit/Integration | 保留；终态取消引用后按 grace 清理 |
| MED-04 | marker/lock/internal files | Unit | 不作为媒体 orphan 删除 |
| MED-05 | 真 orphan 超过 grace | Integration | ownership + lock 成功后才删除，产生 audit |
| MED-06 | owner mismatch + 真 orphan | Integration | 不删除，返回 skipped/refused 计数 |
| MED-07 | retentionDays=0 | Unit | 禁用未收藏过期；ownership 仍校验，orphan 策略按契约执行 |

## 4.5 日志与安全

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| LOG-01 | API/storage/worker 事件 | Unit | 每行合法 JSON、固定 event/level/timestamp/schema |
| LOG-02 | raw Error 含 key/prompt/signed URL/absolute path | Unit | console 与 JSONL 均无 canary |
| LOG-03 | 超长字段/未知 event | Unit | 截断或拒绝；单条 ≤4 KiB |
| LOG-04 | 文件达到 5 MiB | Unit/Integration | 有限轮转，仅保留当前 + 3 份 |
| LOG-05 | log dir 不可写 | Unit | 业务得到安全降级；logger 不递归/不崩溃 |
| LOG-06 | ownership mismatch | Integration | 必有 `storage.ownership_refused`，hash prefix 可关联但无路径 |
| LOG-07 | missing favorite | Integration | `storage.missing_detected` 含 imageId/wasFavorite，不含 storage path |
| LOG-08 | orphan removal | Integration | started/completed/runId 与 file outcome 可关联 |

## 4.6 恢复

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| REC-01 | 恢复前备份 | Manual | current DB/WAL/SHM/media/迁移备份可读取，记录校验值 |
| REC-02 | 从 v4→v5 backup 导入三条 favorite | Integration/Manual | 仅匹配现有 image ID，幂等；Gallery 三条 tombstone |
| REC-03 | Fal/Qwen handle 返回既有结果 | Integration fake/live opt-in | 只调用 poll/result；安全转存；guarded restore available |
| REC-04 | handle 结果过期/失败 | Integration fake/live opt-in | tombstone 不变；无 submit/retry generation |
| REC-05 | restore 与用户删除并发 | Unit/Integration | 用户删除胜；未提交文件清理；无状态复活 |
| REC-06 | ZenMux/Zhipu 无 handle | Review | 明确报告不可自动恢复，不猜测 URL/重新生成 |

## 4.7 回归

不得破坏：

1. Base64 staging、URL immediate materialization、MIME/magic/大小与 SSRF 边界。
2. 未收藏默认 7 天、下载不续期、explicit image/Generation delete。
3. Generation/Job/Prompt/Provider error 历史与 tombstone 410。
4. durable worker、cancel、retry、outcome-unknown no-replay。
5. schema v5、Seedance video create/read 与现有图片 API。
6. 默认 CI 无真实 key、无付费请求、无真实 `data/` 读写。

## 4.8 对抗性审查

| 攻击面 | 防御 | 残余风险 |
|---|---|---|
| 两个 DB 争用同一 root | atomic marker、path hash、fail closed、lock | 复制 DB 且保持同路径 hash 不可区分；正式单实例约束下接受 |
| marker/lock 被手工删除 | 首次认领必须集合一致；日志记录重新认领 | 管理员可同时改 DB/文件，应用无法对抗恶意本机管理员 |
| 日志泄露签名 URL/Prompt/key | allowlist schema + canary tests + raw error discard | OS 管理员仍可读本地日志；文件权限应为用户私有 |
| 日志成为磁盘问题 | 固定轮转上限 | 极端轮转竞态可能丢日志，不得影响媒体正确性 |
| missing favorite 永久占位 | 用户可取消收藏或删除历史 | 文件无法恢复时只能保留意图与解释，不能承诺字节永久 |
| Provider result recovery 重复计费 | 只允许 poll/result，禁止 submit | 上游 API 的查询计费规则由 Provider 决定，live 前复核 |

## 4.9 执行门禁

定向实现阶段先运行相关 unit/contract/integration。每批提交前：

```bash
npm run preflight
git diff --check
```

ownership、cleanup 和恢复完成后：

```bash
npm run test:integration
npm run test:smoke
```

最终发布门：

```bash
npm run test:release
npm run build
git diff --check
```

浏览器验收必须使用真实 3000 服务并重启一次；另起 3100 测试时必须在启动命令中同时给出独立 `DATABASE_URL`、`LOCAL_STORAGE_DIR` 和 `APP_LOG_DIR`。

## 4.10 发布标准

- FAV/OWN/MED/LOG 全部自动化通过。
- 当前 9 张 available 图片在修复、测试、重启后仍可读取。
- 三条历史 favorite 恢复为可见 tombstone，不被浏览器读取再次删除。
- ownership mismatch 测试证明第二 DB 无法删除第一 DB 媒体。
- video path 被媒体引用集合保护。
- 日志可重启后读取、大小有界、canary 全部脱敏。
- best-effort Provider 恢复结果如实记录；不可恢复不阻塞安全修复发布。
- `test:release`、显式 build、3000 浏览器验收与文档回写通过。
