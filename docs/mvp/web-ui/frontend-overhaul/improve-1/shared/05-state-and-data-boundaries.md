# 状态与数据边界

## 1. 总原则

Route 是页面/Workspace 身份真相，HTTP API 是业务状态真相，页面组件只持有短生命周期交互状态。不得用一个跨页客户端组件缓存所有数据，也不得为了减少一次请求让浏览器直接依赖服务端模块。

## 2. Server 与 Client 边界

- route/layout 只渲染不含业务数据的稳定壳；现有 `APP_AUTH_TOKEN` 仅保护 API 时，不得在 Server Component 直接读取 Project、Provider 或 credential 数据而绕过登录门。
- 表单、筛选、轮询、Load more、Switch、secret draft 是 Client Component。
- 页面可选择服务端首屏数据 + 客户端后续加载，但同一数据只保留一个 owner，避免双 fetch 后互相覆盖。
- `src/lib/web-client/` 是浏览器唯一 HTTP facade；服务端 page 若直接调用 application service，返回语义仍需与公开 DTO 一致，避免两种业务规则。

## 3. URL 状态

| 页面 | URL 状态 | 内存状态 |
|---|---|---|
| Home | 无 | create form |
| Generate | 可选 `session`；Stage 打开时可选 `generation` | prompt、targets、params、Compose/Stage、currentGenerationId 与最后快照 |
| History | `page` | 折叠状态、各组已加载 items/cursor |
| Gallery | `workspace`、`provider`（`sort` 固定 newest） | 已加载 items/cursor、预览弹层 |
| Models | 可选 `q`、`provider`；首批也可仅内存 | 展开行、saving map |
| Providers | 无 | — |
| Provider Detail | providerId path | secret draft、visible、saving |

Generation Detail 为弹层无 URL 状态；打开中即持有 poll，关闭即清理。

能影响"分享/刷新后看到什么集合"的分页/过滤写入 URL；纯表单草稿不写 URL。

## 4. localStorage 边界

只允许保存非敏感偏好：`lastSession:<projectId>` 与 `locale`（界面语言）。读取 `lastSession` 后必须验证 Session 仍属于 Project；无效就清除。不得保存 prompt 草稿（本批未确认）、API key、credential source、generation 状态或 active page。

## 5. 请求与竞态

1. filter/page/route 改变时取消旧请求或用 sequence token 丢弃旧结果。
2. Load more 同一 cursor 同时只允许一个请求；重复点击被禁用。
3. Switch 每行串行保存；失败回滚到最后确认值。
4. Favorite 可 optimistic，但失败必须恢复。
5. Provider credential 保存禁止 optimistic"Configured"；只在服务端成功摘要返回后更新，随后 toast 提示并重取摘要。空输入 + Save 在已配置时映射为 DELETE；未配置时不发请求、就地提示。
6. Project/Session 创建按钮防双击；重复提交结果由 API 真实响应决定。
7. 列表自动重取（进入页面 / 标签页重新可见）同样走 AbortController，与手动操作（翻页、Load more）的请求互不覆盖。

## 6. Poll 所有权

后端铁律不变：只有 `GET /api/generations/:id` 推进 poll，列表接口永不调用。前端有两个订阅入口，任一订阅卸载即停止接收更新：

```text
Generate Stage（唯一 current task）
  submit 成功 / 点击 Compose current-task 入口 → Stage 可见
  → GET detail → terminal? stop
  → non-terminal? schedule next GET
  → 返回 Compose / 离开 Generate / 发起新提交? 停止旧 controller

GenerationDetailDialog（History 行 / Gallery 预览进入）
  open → GET detail
  → terminal? stop
  → non-terminal? schedule next GET
  → close / 不可重试错误? stop
```

浏览器 `GenerationPollRegistry` 按 `generationId` 维护唯一调度器与订阅计数：两个入口可同时跟踪不同 generation；若因 Gallery/Generate 重叠订阅同一 generation，则共享一次 detail GET 调度，最后一个订阅者卸载才清理 timer/fetch。它是短生命周期调度器，不缓存跨页业务数据，也不取代页面状态。Generate Compose 的 `CurrentTaskEntry` 只保存最后快照并可重新打开 Stage，不能作为隐藏订阅者；History、Gallery、recent lists只显示存储快照。后台 worker 可独立推进，这不改变前端规则。不得通过预取意外触发推进：列表渲染不预取详情 GET，弹层内容只在用户显式打开后加载。

## 7. 缓存和刷新

- Project/Provider catalog/Model Preferences 可在页面生命周期内缓存；写入后显式 revalidate/refetch。
- Generation detail 非终态使用 no-store/动态读取，避免缓存旧状态。
- History/Gallery/Models/Providers 无手动 Refresh 按钮：进入页面（挂载/路由进入）自动重取，浏览器标签页重新可见（`visibilitychange`）时自动重取；不做 `setInterval` 定时轮询。
- 自动重取必须携带当前 filter/page 状态，失败保留已展示内容并给轻量错误提示。
- Provider configuration 响应不得进入持久浏览器缓存；使用 no-store 和安全 headers。

## 8. 错误模型

web-client 的错误统一为 `{ code, message, retryable }`，但页面不依赖内部 stack 或自由文本。统一处理 401、404、409、422/400、503；secret 错误只说明配置缺失/不可写，不回显输入。

## 9. 数据所有权表

| 数据 | 创建/更新 owner | UI 能力 |
|---|---|---|
| Project/Session | library/API | Home/Generate 创建，壳读取 |
| Generation/Job | job-engine/API | Generate 提交、Detail 读/取消 |
| Favorite | library/API | Detail/Gallery 增删 |
| Model Preference | library/API | Models 更新 |
| Provider capability/catalog | providers/provider-config | 只读展示 |
| Credential secret | env 或 user-config | Detail 只提交新值，永不读取明文 |
| 页面过滤/展开 | 浏览器 route/page | 不持久化业务库 |

## 10. 验收

刷新深链可恢复；返回/前进同步过滤；旧响应不覆盖新筛选/新 current task；列表与 Compose 无详情 poll（仅可见 Stage/Detail 弹层持有）；无手动 Refresh 按钮与定时轮询；secret 不进入 URL/localStorage/cache；写操作失败后 UI 回到服务端确认状态；`locale` 切换即时生效并持久化。
