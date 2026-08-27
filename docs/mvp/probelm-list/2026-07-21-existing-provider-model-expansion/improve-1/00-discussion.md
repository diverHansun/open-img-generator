# 讨论记录与已确认要点

> 2026-07-21 与用户讨论确认。正式方案见 01–04。

## 1. 背景与动机

当前每家 Provider 只有少量模型，adapter 往往把“Provider 协议”和“当前唯一模型的请求假设”写在同一个构造函数中。后续服务端模型 ID、尺寸或字段变化时，需要能够定位到单一 Provider、单一模型 profile 精准修改，而不是改动公开跨模块契约。

## 2. 已确认：目标与范围

| 决策项 | 结论 |
| --- | --- |
| 模型规格 | 每个 Provider 内部增加私有 `ModelSpec` |
| Improve 1 模型 | ZenMux `openai/gpt-image-1.5` |
|  | Doubao `doubao-seedream-4-5-251128`、`doubao-seedream-5-0-260128`（同时核对 Lite 别名） |
|  | SiliconFlow `Tongyi-MAI/Z-Image-Turbo`、`Tongyi-MAI/Z-Image` |
| SiliconFlow 准入 | 先使用真实密钥探测；单个模型失败不阻塞其他模型，但失败模型不得进入可用目录 |
| 真实测试 | 除 Kling 外用户已配置 Provider API key，并授权逐模型执行生图与图片链路检查 |
| 结果保存 | Base64 走内联优先；URL 结果立即转存到本地 storage |
| 历史兼容 | 已有 generation/job/model preference 字符串记录继续有效，无数据库迁移 |

## 3. 已确认：本批不做

| 项 | 处理 |
| --- | --- |
| 图片编辑、多图融合 | 后续独立批次 |
| Fal 与 Qwen 新方言模型 | Improve 2 |
| Kling 新模型 | 未配置凭据且不在候选范围 |
| 动态模型发现 | 不做；模型目录仍随代码发布 |
| SDK 替换 | 不做；继续使用统一安全 HTTP 层 |

## 4. 与关联议题的关系

- 复用已完成的三分钟同步超时、durable provider wait、安全错误诊断和图片立即转存。
- 不改变未收藏图片 7 天、收藏永久保留、历史墓碑语义。
- 实施后需更新 `docs/mvp/providers/`，消除“一个 Provider 只有一个请求形态”的旧描述。

## 5. 用户确认记录

用户明确指定 Improve 1 候选，并要求 `ModelSpec` 能让未来服务端模型变化被精准调整；真实凭据测试可产生付费生图请求。
