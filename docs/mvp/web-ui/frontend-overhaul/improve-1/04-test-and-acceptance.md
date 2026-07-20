# 4. 测试与验收标准

> 遵循项目级 `docs/test-blueprint.md`。测试围绕职责、数据流和泄密风险，不以覆盖率数字为目标。

## 4.1 测试范围与分层

| 层级 | 覆盖内容 | 位置/方式 | 不覆盖 |
|---|---|---|---|
| unit | 查询参数解析、DTO 映射、History 分页、Provider catalog、credential merge/remove、纯 UI 状态函数 | co-located `*.unit.test.ts` | 真实厂商网络 |
| contract | 新/调整 API 的输入、状态码、响应 shape、只读语义和 secret allowlist | `tests/contract/` | 页面视觉 |
| integration | 临时 SQLite 下 summary/history/gallery；临时 user-config 下写入、并发、权限、env 优先 | `tests/integration/` | 真实 Provider key 和调用 |
| smoke | build、路由启动、migration/health | `tests/smoke/` 和 `npm run build` | 完整交互回归 |
| 浏览器人工 QA | 路由、响应式、键盘、焦点、视觉层级、真实交互主路径 | 本地 `npm run dev` | 逐像素截图断言 |

未安装 Playwright/React Testing Library 前，不为文档要求强行引入工具。若实施中决定增加浏览器自动化，先把它作为独立依赖决策，不降低本节的 contract/integration 要求。

## 4.2 自动化关键场景

### A. 路由与壳（视觉确认后的 Phase 3）

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| A01 | 打开 `/` | smoke/人工 | 只出现顶部品牌条与 Workspace Home，不出现完整侧栏 |
| A02 | 打开合法 workspace 子路由并刷新 | smoke/人工 | 完整侧栏存在，Project title 正确，页面不退回 `/` |
| A03 | 非法 projectId | contract/人工 | 404/明确错误，不渲染其他 Project |
| A04 | Workspace 侧栏导航 | 人工 | 无 Home/Settings；`← Workspaces` 返回 `/`；无明暗主题开关 |
| A05 | 非 Generate 页面 | 人工 | 不保留 360px 空 inspector，不出现 Workspace 选择卡 |
| A06 | 语言切换 | unit/人工 | 两种壳均可切换中/英文，刷新后保持；界面无硬编码文案残留抽查 |
| A07 | `/generations/:id` 旧规划路由 | smoke | 该路由不存在（Detail 为弹层），访问走 not-found |

### B. Backend Contract：查询与初始 Session（Phase 1）

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| B01 | Project summaries 有/无图片 | integration | count、lastActivity、cover null/URL 正确，排序稳定 |
| B02 | History 混有空 Session | integration | 只返回有 Generation 的 Session |
| B03 | History 超过 5 个 Session | contract/integration | 每页 5、totalPages 正确、页码稳定 tie-break |
| B04 | 单 Session 超过 10 条 | integration | 首批 10 条、nextCursor 正确，加载更多无重/漏 |
| B05 | 请求 History/Generation list | integration | 不调用 provider poll，不改变 job 状态/nextPollAt |
| B06 | Gallery project/provider 过滤 | integration | 过滤发生在分页前，跨 cursor 全量正确 |
| B07 | Gallery filter 改变后使用旧 cursor | contract/client unit | 客户端重置 cursor；服务端不返回混合结果 |
| B08 | 非法 page/limit/filter | contract | 400/404 与统一错误结构 |
| B09 | 首个 Session 并发建立 | unit/contract/integration | 双请求或重试只得到同一个默认 Session；普通 create 仍可明确建立额外 Session |

