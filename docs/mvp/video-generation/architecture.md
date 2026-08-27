# video-generation 模块 · architecture

采用模块化单体：通用 job 生命周期只认识带 `kind` 的 Provider 结果；图片和视频各自拥有 adapter、结果校验、表与存储策略。依赖方向是 job lifecycle → 媒体存储端口，具体图片/视频实现不互相依赖。

首批 Seedance 模型：稳定基线 `doubao-seedance-1-5-pro-251215`；`doubao-seedance-2-0-260128` 与 `doubao-seedance-2-0-fast-260128` 在真实账户探测成功后开放。Mini 在官方精确 API ID 被验证前不猜测、不发布。

任务通过 Ark `/api/v3/contents/generations/tasks` 提交，保存 bounded task ID，轮询 `/tasks/{id}`；成功 URL 仅作为短期 result snapshot，进入 storing 后立即转存。视频文件默认与图片一致保留 7 天；收藏永久，导出不改变内部保留期；清理只写墓碑，不删除生成历史。

兼容策略：现有图片 API、表、DTO 和 storage 函数保持语义不变。schema 迁移只增加 `media_kind` 与 `videos`/`video_favorites`，旧 generation 默认 `image`。
