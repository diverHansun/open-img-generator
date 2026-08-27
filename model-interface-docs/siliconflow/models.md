# SiliconFlow 模型目录

> 来源：[siliconflow.cn/models](https://siliconflow.cn/models)（2026-05-19 抓取）
> 仅覆盖**与本项目候选档位相关**的图像模型。完整目录请直接看 SiliconFlow 控制台。

---

## 已确认（从公开模型页可见）

| model_id | 提供方 | 计价 | 说明 |
|---|---|---|---|
| `Tongyi-MAI/Z-Image-Turbo` | 阿里通义 MAI | **¥0.1 / M Tokens** | 6B 文生图，S3-DiT 架构，8 NFEs 快速出图。**初级档最佳候选** |
| `Tongyi-MAI/Z-Image` | 阿里通义 MAI | **¥0.3 / M Tokens** | 全容量 Transformer，支持 CFG / 负面提示词 / LoRA 训练 |
| `baidu/ERNIE-Image-Turbo` | 百度 | **¥0.11 / M Tokens** | 8B，8 步快速出图，长文本指令与中文渲染 |

---

## 推测可用（基于 SiliconFlow 历史模型范围，需控制台确认）

以下模型 SiliconFlow 在过去某些时点提供过，**接入前必须先验证模型仍可用 + 拿到当前价**：

| 候选 model_id | 用途 | 说明 |
|---|---|---|
| `black-forest-labs/FLUX.1-schnell` | 初级档主力 | 1–4 步快速生成，开源 FLUX 蒸馏版 |
| `black-forest-labs/FLUX.1-dev` | 初级档备选 | 12B 商用版 |
| `stabilityai/stable-diffusion-3-5-large` | 初级档备选 | SD 3.5 大模型 |
| `Qwen/Qwen-Image` | 初级档备选 / 中文 | 通义 Qwen-Image |

---

## 待补条目

- [ ] 上面"推测可用"一栏的当前可用性 + 单价
- [ ] 图像编辑（图生图）支持的模型列表
- [ ] 是否有图像编辑的专属端点或参数
- [ ] 同一模型在 `.cn` 与 `.com` 域名上是否价格一致
- [ ] 是否有"包月套餐 / 资源包"价比按量便宜

---

## 调用入口

OpenAI 兼容协议，统一走：

```
POST https://api.siliconflow.com/v1/images/generations
Authorization: Bearer $SILICONFLOW_API_KEY
Content-Type: application/json

{
  "model": "Tongyi-MAI/Z-Image-Turbo",
  "prompt": "...",
  "image_size": "1024x1024",
  "n": 1
}
```

详见 [images-api.md](./images-api.md)。

---

## 参考链接

- 模型市场：https://siliconflow.cn/models
- 控制台（含定价与 API Key 管理）：https://cloud.siliconflow.cn
- 价格页：https://siliconflow.cn/pricing
- 国际站：https://siliconflow.com