### C. Frontend API Wiring 与创作主路径（Phase 2 / 视觉确认后的 Phase 3）

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| C01 | 创建 Workspace | contract/人工 | 创建后进入其 Generate 路由 |
| C02 | 无 Session 的 Workspace | integration/人工 | 自动创建首个 Session（name = `session-` + id 前 8 位）并选中；期间 Generate 暂不可用且状态可读 |
| C03 | 创建/选择/改名 Session | contract/人工 | 仅影响当前 Workspace；改名复用 `PATCH /api/sessions/:id`；刷新可恢复有效建议值 |
| C04 | 多模型提交 | integration/人工 | request 带 sessionId/targets；后端 fanout 未被 UI 串行化 |
| C05 | 提交后 | unit/人工 | 同一路由从 Compose 进入 Stage；Stage 隐藏 Inspector，只展示当前 Generation 图片/Job 明细与非终态 Cancel |
| C06 | 非终态轮询 | unit/integration | 可见 Stage（唯一 current task）与 Detail 弹层（打开期间）是仅有订阅入口；同一 generationId 只有一个 detail GET 调度器；终态停止；错误退避遵循既有 polling 规则 |
| C07 | 返回 Compose / 离开 Generate / 关闭弹层 | unit/人工 | 浏览器 timer/fetch 清理；后台任务不被隐式 cancel；Compose current-task 入口不持有隐藏轮询 |
| C08 | Detail 弹层打开不存在的 generation | contract/人工 | 弹层内联“记录不存在或已删除”状态，不泄漏其他 Workspace 内容 |
| C09 | Cancel | contract/integration/人工 | Generate Stage 与 Detail 弹层两处入口均使用既有 cancel endpoint；Compose 无 Cancel；同一时刻每个 Generation 只呈现一个可见取消入口；状态可见且幂等语义不退化 |
| C10 | Favorite | contract/人工 | Stage/弹层图片可收藏/取消，Gallery 能读取 |
| C11 | 图片预览 | 人工 | 点击图片打开预览弹层（单图 + 信息卡）；从预览进 Detail 先关预览；任何时刻只开一个弹层 |
| C12 | 当前任务恢复与替换 | unit/人工 | 合法 `?generation=` 刷新恢复 Stage；返回 Compose 后点击 current-task 入口恢复 Stage/poll；新 POST 成功后原子替换旧 id/快照/订阅，失败保留旧入口，只展示一个当前 Generation；非法/跨 Project id 可返回编辑 |
| C13 | Job 明细字段白名单 | contract/人工 | 只展示当前 jobs 的 Provider/model/五态、实际图片数、安全错误；无 Session 历史、expected total、duration、queue 或虚假百分比 |

### D. History 与 Gallery（视觉确认后的 Phase 4）

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| D01 | History 6 个非空 Session | 人工 | 2 页；第一页 5、第二页 1 |
| D02 | 展开/收起 Session | 人工 | 键盘可操作；默认最新一组展开、其余收起；状态不触发详情 GET |
| D03 | 组内 Load more | unit/人工 | 追加而非替换，不重复，按钮终点消失 |
| D04 | History 行进入 Detail 弹层 | 人工 | 整行可点；只有打开弹层后详情 GET 才开始推进 poll |
| D05 | 全局 Gallery | integration/人工 | 可同时看到多个 Workspace 项；图片无常驻标签，来源见预览信息卡 |
| D06 | Gallery Workspace/Provider 过滤 | contract/人工 | 顶部筛选条与 URL/请求同步、清空加载游标、结果正确 |
| D07 | Gallery Load more | unit/人工 | 保留顺序，无重复，终点/错误可恢复 |
| D08 | 取消收藏 | integration/人工 | 当前项移除且其他过滤状态保留；失败回滚 |
| D09 | 空/加载/错误 | 人工 | 每种状态有明确文案和可恢复动作，不闪烁假数据 |
| D10 | 自动刷新 | 人工 | 无手动 Refresh 按钮；进入页面与标签页重新可见时自动重取；无定时轮询 |
| D11 | History 行批次缩略图 | 人工 | 行内展示该批次缩略图条，超出显示 `+N`；点击进入 Detail 弹层 |

### E. Provider Contract 与 Models/Provider UI（Phase 1 / 视觉确认后的 Phase 5）

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| E01 | Provider catalog | contract | 固定七家、顺序稳定、Kling credentialName 正确、各家申请 key 链接存在且为 https |
| E02 | 无任何 key | contract/人工 | 七家仍显示，全部 Not configured；无 Add provider |
| E03 | env key | integration/人工 | source=env、configured=true、editable=false，详情无表单只有说明 |
| E04 | user-config key | integration/人工 | source=user-config、editable=true，不返回 secret |
| E05 | 保存新 key | contract/integration | 仅固定 provider 对应 key 写入，加密文件权限保持 0600 |
| E06 | 替换 key | integration | 新值用于解析；响应/日志无旧值和新值 |
| E07 | 清除 key | integration/人工 | 清空输入后 Save 触发 DELETE；只删除目标 key，其他 Provider key 保留 |
| E08 | 并发保存两个 Provider | integration | 两个 key 都保留，无 lost update |
| E09 | env 来源保存/删除 | contract | 409 `CREDENTIAL_MANAGED_BY_ENV` |
| E10 | 缺 encryption key/损坏文件 | integration | 可行动错误，不泄漏输入；不破坏旧文件 |
| E11 | 小眼睛 | 人工 | 只显示当前 draft；保存后输入与可见状态复位 |
| E12 | Model Switch | contract/人工 | 持久化成功才确认；失败回滚并显示行级错误 |
| E13 | 保存/清除成功反馈 | 人工 | 成功出现 toast 且摘要自动重取；错误就地展示不走 toast |
| E14 | 未配置空输入 Save | 人工 | 不发请求，就地提示“请输入 API key” |
| E15 | Models 未配置提示 | 人工 | 存在未配置 Provider 时页头显示“去配置 →”链接 |
| E16 | 错误 DTO | contract/client unit | 新增/修改 API 的失败响应含稳定 `code/message/retryable`；secret 永不进入 error body |

