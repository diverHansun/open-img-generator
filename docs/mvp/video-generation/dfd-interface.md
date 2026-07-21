# video-generation 模块 · dfd-interface

```text
Browser POST /api/video-generations
  -> durable Generation(media_kind=video) + Job(request snapshot)
  -> worker submit Seedance -> persist task handle
  -> worker poll queued/running/succeeded/failed
  -> succeeded video_url -> video storage stream validation -> videos row
  -> GET detail/history -> local /api/videos/:id URL
```

首批请求：`prompt`、单一 `target`、`aspectRatio`；Provider 私有选项只允许已验证的 duration/resolution 等字段。公开返回不包含 Ark 原始 body、签名 URL、密钥或完整上游错误。

MP4 下载逐跳校验 HTTPS、DNS/IP、redirect、大小与 `ftyp` signature；临时文件成功后原子 rename。读取与导出只接受 DB 中 canonical storage path。
