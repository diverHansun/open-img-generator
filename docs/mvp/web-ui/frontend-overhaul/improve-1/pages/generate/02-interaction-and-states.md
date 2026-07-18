# Generate · 交互与状态

## 初始化

并行加载 Project shell 已有信息、Sessions、Provider capabilities、Model Preferences。用 `enabled preference ∩ configured provider models` 得到可选池。恢复 `lastSession:<projectId>` 前验证归属；否则选最近有效 Session。若列表为空，调用服务端 `ensureInitialSession` 契约创建或复用 `session-<新 Session id 的前 8 位>`；浏览器不得用 list 后普通 create 的两步猜测。

## Session

- 切换 Session 清除只与当前提交相关的错误，不清除 Prompt 草稿。
- 创建成功后选中新 Session，并更新非敏感 lastSession 建议值；用户可在 Session bar 内联重命名，调用既有 PATCH。
- 自动创建失败时才禁用 Generate，并提供明确重试文案；不要求用户先回 Home。

## Model/Parameters

- 当次 model 勾选是局部状态，不改 Model Preference。
- 至少一项；未配置/全禁用时引导到 Providers/Models。
- 参数只显示/允许所选模型共同支持的交集；切换模型导致值失效时清除并提示。
- count 是 per model，文案明确。

## Submit

校验 prompt/session/targets/共同参数 → 单次 POST → 保留在页面并启动**当次提交**的结果区轮询。提交期间按钮改为 Cancel；点击后调用取消接口，但离开页面不会取消任务。失败保留所有输入和选择。UI 不逐 provider 发 POST，不把后端 fanout 串行化。

结果区通过按 generationId 去重的 poll registry 订阅当前 submission；它完成、失败、取消或页面卸载时解除订阅。用户再次提交时先解除旧结果区订阅。这个规则与 Detail 弹层是仅有的两个详情 poll 订阅入口。结果图点击打开 `ImagePreviewDialog`（单张 + 关闭）；Generate 结果区不打开 Detail 弹层。

## 状态

loading、no session、no configured provider、no enabled model、validation error、submit error 都有独立文案与动作。页面不显示假的 provider Connected。
