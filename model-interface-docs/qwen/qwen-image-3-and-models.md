# Qwen Image 3.0 / Qwen Image 2.0 Pro Snapshot / Wan 2.7 接入资料

> 资料核对日期：2026-08-14
> 供应商：阿里云百炼 DashScope
> 本文件是当前项目接入边界的官方资料快照，不替代厂商在线文档。

## 官方入口

- [百炼模型广场](https://bailian.console.aliyun.com/cn-beijing?tab=model#/model-market)
- [图像模型总览](https://help.aliyun.com/zh/model-studio/image-model)
- [Qwen-Image 图像生成与编辑 API 参考](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
- [Wan 图像生成与编辑 API 参考](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)
- [新模型发布记录](https://help.aliyun.com/zh/model-studio/newly-released-models)

## 本批确认的模型

| model ID | 官方协议形态 | 当前产品接入 |
|----------|--------------|--------------|
| `qwen-image-3.0-pro` | multimodal sync | 纯文生图 |
| `qwen-image-3.0` | multimodal sync | 纯文生图 |
| `qwen-image-2.0-pro-2026-06-22` | multimodal sync | 纯文生图 |
| `wan2.7-image` | multimodal sync | 纯文生图 |

保留的相邻模型：

- `qwen-image-2.0-pro`：继续使用 Qwen multimodal sync。
- `wan2.7-image-pro`：继续使用 DashScope async task + poll。

停止支持：

- `qwen-image-plus`：从当前 ModelSpec 目录移除。
- legacy `text2image/image-synthesis` async 方言：从 Qwen adapter 移除；不作为隐式 fallback。

## 端点与请求形态

### Qwen Image 3.0 / Qwen Image 2.0 Pro snapshot

同步端点：

```text
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
```

请求保持单轮文本消息：

```json
{
  "model": "qwen-image-3.0",
  "input": {
    "messages": [
      {
        "role": "user",
        "content": [{ "text": "..." }]
      }
    ]
  },
  "parameters": {
    "size": "1024*1024",
    "n": 1,
    "watermark": false,
    "prompt_extend": true
  }
}
```

项目解析 `output.choices[].message.content[]` 中的 `image` URL。当前 capabilities 允许负面提示词、seed 和数量，但只公开 `text-to-image`，不发送图片输入。

### Wan 2.7 Image 标准版

同步端点同上，但使用独立 Wan profile。项目固定发送：

```json
{
  "parameters": {
    "enable_sequential": false,
    "thinking_mode": true
  }
}
```

标准版本批不发送 `negative_prompt`，也不发送 `X-DashScope-Async`。`wan2.7-image-pro` 的异步路径保持不变，不与标准版 profile 混用。

## 产品边界与后续

官方 API 文档同时描述图片输入、图像编辑及组图能力；当前生成页没有参考图上传入口，因此本批只接入文生图。后续若要接入图生图，需要同时设计 UI 输入、NormalizedRequest、校验、远程 URL/数据处理和 adapter content 映射，不能只增加一个 model capability。

默认尺寸沿用项目当前的 1K 比例映射，以控制首批费用与 E2E 风险；2K/4K 不在本批默认公开能力中。
