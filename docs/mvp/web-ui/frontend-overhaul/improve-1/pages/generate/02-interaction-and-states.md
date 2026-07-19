# Generate · 交互与状态

## 1. 初始化

并行加载 Project shell 已有信息、Sessions、Provider capabilities、Model Preferences。用 `enabled preference ∩ configured provider models` 得到可选池。恢复 `lastSession:<projectId>` 前验证归属；否则选最近有效 Session。若列表为空，调用服务端 `ensureInitialSession` 契约创建或复用 `session-<新 Session id 的前 8 位>`；浏览器不得用 list 后普通 create 的两步猜测。

无 `generation` query 时初始化为 Compose；合法 `?generation=:id` 时直接进入 Stage 并加载该 Generation。404/归属错误在 Stage 内显示可恢复错误，返回编辑仍可用。

## 2. Session

- 切换 Session 清除只与当前提交相关的错误，不清除 Prompt 草稿。
- 创建成功后选中新 Session，并更新非敏感 lastSession 建议值；用户可在紧凑工具行内联重命名，调用既有 PATCH。
- 自动创建失败时才禁用 Generate，并提供明确重试文案；不要求用户先回 Home。
- 当前任务一旦成功创建，就以它自己的 `sessionId` 为准；之后在 Compose 切换 Session 不改变旧任务归属。

## 3. Model/Parameters

- 当次 model 勾选是局部状态，不改 Model Preference。
- 至少一项；未配置/全禁用时引导到 Providers/Models。
- 参数只显示/允许所选模型共同支持的交集；切换模型导致值失效时清除并提示。
- count 是 per model，文案明确；它不进入已持久化的 Generation detail，Stage 刷新后不得依赖它显示精确总数。

## 4. Compose → Stage

1. 校验 prompt/session/targets/共同参数。
2. 发起一次 `POST /api/generations`，UI 不逐 Provider 发 POST，也不把后端 fanout 串行化。
3. 新提交使用新的 submission sequence，避免旧 POST/detail 响应覆盖；Compose 本身没有旧 Stage 订阅。
4. POST 失败时停留 Compose，并保留 Prompt/targets/params 与原 current-task 入口。
5. POST 成功后原子清空旧 id/快照，记录新 generationId，进入 Stage，并以 `?generation=:id` 表达当前打开的 Stage；旧后台任务不被取消。

Stage 是当前提交的唯一页内结果视图。它通过按 generationId 去重的 poll registry 订阅详情；终态时停止调度，但 Stage 保留最终图片和状态，直到用户返回编辑或发起下一次提交。

## 5. Stage → Compose → Stage

- 点击“返回编辑”关闭 Stage、移除 `generation` query 并解除详情订阅；这不调用 Cancel，后台 worker 可继续推进。
- Compose 保留 currentGenerationId 与最后一次可见快照，只呈现紧凑“当前任务”入口；快照不声称仍在实时更新。
- 点击“当前任务”入口重新进入 Stage，恢复 `generation` query，立即重新 GET detail，并仅在非终态时继续轮询。
- Compose 不隐藏持有 poll，不为当前 Session 查询 Recent/History，也不显示旧任务列表。
- 页面完整卸载、刷新到无 `generation` 的 Compose 或进入新 Workspace 后，内存 current task 可消失；业务记录仍由 History 找回，不写 localStorage。

## 6. Current Job 明细

Stage 将 `GenerationView.jobs` 与 `images[].jobId` 组合为当前 Job 明细：

| Job status | 展示语义 |
|---|---|
| `pending` | 等待 Provider 开始；无百分比或排队位置 |
| `running` | Provider 正在处理；显示已实际返回图片数 |
| `completed` | 已完成；显示实际图片数 |
| `failed` | 失败；显示安全的 `error.code/message` 摘要，不自动重试 |
| `cancelled` | 已取消 |

若部分 Job 完成、部分失败/取消，可在 UI 汇总为“部分完成”；这是由 jobs 派生的展示标签，不新增第六种持久化状态。Job 明细默认收起，失败不会触发布局跳动式自动展开；摘要必须让失败可见。

## 7. Cancel 与图片

- Cancel 只在 Stage 非终态时显示，调用既有取消接口；请求中禁用重复点击，最终状态以服务端响应/后续 detail 为准。
- 返回 Compose 不等于 Cancel；Compose 不放第二个取消按钮。
- 结果图点击打开 `ImagePreviewDialog`（单张 + 关闭）；Generate Stage 不打开 Generation Detail 弹层。

## 8. 状态

loading、no session、no configured provider、no enabled model、validation error、submit error、stage loading、stage 404、stage recoverable error、cancel pending 均有独立文案与动作。页面不显示假的 Provider Connected、耗时、进度百分比或请求总张数。
