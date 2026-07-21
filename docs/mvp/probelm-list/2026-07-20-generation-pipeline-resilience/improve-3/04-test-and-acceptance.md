# 4. 测试与验收标准

> 遵循 `docs/test-blueprint.md`：Unit/Contract/Integration/Smoke 分层；Integration 使用临时 SQLite/storage 与 MSW；真实 Provider/浏览器调用必须显式授权，不进入默认 CI。本文件是实施完成后的验收契约。

## 4.1 风险与测试分层

| 类型 | 本批覆盖 | 真实边界 |
|---|---|---|
| Unit | retention 配置、availability 派生、DB 条件更新、cleanup、adapter request/parse、文件名 | 内存 SQLite/临时目录/typed fetch |
| Contract | ImageView nullable URL、410 error、download headers、DELETE 幂等、History/Gallery DTO | route handler + fake/临时下游 |
| Integration | Provider response→staging/download→DB→image API→favorite/cleanup/delete/history | 临时文件 SQLite/storage + MSW；不访问厂商 |
| Smoke | v3→v4 备份/迁移/schema/FK/index、fresh DB、build/start | 真实 migration script/临时 DB |
| Browser manual | 过期/删除占位、下载、收藏、刷新/重启；必要时受控真实 Provider | 本地服务；真实厂商只在用户授权后 |

不设置覆盖率百分比门槛。发布门围绕数据不丢、状态不误报、并发不误删和安全边界不回退。

## 4.2 P1：Provider 内联优先

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| INL-01 | 豆包 text-to-image request | Unit | body 固定 `response_format: 'b64_json'`，providerOptions 不能覆盖 |
| INL-02 | 豆包返回合法 `b64_json` | Unit/Integration | 转 Data URI、分块 staging、MIME/magic 正确、最终 image 可读 |
| INL-03 | 豆包仍返回 URL | Unit/Integration | parser fallback 正常，走安全 immediate download |
| INL-04 | 豆包 Base64 超过 36 MiB JSON/25 MiB decoded | Unit | 有界拒绝，无完整 raw payload 入 DB/log |
| INL-05 | 豆包 Base64 MIME 与 magic 不一致 | Unit/Integration | STORAGE_ERROR；不创建 image row/final file |
| INL-06 | ZenMux `b64_json` 与 URL | Unit | 两种响应都保留，空字符串不形成可用 image ref |
| INL-07 | durable snapshot | Integration | SQLite `result_snapshot` 只有 `staging:<uuid>`，不含 `data:`/Base64 原文 |
| INL-08 | fal/Qwen/Kling | Unit/contract | submit/poll 仍为 async handle/URL；未启用 fal `sync_mode=true` |
| INL-09 | SiliconFlow/Zhipu | Unit | response parsing 仍要求 URL，不伪造 Base64 能力 |

## 4.3 P2：schema v4 与墓碑

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| MIG-01 | fresh DB | Smoke | 直接创建 v4；manifest、table、check/index/FK 完整 |
| MIG-02 | 真实形状 v3 DB 含 images/favorites | Smoke | 产生版本化 backup；所有行/路径/收藏/关联保留为 available |
| MIG-03 | v3 DB 含多 Job、多 image index | Smoke | `(generation_job_id,index)` unique 保留，复制 count 相同 |
| MIG-04 | v3→v4 中途故障注入/非法 schema | Smoke | migration transaction 回滚，原 v3 DB 与 backup 可用，无半表 |
| MIG-05 | 重复执行迁移 | Smoke | v4 no-op，schema check/FK check 通过，不重复重建 |
| MIG-06 | v4 DB 由旧代码打开 | Manual/compat | 明确不支持 downgrade；回滚说明要求恢复 v3 backup + 旧代码 |
| DB-01 | available invariant | Unit | path 非空、removed 字段为空；非法组合被 DB/写入口拒绝 |
| DB-02 | tombstone invariant | Unit | path NULL、removedAt/reason 完整；非法 reason 拒绝 |
| DB-03 | History 混合可用/过期/删除 | Unit/Contract | 三行都返回；总 imageCount=3；只有 available 有 URL |
| DB-04 | tombstone favorite | Unit/Contract | 不允许新增 favorite；Gallery 不返回墓碑 |
| DB-05 | Job/Generation cascade | Unit | 删除上层历史仍可 cascade；本批 cleanup 本身不触发该 cascade |
| DB-06 | 项目总数与封面 | Unit/Contract | imageCount 包含 tombstone；cover 只选最新 available；全不可用时为 null |

