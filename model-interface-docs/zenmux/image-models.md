# ZenMux 图片生成模型接口文档

> 抓取时间: 2026-07-09
> 抓取源: https://zenmux.ai/models?sort=newest&output_modalities=image
> ZenMux 是一个 AI 模型路由平台，将请求路由至最佳供应商，并通过故障转移最大化可用性。

---

## 通用端点

ZenMux 提供两种底层 API 协议，所有图片模型均可通过以下 base URL 访问：

| API 协议 | Base URL | SDK |
|----------|----------|-----|
| Google Gemini / Imagen | `https://zenmux.ai/api/vertex-ai` | `google-genai` Python SDK |
| OpenAI-compatible API | `https://zenmux.ai/api/v1` | OpenAI Python SDK / cURL |

> **注意**: 使用 ZenMux 需要 API Key（通过 `$ZENMUX_API_KEY` 传入或设置为环境变量），可在 [ZenMux 控制台](https://zenmux.ai/platform/pay-as-you-go) 创建。

---

## 图片生成 API 调用示例

### 方式1: Google Imagen API (Python SDK)

```python
from google import genai
from google.genai import types

client = genai.Client(
    api_key="$ZENMUX_API_KEY",
    vertexai=True,
    http_options=types.HttpOptions(
        api_version='v1',
        base_url='https://zenmux.ai/api/vertex-ai'
    )
)

# 文生图
generate_images_response = client.models.generate_images(
    model="openai/gpt-image-2",
    prompt="A cat and a dog"
)

# 图片编辑（以图生图 + 文字指令）
edit_image_response = client.models.edit_image(
    model="openai/gpt-image-2",
    prompt="Add a robot",
    reference_images=[
        types.RawReferenceImage(
            reference_id=1,
            reference_image=generate_images_response.generated_images[0].image
        )
    ]
)
```

### 方式2: Gemini generate_content（多模态输出）

部分模型支持同时返回文本和图片的模式：

```python
from google import genai
from google.genai import types

client = genai.Client(
    api_key="$ZENMUX_API_KEY",
    vertexai=True,
    http_options=types.HttpOptions(
        api_version='v1',
        base_url='https://zenmux.ai/api/vertex-ai'
    )
)

response = client.models.generate_content(
    model="google/gemini-3.1-flash-lite-image",
    contents=[prompt],
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"]
    )
)

for part in response.parts:
    if part.text is not None:
        print(part.text)
    elif part.inline_data is not None:
        image = part.as_image()
        image.save("generated_image.png")
```

### 方式3: OpenAI Images API (cURL)

```bash
curl https://zenmux.ai/api/v1/images/generations \
  -H "Authorization: Bearer $ZENMUX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-image-2",
    "prompt": "A cat and a dog",
    "n": 2,
    "size": "1024x1024"
  }'
```

---

## 图片模型列表 (共15个)

### 1. Google: Nano Banana 2 Lite (Gemini 3.1 Flash-Lite Image)

| 属性 | 值 |
|------|-----|
| **Model ID** | `google/gemini-3.1-flash-lite-image` |
| **开发者** | Google |
| **输入类型** | 文本、图片 |
| **输出类型** | 文本、图片 |
| **输入价格** | $0.25 / 百万 token |
| **输出价格** | $1.5 / 百万 token |
| **上下文** | 65.54K |
| **最大输出** | 32.77K |
| **可用率** | 100.00% |
| **供应商** | Google Vertex |
| **支持的 API** | Gemini |
| **发布日期** | 2026-07-01 |

**描述**: Google 最快的 Gemini 图像模型，专为高频开发流水线和快速视觉探索而构建。约 4 秒完成文生图（比 Gemini 3.1 Flash Image 快约 2.7 倍）。支持文本转图像、图像编辑和多图像合成。输出 1K 分辨率，支持 14 种宽高比，带 SynthID 水印。

---

### 2. Google: Gemini Omni Flash Preview

| 属性 | 值 |
|------|-----|
| **Model ID** | `google/gemini-omni-flash-preview` |
| **开发者** | Google |
| **输入类型** | 文本、图片、文件、音频、视频 |
| **输出类型** | 文本、图片、视频 |
| **输入价格** | $1.5 / 百万 token |
| **输出价格** | $9 / 百万 token |
| **上下文** | 131.07K |
| **最大输出** | 57.92K |
| **可用率** | - |
| **供应商** | Google Vertex |

**描述**: 多模态模型，针对视频、图片和文本任务优化。以视频生成为核心能力，在单个模型中提供视频输出和文本响应。

---

### 3. Google: Nano Banana 2 (Gemini 3.1 Flash Image)

| 属性 | 值 |
|------|-----|
| **Model ID** | `google/gemini-3.1-flash-image` |
| **开发者** | Google |
| **输入类型** | 文本、图片 |
| **输出类型** | 文本、图片 |
| **输入价格** | $0.5 / 百万 token |
| **输出价格** | $3 / 百万 token |
| **上下文** | 65.54K |
| **最大输出** | 32.77K |
| **可用率** | 50.00% |
| **供应商** | Google Vertex |
| **支持的 API** | Gemini |

**描述**: 专为速度和效率设计的 Gemini 3.1 Flash 图像生成模型，适用于快速交互响应和高吞吐量场景。

---

### 4. Google: Nano Banana Pro (Gemini 3 Pro Image)

| 属性 | 值 |
|------|-----|
| **Model ID** | `google/gemini-3-pro-image` |
| **开发者** | Google |
| **输入类型** | 文本、图片 |
| **输出类型** | 文本、图片 |
| **输入价格** | $2 / 百万 token |
| **输出价格** | $12 / 百万 token |
| **上下文** | 65.54K |
| **最大输出** | 8.19K |
| **可用率** | 96.19% |
| **供应商** | Google Vertex |
| **支持的 API** | Gemini |

**描述**: 基于 Gemini 3 Pro，从简单模式匹配升级为推理驱动系统，改进了物理理解、文字渲染和图像一致性。原生 2K 分辨率，支持编辑已有图像，更专业级别的结果。

---

### 5. OpenAI: GPT-Image-2

| 属性 | 值 |
|------|-----|
| **Model ID** | `openai/gpt-image-2` |
| **开发者** | OpenAI |
| **输入类型** | 文本、图片 |
| **输出类型** | 图片 |
| **输入价格** | $5 / 百万 token |
| **输出价格** | 图片输出 $30 / 百万 token |
| **上下文** | 10.00K |
| **可用率** | 91.14% |
| **供应商** | Azure, OpenAI |
| **支持的 API** | Imagen, Images |
| **发布日期** | 2026-04-22 |

**描述**: OpenAI 下一代图像生成模型。提供快速、高质量的图像生成和编辑能力，支持灵活的图像尺寸和高保真图像输入。

---

### 6. Qwen: Qwen-Image-2.0

| 属性 | 值 |
|------|-----|
| **Model ID** | `qwen/qwen-image-2.0` |
| **开发者** | Qwen |
| **输入类型** | 文本、图片 |
| **输出类型** | 图片 |
| **输出价格** | $0.0289 / 次 |
| **上下文** | 1.02K |
| **可用率** | - |
| **供应商** | Alibaba Cloud |
| **支持的 API** | Imagen, Images |
| **发布日期** | 2026-03-03 |

**描述**: Qwen AI 推出的图像生成模型。

---

### 7. Qwen: Qwen-Image-2.0-Pro

| 属性 | 值 |
|------|-----|
| **Model ID** | `qwen/qwen-image-2.0-pro` |
| **开发者** | Qwen |
| **输入类型** | 文本、图片 |
| **输出类型** | 图片 |
| **输出价格** | $0.073 / 次 |
| **可用率** | 100.00% |
| **供应商** | Alibaba Cloud |
| **支持的 API** | Imagen |

**描述**: Qwen AI 推出的图像生成专业版模型。

---

### 8. ByteDance: Doubao-Seedream-5.0-lite

| 属性 | 值 |
|------|-----|
| **Model ID** | `bytedance/doubao-seedream-5.0-lite` |
| **开发者** | ByteDance |
| **输入类型** | 文本、图片 |
| **输出类型** | 图片 |
| **输出价格** | $0.032 / 次 |
| **可用率** | - |
| **供应商** | ByteDance |
| **支持的 API** | Imagen |

**描述**: 字节跳动最新图像生成模型。首次集成在线检索功能，可结合实时网络信息提升生成图像的时效性。精准解读复杂指令和视觉内容，在企业级视觉创作场景中表现优秀。

---

### 9. Google: Nano Banana 2 Preview (Gemini 3.1 Flash Image Preview)

> ⚠️ **即将下线: 2026/07/17**

| 属性 | 值 |
|------|-----|
| **Model ID** | `google/gemini-3.1-flash-image-preview` |
| **开发者** | Google |
| **输入类型** | 文本、图片 |
| **输出类型** | 文本、图片 |
| **输入价格** | $0.5 / 百万 token |
| **输出价格** | $3 / 百万 token |
| **上下文** | 65.54K |
| **最大输出** | 32.77K |
| **可用率** | 65.12% |
| **供应商** | 2 个供应商 |
| **支持的 API** | Gemini |

**描述**: Gemini 3.1 Flash Image 的预览版。预览模型可能变化，并有更严格的速率限制。

---

### 10. Z.AI: GLM-Image

| 属性 | 值 |
|------|-----|
| **Model ID** | `z-ai/glm-image` |
| **开发者** | Z.AI |
| **输入类型** | 文本 |
| **输出类型** | 图片 |
| **输出价格** | $0.0146 / 次 |
| **可用率** | - |
| **供应商** | 2 个供应商 |
| **支持的 API** | Imagen |

**描述**: 采用混合自回归+扩散解码器架构。在通用图像生成质量上与主流潜在扩散方法持平，在文字渲染和知识密集型生成场景中有显著优势。支持图生图任务：图像编辑、风格迁移、身份保持生成和多主体一致性。

---

### 11. OpenAI: GPT-Image-1.5

| 属性 | 值 |
|------|-----|
| **Model ID** | `openai/gpt-image-1.5` |
| **开发者** | OpenAI |
| **输入类型** | 文本、图片 |
| **输出类型** | 文本、图片 |
| **输入价格** | $5 / 百万 token |
| **输出价格** | $10 / 百万 token |
| **可用率** | 100.00% |
| **供应商** | 2 个供应商 |
| **支持的 API** | Imagen, Images |

**描述**: OpenAI 最新 AI 图像生成模型。在指令遵循、照片真实感、文字渲染和编辑控制方面更优，内置推理能力，通过 API 提供。速度更快、成本更低。

---

### 12. Google: Nano Banana Pro Preview (Gemini 3 Pro Image Preview)

> ⚠️ **即将下线: 2026/07/17**

| 属性 | 值 |
|------|-----|
| **Model ID** | `google/gemini-3-pro-image-preview` |
| **开发者** | Google |
| **输入类型** | 文本、图片 |
| **输出类型** | 文本、图片 |
| **输入价格** | $2-4 / 百万 token |
| **输出价格** | $12-18 / 百万 token |
| **上下文** | 65.54K |
| **最大输出** | 32.77K |
| **可用率** | 94.12% |
| **供应商** | 2 个供应商 |
| **支持的 API** | Gemini |

**描述**: Nano Banana Pro 的预览版（基于 Gemini 3 Pro Image）。推理驱动 + 改进物理理解 + 原生 2K + 编辑控制。

---

### 13. Google: Gemini 2.5 Flash Image (Nano Banana)

| 属性 | 值 |
|------|-----|
| **Model ID** | `google/gemini-2.5-flash-image` |
| **开发者** | Google |
| **输入类型** | 文本、图片 |
| **输出类型** | 文本、图片 |
| **输入价格** | $0.3 / 百万 token |
| **输出价格** | $2.5 / 百万 token |
| **上下文** | 32.77K |
| **最大输出** | 8.19K |
| **可用率** | 83.33% |
| **供应商** | Google Vertex |
| **支持的 API** | Gemini |

**描述**: Gemini 2.5 Flash Image (a.k.a. "Nano Banana") 已 GA。最新的图像生成模型，具备上下文理解能力，支持图像生成、编辑和多轮对话。

---

### 14. Tencent: HY-Image-V3.0

| 属性 | 值 |
|------|-----|
| **Model ID** | `tencent/hy-image-v3.0` |
| **开发者** | Tencent |
| **输入类型** | 文本、图片 |
| **输出类型** | 图片 |
| **输出价格** | $0.029 / 次 |
| **上下文** | 10.24K |
| **最大输出** | 10.24K |
| **可用率** | - |
| **供应商** | Tencent |
| **支持的 API** | Imagen, Images |

**描述**: 原生多模态模型，在自回归框架内统一多模态理解与生成。文生图和图生图性能达到或超过领先闭源模型。

---

## 模型价格速查

按价格从低到高（仅图片输出，每张图计价模型）：

| Model ID | 输出价格 | 输入价格 |
|----------|----------|----------|
| `z-ai/glm-image` | $0.0146/次 | - |
| `qwen/qwen-image-2.0` | $0.0289/次 | - |
| `tencent/hy-image-v3.0` | $0.029/次 | - |
| `bytedance/doubao-seedream-5.0-lite` | $0.032/次 | - |
| `qwen/qwen-image-2.0-pro` | $0.073/次 | - |

按价格从低到高（Token 计价模型，输出价格）：

| Model ID | 输出价格 | 输入价格 |
|----------|----------|----------|
| `google/gemini-3.1-flash-lite-image` | $1.5/M token | $0.25/M token |
| `google/gemini-2.5-flash-image` | $2.5/M token | $0.3/M token |
| `google/gemini-3.1-flash-image` | $3/M token | $0.5/M token |
| `google/gemini-3.1-flash-image-preview` | $3/M token | $0.5/M token |
| `google/gemini-omni-flash-preview` | $9/M token | $1.5/M token |
| `openai/gpt-image-1.5` | $10/M token | $5/M token |
| `google/gemini-3-pro-image` | $12/M token | $2/M token |
| `google/gemini-3-pro-image-preview` | $12-18/M token | $2-4/M token |
| `openai/gpt-image-2` | $30/M token (图片) | $5/M token |

---

## 项目适配建议

### 推荐集成策略

1. **统一适配层**: 本项目应同时支持两种 API 协议（Gemini SDK + OpenAI-compatible），提供统一接口供上层调用
2. **每图计价 vs Token 计价**: 需要根据价格模型分别处理计费逻辑
3. **多图生成**: 对于支持 `generate_content` 的 Gemini 模型（返回 TEXT + IMAGE），可以在一次请求中生成多张图；对于 OpenAI Images API 使用 `n` 参数控制数量
4. **System Prompt**: ZenMux 标准化请求格式，system prompt 可作为 prompt 前缀或通过 Gemini `GenerateContentConfig` 的 system_instruction 参数传入
5. **供应商选择**: ZenMux 自动路由到最佳供应商，开发者无需手动选择

### 建议适配的模型优先级

1. `google/gemini-3.1-flash-lite-image` — 最快、最便宜（$1.5/M output, 100% 可用率）
2. `google/gemini-2.5-flash-image` — 成熟稳定、低成本（$2.5/M output）
3. `openai/gpt-image-1.5` — 质量高、100% 可用率
4. `qwen/qwen-image-2.0-pro` — 100% 可用率，按张计价明确
5. `google/gemini-3-pro-image` — 高质量需求（96.19% 可用率）
