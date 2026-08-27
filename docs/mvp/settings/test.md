# settings 模块 · test

## 1. Test Scope

遵循 [`docs/test-blueprint.md`](../../test-blueprint.md)：为配置和导出快照写同目录单元测试，为设置 API 写 contract 测试；不做浏览器 E2E 或真实 Provider 调用。

## 2. Critical Scenarios

- 缺失设置默认永不自动清理；有效天数与“永不”都能持久化；无效值不能覆盖原值。
- 收藏图片不因保留期清理；降低期限后既有未收藏图片成为候选。
- 数据汇总不返回本机路径。
- 导出仅包含完成 Generation，按 Project / Session 组织，忽略缺失图片，不含凭据。

## 3. Integration Points

验证设置 API 与临时用户目录协作；验证导出服务与临时 SQLite、storage 目录协作。所有临时环境变量和目录必须在测试后恢复。

## 4. Verification Strategy

配置与文件名规范化使用单元测试。路由直接执行 handler 验证 DTO 与下载响应。导出归档至少验证 ZIP 签名、`history.json` 与媒体条目；构建验证覆盖 App Router 新路由。