Migration smoke 必须使用生产 `scripts/migrate-db.mjs`，不得只在测试中另写一份“看起来相同”的迁移。

## 4.4 P3：Retention、收藏、删除、缺失与下载

### 4.4.1 配置与时间

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| RET-01 | 未配置 | Unit | 默认 7 天 |
| RET-02 | `0` | Unit | 自动 retention 禁用，orphan/staging cleanup 仍可按各自规则工作 |
| RET-03 | `1/7/30/365/36500` | Unit | 合法正整数按天换算，不受 locale/时区影响 |
| RET-04 | 负数、小数、NaN、Infinity、空格垃圾、超限 | Unit | 回退 7；只产生一次安全 warning |
| RET-05 | 7 天边界 | Unit/fake clock | `< cutoff` 才进入候选；边界定义固定且不随浏览/下载变化 |
| RET-06 | 老图取消收藏 | Unit/Integration | createdAt 不重置；下一轮 cleanup 可立即过期 |

### 4.4.2 cleanup 与竞态

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| CLN-01 | 旧未收藏 available image | Unit/Integration | 标 `retention_expired`、path 置 NULL、文件删除、历史行保留 |
| CLN-02 | 旧收藏 image | Unit | 不更新、不删文件、retained count 正确 |
| CLN-03 | cleanup 与 favorite 并发，favorite 先胜 | Unit/Integration | cleanup conditional update=0，文件保留 |
| CLN-04 | cleanup 与 favorite 并发，cleanup 先胜 | Unit/Contract | tombstone 成立；favorite 返回可操作的 Gone/Conflict，不复活文件 |
| CLN-05 | tombstone 成功但文件删除失败 | Unit | failure 统计；API 410；文件成为 orphan，后续 grace cleanup 删除 |
| CLN-06 | cleanup dryRun | Unit | 只报告候选，不改 DB/文件/favorite |
| CLN-07 | 已是 tombstone | Unit | 不重复计数/删除/更新 removedAt |
| CLN-08 | worker 首次 tick/每小时 | Unit | 复用单一 scheduler，不产生重叠 cleanup |

### 4.4.3 主动删除

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| DEL-01 | 删除普通 available image | Contract/Integration | 204；`user_deleted` 墓碑；文件删除；History 保留 |
| DEL-02 | 删除已收藏 image | Integration | 同一短事务移除 favorite + tombstone；Gallery 消失；文件删除 |
| DEL-03 | 重复 DELETE tombstone | Contract | 幂等 204；removedAt/reason 不被覆盖 |
| DEL-04 | DELETE unknown ID | Contract | 404，不泄漏路径/DB 信息 |
| DEL-05 | DELETE 与 cleanup 并发 | Unit/Integration | 最终只有一个稳定 reason，文件最多被安全删除一次，无 500/坏 favorite |
| DEL-06 | DELETE 与下载并发 | Integration | 已打开的下载按冻结语义完成；后续读取/下载 410 |

### 4.4.4 文件缺失与读取

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| IMG-01 | available + 文件存在 | Contract/Integration | inline GET 200、正确 Content-Type/body |
| IMG-02 | retention tombstone | Contract | 410 `IMAGE_EXPIRED`，不返回路径 |
| IMG-03 | user tombstone | Contract | 410 `IMAGE_DELETED` |
| IMG-04 | missing tombstone | Contract | 410 `IMAGE_MISSING` |
| IMG-05 | DB available 但文件被外部删除 | Integration | 原子协调为 storage_missing，清除坏 favorite，返回 410，History 仍有占位 |
| IMG-06 | 完全未知 image ID | Contract | 404，与 410 可区分 |
| IMG-07 | storage path traversal/tamper | Unit/Integration | 继续拒绝，不在错误响应暴露绝对路径 |

