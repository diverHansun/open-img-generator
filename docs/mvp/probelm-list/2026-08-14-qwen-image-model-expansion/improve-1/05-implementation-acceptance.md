# 实施验收记录

> 验收日期：2026-08-14
> 范围：Qwen Image 3.0 / Qwen Image 2.0 Pro snapshot / Wan 2.7 标准版首批接入

## 实施结果

- 已从当前 ModelSpec、adapter、registry 断言和当前产品文档移除 qwen-image-plus。
- 已删除 legacy text2image/image-synthesis 请求体、响应解析和 async fallback。
- 已新增：
  - qwen-image-3.0-pro
  - qwen-image-3.0
  - qwen-image-2.0-pro-2026-06-22
  - wan2.7-image
- 已保留 qwen-image-2.0-pro 的 Qwen sync 和 wan2.7-image-pro 的 Wan async task/poll。
- 新增模型的公开 capabilities 均只有 text-to-image；未改动图生图 UI、参考图输入或数据库 schema。
- Wan 标准版使用独立 sync profile，发送 enable_sequential=false、thinking_mode=true，不发送 Qwen 专属 negative_prompt。

## 文档审查

先完成 Improve 1 的 00–04 文档，并核对问题基线、方案、改动面、TDD 顺序、测试场景和 release gate。实施后补充本文件，且同步修正 provider 架构、数据流、测试和 quickstart 中的当前支持矩阵。

## 自动化验证

| 检查 | 结果 |
|------|------|
| npm run typecheck | 通过 |
| npm run test:fast | 通过：unit 78 files / 551 tests；contract 7 files / 50 tests |
| npm run test:integration | 通过：8 files / 23 tests；包含 Wan 标准版 route → job → storage 生命周期与 Wan Pro async 回归 |
| npm run build | 通过：Next.js production build 完成 |
| git diff --check | 通过 |

## WebUI E2E

在本地 WebUI 中打开已有 workspace，确认模型列表包含四个新增模型且不包含 Plus。选择 qwen-image-3.0-pro、数量 1，提交低风险纯文本 prompt：

> 一只戴红围巾的橘猫，白色背景，简洁插画风格

页面从“进行中”推进到“已完成”，显示 1 张图片；随后进入历史页，记录显示 provider 为 qwen、model 为 qwen-image-3.0-pro、状态为“已完成”，缩略图可读。未记录 API key 或完整签名 URL。

## 子代理审查

子代理初审无 Critical，提出三项 Important：

1. 补齐 sync/async 数据模型矩阵与 DFD sync 流程；
2. 为 qwen-image-3.0 和 qwen-image-2.0-pro-2026-06-22 增加实际 adapter 请求覆盖；
3. 补充本实施验收记录。

以上三项已处理：当前文档已明确 Qwen/Wan 标准 sync 与 Wan Pro async 边界，单测已参数化覆盖两个 model ID，本文件已补齐实际验收证据。子代理复核最终 diff：无新的 Critical/Important，结论为 Ready to merge。

## Release 检查备注

npm run test:release 的 version check、typecheck、unit、contract、integration 阶段通过；smoke 阶段在当前 Node v26 / 本机临时目录环境中被 EPERM: chmod /var/folders/.../T 阻塞。该失败发生在运行时路径预检，未指向本次代码改动；需要在允许临时目录权限或项目支持的 Node 20/22/24 环境重跑 smoke 后再作为完整 release gate。
