# video-generation 模块 · non-functional

- 可靠性：submit/poll 可恢复；未知 submit outcome 不自动重投；成功 URL 立即转存。
- 安全：不信任 URL/MIME/文件扩展名；MP4 硬大小上限；日志与 DB 不存签名 URL和密钥。
- 可维护性：Seedance profile 私有；视频与图片表/存储器隔离；不引入 SDK 与通用代理层。
- 性能：流式下载，不把 MP4 全量载入内存；worker fanout 沿用有界批次。
- 成本：真实验收单模型、短时长、最低稳定分辨率；没有凭据时明确阻塞，禁止伪造成功。