### 4.4.5 下载

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| DLD-01 | 下载 available image | Contract/Integration | 200 attachment；Content-Type、filename/extension 合法；body 与本地文件一致 |
| DLD-02 | prompt/header 注入字符 | Unit/Contract | filename 不含 prompt/CRLF/path separator，Content-Disposition 安全 |
| DLD-03 | 下载后运行 cleanup | Integration/fake clock | createdAt/favorite/removed 字段未变；到期仍清理内部副本 |
| DLD-04 | tombstone 下载 | Contract | 对应 410，不生成空文件/HTML 伪图片 |
| DLD-05 | 浏览器标准下载 | Browser | 由浏览器下载/另存；应用不宣称控制最终路径 |

## 4.5 P4：UI 与历史解释

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| UI-01 | Generation 含 available | Component/Browser | 正常预览、收藏、下载、删除 |
| UI-02 | Generation 含 expired | Component/Browser | “图片已过期清理”；无 broken `<img>`、预览/收藏/下载按钮 |
| UI-03 | Generation 含 user_deleted | Component/Browser | “图片已删除”，不显示 Provider failed |
| UI-04 | Generation 含 storage_missing | Component/Browser | “本地图片文件不存在”，提供可排查信息但不泄漏路径 |
| UI-05 | completed Job 全部图片过期 | Contract/Browser | Job 仍 completed，历史显示 N 张已过期，不显示“服务商没有返回图片” |
| UI-06 | 2 张图，1 收藏/1 过期 | Integration/Browser | 总历史数为 2；一张可用，一张过期；Gallery 只有收藏图 |
| UI-07 | 删除收藏图确认 | Browser | destructive 文案清晰；取消确认无副作用；确认后 Gallery/详情同步 |
| UI-08 | retention 说明 | Component/Browser | 显示默认 7 天、收藏保留、下载不续期；中英文一致 |
| UI-09 | 服务刷新/重启 | Browser | tombstone 和 available 状态由 DB 恢复，不依赖内存/远端 URL |
| UI-10 | 首页项目封面 | Component/Browser | 最新记录为 tombstone 时回退到最新 available；全部不可用时无 broken image |

## 4.6 当前网络安全回归

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| NET-01 | URL-only Provider + 公网 HTTPS | Unit/Integration | 仍按 immediate download、redirect、MIME/magic、size policy 落盘 |
| NET-02 | 精确 trusted host + `198.18/15` | Unit | improve-2 窄例外继续有效；未配置/其他 private range 仍拒绝 |
| NET-03 | 豆包/ZenMux Base64 | Integration | 不触发 CDN DNS/代理下载，但仍经过 staging/字节校验 |
| NET-04 | 文档与 UI 说明 | Review | 不宣称当前 Node 后端自动继承浏览器代理；App 系统网络栈保持未来宿主边界 |

## 4.7 集成边界与测试基础设施

- 修改过的 Integration 测试必须使用 `registerMswLifecycle()`/MSW 声明 Provider/CDN HTTP，不覆盖 `global.fetch`，不访问真实网络。
- DB 使用 `createIntegrationDb()` 或等价临时文件；storage 使用 `createStorageDir()`；测试后恢复 `DATABASE_URL`、`LOCAL_STORAGE_DIR`、retention env 并删除临时资产。
- 时间边界使用注入 clock/fake timer 或显式 cutoff 参数，不等待真实 7 天，不用长 `sleep`。
- 并发场景使用可控 barrier/transaction 顺序，断言两个合法线性化结果之一；禁止以随机循环“碰运气”。
- Contract 直接执行真实 route handler，断言 status、structured error code、headers 和消费者可见 DTO。
- Migration 测试从 v3 fixture 文件/DDL 运行生产脚本；`tests/helpers/db-schema.ts` 更新为 v4 后仍保留 v3 migration fixture，不把历史 fixture 覆盖掉。
- 浏览器人工流程可以使用维护脚本/临时 DB 制造刚过期 tombstone；不得修改用户真实历史以节省测试时间。

## 4.8 回归清单

本批不得破坏：

