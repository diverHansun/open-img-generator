# video-generation 模块 · test

## 完整模块测试蓝图

- Unit：Seedance body、handle、状态映射、错误码、MP4 signature/大小/路径、retention。
- Contract：视频提交/详情/读取 DTO；图片 API 不变。
- Integration：临时 SQLite/storage + fake Ark，覆盖 submit、重启式 poll、store、cancel、失败、过期和收藏竞争。
- Smoke：v4→新版本迁移、fresh DB、build。

## 真实验收

使用真实 3000 服务和持久化 `ARK_API_KEY`，先测 1.5 Pro，再探测 2.0/2.0 Fast。每次只生成一个最低成本短视频，验证 generation/job 终态、本地 MP4、重载、收藏与下载。没有有效 Ark 凭据时，真实 Seedance E2E 是明确的外部阻塞，不能由 mock 替代。

## 第一阶段执行状态（2026-07-21）

- 已通过 adapter/lifecycle/storage/DTO 单元测试、contract、integration、smoke 与完整 build。
- 已在真实 3000 服务用浏览器检查视频页，页面无控制台错误，并正确暴露 `ARK_API_KEY` 未配置状态。
- 当前环境没有 Ark 凭据，因此真实 Seedance 生成、转存与重载验收保持“外部阻塞”，不标记通过。
- retention、收藏与导出属于下一阶段，实现后再执行对应自动化与真实验收。
