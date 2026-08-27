# video-generation 模块 · data-model

## Generation

`generations.media_kind`: `image | video`，旧数据回填 `image`。一次 generation 不混合媒体类型。

## Video

`videos(id, generation_job_id, index, storage_path, content_type, width, height, duration_seconds, size_bytes, created_at, removed_at, removal_reason)`。

可用性不变量与图片一致：有 path 时没有墓碑；path 为空时必须有 `retention_expired | user_deleted | storage_missing`。`video_favorites.video_id` 唯一，删除视频历史时级联删除收藏关系。

Provider handle 仍只保存 provider/model/externalId 和受信 URL；result snapshot 使用 `{kind:'video', videos:[...]}` 的有界版本化形状，不保存签名 URL 到 terminal 历史。