1. improve-1 durable Job/lease、result snapshot、retry、cancel、unknown no-replay 语义。
2. improve-2 三分钟同步 timeout、默认 SSRF 拒绝、精确 host/fake-IP 兼容。
3. PNG/JPEG/WebP、25 MiB、MIME/magic、manual redirect 和签名 URL 脱敏。
4. Generation/Favorites/History project/session lineage 与分页。
5. Gallery 收藏幂等和取消收藏。
6. 旧 v3 用户 DB 的启动迁移与备份。
7. 服务重启后 available 图片继续从本地路径读取。
8. 默认测试不读取真实 Provider key、不发起付费请求。

## 4.9 执行命令

实施中先运行对应定向测试；每个逻辑批次提交前至少：

```bash
npm run preflight
git diff --check
```

P2 migration 与 P3 storage 完成后：

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

若 `test:smoke` 已包含 production build，仍以项目脚本实际行为为准，避免无意义重复；最终交接必须列出实际运行的命令和结果，不把空 suite/skip 当作通过。

## 4.10 发布与验收门

| 门 | 通过标准 |
|---|---|
| Provider | INL-01～09 通过；豆包内联，ZenMux 双解析，async/URL-only 无生命周期回归 |
| Migration | MIG-01～06 通过；v3 backup、事务、行数、favorite/FK/index 完整 |
| 数据模型 | DB-01～06 通过；非法半状态不可写；DTO 只给 available URL；项目封面不引用 tombstone |
| Retention | RET/CLN 全部通过；默认 7、0 禁用、取消收藏时间语义、竞态不误删 |
| API | DEL/IMG/DLD 全部通过；200/204/404/410 清晰、下载不续期、路径不泄漏 |
| UI/History | UI-01～10 通过；completed 不退化为 0/failed，墓碑文案准确 |
| 网络边界 | NET-01～04 通过；URL-only 安全路径不回退，内联不触发 CDN 下载，未过度承诺系统代理 |
| 回归 | `test:release`、build、`git diff --check` 通过；无真实 key/网络依赖 |
| 文档 | db/storage/api/library/providers/web-client/web-ui/README/.env 与实现一致 |
| Git | 分批 commit 单一目的，不混入无关工作树文件 |

真实 Provider live flow 只在用户再次授权时执行。建议最少验证豆包或 ZenMux 的一个 Base64 flow、智谱或 fal 的一个 URL-only flow；每个单模型、`count=1`，记录 generation ID/终态/本地可读性，不记录 prompt/key/签名 URL。自动化已经证明 retention 时，不需要为了验收等待 7 天或产生额外付费请求。

## 4.11 对抗性审查

| 攻击面/失效点 | 防御 | 残余风险 |
|---|---|---|
| migration 表重建丢图片/favorite | pre-backup、事务、copy count、FK/schema/integrity smoke | downgrade 需显式恢复 backup，不支持直接旧代码打开 v4 |
| cleanup 与 favorite/delete 竞态 | 条件更新、短事务、幂等 tombstone、barrier tests | 文件系统与 SQLite 非同一事务，orphan cleanup 继续补偿 |
| nullable URL 漏到 `<img src>` | strict types、DTO contract、component/browser cases | 第三方旧客户端不兼容；本地同仓发布可控 |
| 下载文件名/header 注入 | 不使用 prompt、字符 allowlist、RFC filename encoding | 浏览器最终命名仍可能调整 |
| Base64 放大/恶意 payload | JSON/decoded size、MIME/magic、staging、日志脱敏 | 峰值内存仍高于 URL path；当前单用户有界接受 |
| tombstone 被当作 Provider failure | availability 与 Job status 分离、UI regression | 新 UI 文案需保持中英文同步 |
| 外部删除收藏文件 | storage_missing 协调并移除坏 favorite | 无法恢复原字节；依赖用户导出/重新生成 |
| “系统代理”被过度承诺 | 文档明确 Node/Browser 边界，保留窄兼容 | App 宿主选型前无法提供完全一致的系统代理行为 |

红队重点不是增加更多状态，而是确认这四个不变量始终成立：历史不被 cleanup 抹掉、收藏不被竞态误删、不可用图片不生成可点击 URL、任何网络/文件错误都不泄漏敏感路径或远端签名 URL。
