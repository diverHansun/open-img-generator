# 4. 测试与验收标准

## 4.1 测试范围

- Unit：Qwen ModelSpec、请求体、响应解析、旧模型前置拒绝、错误映射。
- Contract：`/api/providers` 仍只返回公开 capabilities 字段，新增模型可被目录消费。
- Integration：Qwen/Wan standard sync 经过 route、job-engine、MSW、SQLite 和 storage；Wan Pro async 回归保持通过。
- Smoke：TypeScript 编译、Next production build、现有 smoke 测试。
- WebUI live：用户已授权时，真实选择 Qwen 新模型执行一次 count=1 文生图，验证本地持久化与页面可见结果；不进入 CI。

## 4.2 关键场景

| ID | 场景 | 类型 | 验证点 | 对应 Phase |
|----|------|------|--------|------------|
| Q01 | `qwen-image-plus` 不再支持 | unit/registry | capabilities 不含 plus；submit 返回 `INVALID_REQUEST/not_started`；fetch 未调用 | 1/2 |
| Q02 | Qwen 3.0 Pro sync | unit | model ID、multimodal endpoint、text content、n/size/seed/negative_prompt、choices parser | 1/2 |
| Q03 | Qwen 3.0 标准版 sync | unit/contract | 与 Pro 使用同一安全方言但独立 model ID，可被 provider catalog 投影 | 1/2 |
| Q04 | Qwen 2.0 Pro 2026-06-22 | unit | 快照 model ID 不被拒绝，body 与 Qwen sync profile 一致 | 1/2 |
| Q05 | Wan 2.7 标准版 sync | unit | multimodal endpoint；不带 async header；`enable_sequential=false`、`thinking_mode=true`；不发送 negative_prompt | 1/2 |
| Q06 | Wan 标准版完整 lifecycle | integration | route → durable job → sync submit → MSW URL → storage → completed/image | 2 |
| Q07 | Wan Pro async 回归 | unit/integration | 仍使用 async endpoint、task poll、`thinking_mode=false` 既有语义 | 2 |
| Q08 | Qwen sync timeout/401/429 | unit | 180s timeout、`unknown` disposition、AUTH_FAILED、可重试 RATE_LIMITED | 2 |
| Q09 | providers API | contract | 新模型公开 capabilities；不暴露 profile/path/内部字段 | 2 |
| Q10 | WebUI 新模型 live | manual/browser | 模型显示、选择、提交、状态推进、图片展示、刷新后历史可读 | 3 |

## 4.3 TDD 执行顺序

1. 先修改/新增测试，使 `qwen-image-plus` 删除、新模型存在和 Wan standard sync 测试按预期失败。
2. 运行目标测试，确认失败原因是缺失 ModelSpec/profile，而不是测试拼写或环境错误。
3. 实现最小 capabilities/profile/adapter 改动并运行目标测试至通过。
4. 再补 integration/contract 文档联动，运行分层测试。

## 4.4 集成边界

- Provider unit 使用 typed fetch stub，不访问真实 DashScope。
- Integration 使用项目 MSW 规则拦截 DashScope 和图片 CDN，不能直接访问真实外部网络。
- WebUI live 是显式人工验收，使用真实已配置 API Key；每次只选择一个模型、count=1，记录 generation ID、终态和页面结果，不记录 key、完整响应或签名 URL。
- WebUI 验收后必须检查本地图片 API/历史加载，不能只确认厂商返回 URL。

## 4.5 回归清单

- `qwen-image-2.0-pro` sync unit/integration。
- `wan2.7-image-pro` async submit/poll/storage integration。
- provider registry 启用顺序和 Qwen catalog。
- generation validator 对新增模型的 text-to-image 校验。
- media URL allowlist 对 DashScope OSS 结果的现有安全策略。
- Models 页面和 Generate 页面对新增 capabilities 的默认启用行为。

## 4.6 发布门

| 项 | 标准 | 如何验证 |
|----|------|----------|
| 旧协议删除 | 代码和当前文档不再把 `qwen-image-plus` 当作可用模型；legacy builder 不存在 | `rg` + unit/registry |
| 新模型目录 | 四个新增 model ID 可被 registry/provider catalog 读取 | Qwen unit、registry、contract |
| 协议正确 | Qwen 3/Qwen 2 sync 与 Wan standard sync 请求字段与官方资料一致 | adapter unit + MSW integration |
| 兼容回归 | 现有 Qwen 2.0 Pro 与 Wan Pro 通过 | targeted unit/integration |
| 编译 | `npm run typecheck` 与 `npm run build` exit 0 | 命令输出 |
| 测试 | `npm run test:release` 或明确记录环境阻塞 | 命令输出 |
| WebUI | 真实生成完成、图片显示、刷新后仍可读 | 受控浏览器验收记录 |
| 审查 | 子代理未发现 Critical/Important 未处理问题 | diff review 结果 |

## 4.7 对抗性审查要点

| 攻击面 | 防御 | 残余风险 |
|--------|------|----------|
| 旧 model 字符串绕过目录 | adapter 按 ModelSpec 前置拒绝；无网络副作用 | 历史旧任务无法继续 dispatch，已记录为有意兼容性变更 |
| Qwen sync 与 Wan sync 字段串线 | 独立 discriminated profile + exact body 断言 | 官方字段变化需要重新核对 |
| 新模型误宣称图生图 | capabilities 只声明 text-to-image；WebUI 不提供参考图 | 后续 I2I 批次仍需跨 UI/adapter 设计 |
| sync timeout 重试造成重复计费 | 复用 `unknown` disposition 和 job-engine 终态收口 | 真实网络断开仍需人工确认上游状态 |
| 临时 URL 未落盘 | integration 和 WebUI 都检查 storage/历史读取 | CDN 代理映射仍可能导致安全拒绝 |
