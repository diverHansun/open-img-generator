# video-generation 模块

> 状态：Seedance 文生视频第一阶段已实施；真实 Ark 准入受本机未配置 `ARK_API_KEY` 阻塞（2026-07-21）。

## 本阶段已完成

- Doubao Provider 私有 ModelSpec：Seedance 1.5 Pro、2.0、2.0 Fast。
- Ark 异步任务提交、轮询、错误归一化和重启后恢复。
- generation `media_kind`、`videos` 表与 v4 → v5 安全迁移。
- 成功结果立即转存为本地 MP4，并校验响应大小与 `ftyp` 文件签名。
- 视频生成、生成详情和本地视频读取 API。
- `/workspace/[projectId]/videos` 基础页面；无 Ark 凭据时明确禁用并显示配置原因。
- 图片生成页面继续只展示图片模型，不会误选视频模型。

3000 端口浏览器检查已通过：页面可渲染、无控制台错误；当前环境没有 `ARK_API_KEY`，所以没有发起可能计费的真实 Seedance 任务，也不以 mock 冒充准入。

## 后续阶段

本目录中的收藏、7 天清理、导出和墓碑状态是完整模块目标，尚未纳入当前第一阶段实现。下一阶段应复用图片保留策略完成 `video_favorites`、清理器、下载导出与历史展示，再执行真实 Ark 端到端验收。

## 文档地图

- [goals-duty.md](./goals-duty.md)
- [use-case.md](./use-case.md)
- [architecture.md](./architecture.md)
- [dfd-interface.md](./dfd-interface.md)
- [data-model.md](./data-model.md)
- [non-functional.md](./non-functional.md)
- [test.md](./test.md)