### F. 清理与发布（Phase 6）

| ID | 场景 | 类型 | 验证点 |
|---|---|---|---|
| F01 | 搜索旧 view state | 静态检查 | 无页面导航用 `activeView` |
| F02 | 搜索重复 Workspace 控件 | 静态/人工 | 仅 Home 选 Project；Generate 只选 Session |
| F03 | secret canary 扫描 | integration | API JSON、console capture、error snapshot 不含 canary |
| F04 | typecheck | 命令 | `npm run typecheck` 通过 |
| F05 | unit/contract/integration | 命令 | 相应 suite 全部通过 |
| F06 | production build | 命令 | `npm run build` 通过 |
| F07 | 权威文档 | review | API/web-ui/user-config/library/web-client 已同步实际实现 |
| F08 | 视觉矩阵 | 人工 | 1440、1024、390 宽度关键页无溢出和空列 |
| F09 | i18n 字典完整性 | unit | zh-CN 与 en 字典 key 集合一致；无互相缺失 |
| F10 | 主题残留 | 静态/人工 | 无明暗切换入口与相关状态 |
| F11 | 视觉语言 | 静态/人工 | 无任何装饰渐变/gradient shimmer、蓝紫或多色 AI glow、emoji UI、全 pill 按钮、卡片堆叠；每个可视区域最多一个实心 accent 主动作 |
| F12 | CSS 分层 | 静态/人工 | `globals.css` 仅保留 tokens/reset/Tailwind 入口；页面私有布局位于对应 CSS Module；无旧卡片阴影体系 |
| F13 | 字体资源 | build/人工 | 不含 HarmonyOS Sans SC；中文字体本地交付、许可明确、只加载实际使用字重；中英文切换无明显布局跳动 |
| F14 | Glass fallback | 静态/人工 | 禁用/不支持 `backdrop-filter` 时文字、边界和操作仍清楚；halo 不替代 focus ring、状态文本或边界 |
| F15 | Reduced motion | 人工 | `prefers-reduced-motion` 下关闭非必要位移/缩放；loading 无 gradient shimmer，仅静态或低幅 opacity pulse |

## 4.3 Provider 配置安全验证

测试使用唯一 canary，例如 `secret-e2e-canary-<uuid>`：

1. 写入前拦截 server console 和 API response body。
2. 执行 PUT、GET summary、DELETE、错误路径。
3. 断言 canary 只存在于临时加密文件解密后的目标字段，不出现在响应、错误 message、console、snapshot 或 URL。
4. 用临时 `USER_CONFIG_DIR` 和 `USER_CONFIG_ENCRYPTION_KEY`，测试结束清理目录。
5. env 优先测试不得把真实 `.env` 或开发者 key 注入测试快照。
6. contract 测试以 allowlist 检查 ProviderConfiguration keys，防止未来 `...credentials` 展开泄密。

## 4.4 集成边界

| 边界 | 真实部分 | 替换部分 | 重点 |
|---|---|---|---|
| API ↔ library/db | route、Drizzle、临时 SQLite | 无 | 分页、过滤、404、只读 |
| API ↔ provider-config ↔ user-config | route、service、真实临时文件加密 | 环境使用测试值 | env 优先、并发、无 secret |
| UI client ↔ API | typed client + fake fetch/contract handler | Provider 外部 HTTP | query 编码、错误、DTO |
| Generate Stage / Detail 弹层 ↔ job-engine | 真实编排 + fake adapter/MSW | 厂商 HTTP | 两个明确 poll 持有方、Compose/back/终态/关闭停止 |
| Provider adapter | 既有 adapter tests | MSW | 本批不重复验证各厂商协议 |

任何 unit/integration 不调用真实 fal/ZenMux/其他厂商。真实 key 验证仍是显式 opt-in 手工检查，不作为 CI 发布门。

## 4.5 浏览器人工验收矩阵

每个页面至少检查：正常、空、loading、error、长文本、键盘、窄屏。重点组合：

