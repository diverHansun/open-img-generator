# 4. 测试与验收标准

> 遵循 `docs/test-blueprint.md`；真实 Provider 调用为用户已授权的本地验收，不进入 CI。

## 4.1 关键场景

| ID | 场景 | 类型 | 验证点 | Phase |
| --- | --- | --- | --- | --- |
| F01 | FLUX profile 回归 | unit/live | 仍发送 `image_size`，Queue 生成成功 | 1 |
| F02 | Nano Banana 2 | unit/integration/live | 发送 `aspect_ratio/resolution`，不发送 `image_size` | 1 |
| F03 | Nano Banana Pro | unit/integration/live | profile、Queue handle、结果转存正确 | 1 |
| F04 | Fal profile/model 不匹配 | unit | 前置 `INVALID_REQUEST`，无 fetch | 1 |
| Q01 | Qwen legacy async 回归 | unit/integration | qwen-image-plus submit/poll 不退化 | 2 |
| Q02 | Qwen Image 2.0 Pro sync | unit/integration/live | multimodal body、180s budget、结果落盘 | 2 |
| Q03 | sync timeout | unit/integration | disposition=`unknown`，不自动重投 | 2 |
| W01 | Wan 2.7 async submit | unit/integration | 受信 base、bounded task id、handle 持久化 | 3 |
| W02 | Wan 2.7 poll | integration/live | pending/running/completed 与图片转存 | 3 |
| W03 | 地区/密钥不匹配 | unit/live | AUTH/endpoint diagnostic 安全可见，不回显 key/URL | 3 |
| X01 | 编辑/组图参数注入 | unit/contract | 非 allowlist providerOptions 不能开启排除能力 | 1–3 |

## 4.2 集成边界

- Unit 用 typed fetch stub；验证 URL、headers、body 和 parser。
- Integration 用 MSW + 临时 SQLite/storage；不得访问真实网络。
- Contract 验证新增模型公开 capabilities 中只有既有字段。
- Live 使用真实 3000 服务、真实用户配置和真实 storage，每次只选一个 Provider/model。

## 4.3 真实模型验收矩阵

| 模型 | 最小调用 | 必须验证 |
| --- | --- | --- |
| Nano Banana 2 | count=1、1K、1:1 | async 终态、URL 转存、本地 API |
| Nano Banana Pro | count=1、1K、1:1 | 同上，且 body 无 FLUX 字段 |
| Qwen Image 2.0 Pro | count=1、最低稳定尺寸 | sync 终态、超时边界、图片落盘 |
| Wan 2.7 Image Pro | count=1、最低稳定尺寸 | durable async poll、24h URL 立即转存 |

每项记录 generation ID、provider/model、终态、image ID/storage path/字节数；不记录 key、完整 provider 响应、签名 URL 或用户敏感 prompt。

## 4.4 发布门

1. `npm run test:release` 全通过。
2. 四个新模型逐项真实生成成功；若因地区/账户能力不可用，模型不得进入正式 capabilities，不能以 mocked 测试替代。
3. Fal Schnell、ZenMux GPT Image 2、Zhipu GLM-Image、Qwen Image Plus 至少完成相关自动回归；按风险选择真实回归，不要求无意义地重复付费调用全部旧模型。
4. 新图片由 `/api/images/:id` 返回，重载/重启不依赖厂商 URL。
5. 3000 健康检查、模型页、生成页、历史页和图库无回归。

## 4.5 对抗性审查

| 攻击面 | 防御 | 残余风险 |
| --- | --- | --- |
| Fal profile 发送混合字段 | 字段互斥单测 + exact body 断言 | 官方 schema 后续变化 |
| Qwen sync/async 解析串线 | discriminated profile + 分离 parser fixtures | 厂商返回未文档化形态 |
| 区域端点错误 | 显式 base 配置与 diagnostic | 用户 key 迁移地区需手工更新 |
| 付费测试扇出 | 单 provider/model/count=1 串行 | 每个成功请求仍产生费用 |
| providerOptions 开启范围外能力 | per-profile allowlist | 新官方字段需发布代码才能使用 |
| 结果 URL 过期 | 完成态同事务阶段立即转存并验证本地文件 | CDN 瞬态故障仍可能导致安全失败 |
