# video-generation 模块 · goals-duty

## 目标

提供可恢复的文生视频最小纵切：接受一个文本提示词，持久提交 Volcengine Ark Seedance 异步任务，轮询成功后立即把临时 MP4 转存本地，并保留可诊断历史。

## 职责

- 定义视频模型能力、Provider 请求/轮询结果与视频资产 DTO。
- 复用 generation job 的 admission、lease、cancel、retry 和 terminal 聚合。
- 校验并落盘 MP4，保存时长、尺寸、字节数和可用性。
- 提供独立视频生成、详情、读取、下载、收藏/保留与历史入口。

## 非职责

- 首批不做图生视频、多素材、续写、编辑、人物资产、回调/webhook。
- 不把视频塞进 `images` 表或图片 MIME 校验器。
- 不自建代理发现/路由层；复用系统网络栈与项目安全 HTTP 边界。