- 1440×900：桌面完整侧栏；Generate Compose inspector；Stage 隐藏 inspector 后图片使用完整主宽。
- 1024×768：压缩侧栏/内容；Compose Inspector 收纳；Stage/History 不遮挡主动作。
- 390×844：顶部壳/抽屉；触控目标；Gallery 两列/一列；密钥输入不溢出。
- 键盘：从返回入口到主内容、列表行、展开、Switch、密钥小眼睛、保存、预览/详情弹层均可达；焦点可见。
- `prefers-reduced-motion`：无强制位移动画。
- 200% zoom：不丢按钮、状态和错误信息。
- 视觉抽查：颜色角色清晰且数量克制；画布柔和微冷、accent 属青瓷/茉莉绿；无任何渐变/shimmer、蓝紫或多色 glow；目录页为 flat rows，Gallery 图片优先；图标来自统一线性图标集而非 emoji。
- Glass/halo 抽查：只出现在 Prompt focus、活动任务、Dialog 或图片浮动工具；禁用 `backdrop-filter` 后仍可读，且不会削弱键盘焦点。

## 4.6 回归清单

改造不得破坏：

1. 多 Provider fanout 与同步/异步 adapter 行为。
2. POST generation 必带 Session。
3. 只有详情 GET 推进 poll；列表保持只读。
4. 后台 worker、取消、限流、认证和图片清理。
5. Favorite 回溯 generation/session/project。
6. Model Preference 默认策略和增量 upsert。
7. env > user-config 的凭证解析优先级。
8. user-config AES-256-GCM+scrypt、0700/0600 和原子写。
9. Kling 独立 `KLING_API_KEY`，不复用 DashScope。
10. 现有 API 错误和 APP_AUTH_TOKEN 认证边界。

## 4.7 发布门

必须同时满足：

```bash
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:integration
npm run build
```

并完成人工浏览器矩阵、canary secret 扫描、旧 `activeView`/重复 Workspace/死 CSS 静态检查。任何高优先级泄密、错误 poll、跨 Workspace 归属、分页重复/遗漏、env 可覆盖问题都阻断发布；纯视觉微调可记录为后续但不得影响可用性与可访问性。

## 4.8 对抗性审查

| 攻击面 | 防御验证 | 残余风险 |
|---|---|---|
| 恶意 providerId/credential name | 固定 catalog 映射，route 拒绝未知 ID | 新增 Provider 时需同步 catalog/test |
| secret 进入日志/响应 | allowlist DTO + canary 全链路扫描 | 本机调试器可见当前输入，属于用户设备信任边界 |
| 并发 key 写丢失 | 并发 integration + 串行 merge-write | 多 Node 进程写同文件后置 |
| History 无意推进外部任务 | fake poll spy + DB 状态前后断言 | 后台 worker 独立推进属于预期 |
| cursor 与 filter/新数据竞争 | 稳定 tie-break、filter reset、无重漏断言 | 实时插入导致外层页移动，产品接受 |
| 伪造健康/进度 | DTO/UI 字段白名单和视觉 review | 实际可用性只可由真实生成证明 |

## 4.9 2026-07-20 当前验证记录

本节记录当前会话中已经得到的实际结果，并保留 §4.7 发布门的范围边界；真实 Provider 外部 HTTP 与逐像素断言不在本轮验证范围内。

| 检查 | 当前结果 | 说明 |
|---|---|---|
| `pnpm typecheck` | **通过** | 当前真实 TSX、typed client、i18n 与 API DTO 可完成 TypeScript 检查 |
| `pnpm test:unit` | **通过：45 files / 217 tests** | 包含页面纯状态、i18n、web-client、单例 poll registry、Generation 快照单调仲裁、查询、Provider 配置与可访问文本截断覆盖 |
| `pnpm test:contract` | **通过：7 files / 35 tests** | API shape、错误语义、secret-free DTO、env 冲突与生成 fanout 上限均通过 |
| `pnpm test:integration` | **通过：5 files / 11 tests** | 临时 SQLite、原子 user-config、并发写入、加密文件与 API/console secret canary 均通过；未调用真实 Provider 外部 HTTP |
| `pnpm test:verify` | **通过** | 顺序执行 typecheck、unit、contract、integration 的完整本地发布门 |
| `pnpm build` | **通过** | Next.js 15.5.20 production build 成功 |
| 浏览器人工 QA | **通过（本轮范围）** | 1440/1024/919/620/390px；中英文；Home、Generate Compose/Stage、Provider 目录/详情、History、Gallery、Models；Gallery 标题右侧筛选在各断点无横向溢出；移动导航；Preview → Generation Detail 互斥切换与焦点转移；模型开关写入/恢复；空凭证校验；干净导航后无新增 warning/error |
| motion / glass 静态检查 | **通过** | 动效均有 `prefers-reduced-motion` 收敛；glass 有实色 token 或 `@supports not (backdrop-filter)` fallback；未做脆弱的逐像素或浏览器特性模拟断言 |

当前发布门已完成。运行环境使用 Node 26.3.1 时 pnpm 会提示项目声明仅支持 Node 20/22/24；验证本身全部通过，但正式开发与 CI 应使用 Node 24 或 22 以消除 engine warning。
