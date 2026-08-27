# 讨论记录与已确认要点

> 2026-08-14 与用户讨论定稿。正式方案见 01–04。

## 1. 背景与动机

阿里云百炼已新增 Qwen Image 3.0 系列，且 Qwen Image 2.0 Pro 已有 `2026-06-22` 最新快照。项目当前仍保留旧的 Qwen Image Plus legacy 异步协议，需要收敛到当前 multimodal 协议，并补齐当前产品需要的文生图模型。

## 2. 已确认：目标与范围

| 决策项 | 结论 |
|--------|------|
| 删除旧模型 | 删除 `qwen-image-plus` 的公开能力、ModelSpec、adapter 分支、测试与当前模块文档支持 |
| 删除旧协议 | 删除 legacy `text2image/image-synthesis` 请求构造；保留 Qwen 通用 task poll 代码给现有 Wan Pro 使用 |
| 新增 Qwen 模型 | `qwen-image-3.0-pro`、`qwen-image-3.0`、`qwen-image-2.0-pro-2026-06-22` |
| 新增 Wan 模型 | `wan2.7-image` |
| 产品模式 | 本批所有新增模型仅公开 `text-to-image` |
| 协议 | Qwen 3.0、Qwen 2.0 快照走 multimodal sync；Wan 2.7 标准版走 multimodal sync |
| 保留模型 | `qwen-image-2.0-pro`、`wan2.7-image-pro` 继续可用并回归 |
| 验收 | 完成编译、自动化测试、启动运行检查，并使用 WebUI 做一次授权的 live flow 验收 |
| 代码审查 | 自动化验证后进行子代理改动审查，发现重要问题先修复再交付 |

## 3. 已确认：边界

| 项 | 处理 |
|----|------|
| 图生图/图片编辑 | 后续独立批次；本批 capabilities 不声明 `image-to-image` |
| 参考图输入 | 后续独立批次；本批不改变生成页输入结构 |
| Wan 2.7 Pro | 保留当前 async 实现，不在本批重构其协议 |
| 历史 job | 不迁移、不改写历史 model 字符串；已存在旧任务只能按未知模型安全失败 |
| 区域 | 继续使用用户当前 `DASHSCOPE_BASE_URL` 与 API Key，不自动切换北京/新加坡 |

## 4. 用户确认记录

用户明确要求：“建议删除qwen-image-plus 这个model支持以及legacy async协议，然后来第一批先接入、但仍沿用当前产品的‘纯文生图’边界：qwen-image-3.0-pro、qwen-image-3.0、qwen-image-2.0-pro-2026-06-22、wan2.7-image 先不做图生图，开始吧，完成后进行编译运行和测试，完成后进行子代理审查。”
