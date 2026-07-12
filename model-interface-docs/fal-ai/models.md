# fal.ai 模型目录

> 来源：[fal.ai/models](https://fal.ai/models) 与 [fal.ai/pricing](https://fal.ai/pricing)（2026-05-19 抓取）
> 注：fal 模型数量巨大且新增频繁。本目录只覆盖**本项目候选档位的模型**。

---

## 候选模型（按本项目使用计划分组）

### 高级档主力（advanced tier）

| 模型 | model_id | 价格 / 张（@1MP） | 说明 |
|---|---|---|---|
| Nano Banana | `fal-ai/nano-banana` | **$0.039** | Google "famous original" 图生图 + 文生图，本项目高级档明星模型 |
| Nano Banana 2 | `fal-ai/nano-banana-2` | 待补 | Google 新一代 SOTA 快速文生图 |
| Nano Banana Pro | `fal-ai/nano-banana-pro` | 待补 | 强化版，强调写实与排版（typography） |
| GPT Image 2 | `fal-ai/openai/gpt-image-2` | 待补 | OpenAI 最新图模型，**细粒度编辑能力强** |
| FLUX 1.1 [pro] | `fal-ai/flux-pro/v1.1` | 待补 | 增强构图与艺术保真 |
| FLUX 1.1 [pro] Ultra | `fal-ai/flux-pro/v1.1-ultra` | 待补 | 最高 2K 分辨率，强写实 |
| FLUX 2 [pro] | `fal-ai/flux-2-pro` | 待补 | 图像编辑 / 风格迁移 |
| FLUX Kontext [pro] | `fal-ai/flux-pro/kontext` | **$0.04** | **图像编辑**：文本 + 参考图做局部编辑 |
| Seedream V4 | `fal-ai/seedream/v4`（待校验） | **$0.03** | 字节豆包 Seedream 4，也可走 doubao 直连，看延迟与成本择优 |

### 初级档备选（basic tier）

| 模型 | model_id | 价格 / 张 | 说明 |
|---|---|---|---|
| FLUX [schnell] | `fal-ai/flux/schnell` | 待补 | 12B，1–4 步快速生成，**初级档最佳候选** |
| FLUX [dev] | `fal-ai/flux/dev` | 待补 | 12B 商用版 |

> 说明：初级档主要走 SiliconFlow / qwen 直连（更便宜），fal 只作为容量兜底与冗余。

---

## 已确认的定价（fal.ai/pricing 页可见，归一化到 1 megapixel）

| 模型 | 单图价格 | 备注 |
|---|---|---|
| Seedream V4 | $0.03 | "Normalized to 1MP" |
| FLUX Kontext Pro | $0.04 | "Normalized to 1MP" |
| Nano Banana | $0.0398 | 模型页显示 "$0.039 per image. For $1.00, you can run this model 25 times" |

> **重要**：fal 明确说 "**Higher resolutions will be priced proportionally**"，即输出 2MP 的图按比例约为 2 倍价格。**业务层在估算积分扣费时，必须把 `resolution` 因子算进去**。

---

## 待补条目

接入前需在 fal 控制台/定价页确认：

- [ ] FLUX schnell / dev / pro / ultra 的实际单图价
- [ ] GPT Image 2 单图价
- [ ] Nano Banana 2 / Nano Banana Pro 单图价
- [ ] 各模型支持的 `image_size` / `aspect_ratio` 参数枚举
- [ ] 图像编辑模型对 `image_url` 输入的限制（URL / Base64 / 大小 / 多图支持张数）
- [ ] 每个模型的典型耗时（用于 worker 超时与"长任务"UI 提示）

---

## 调用入口

所有模型走同一套 Queue API，详见 [queue-api.md](./queue-api.md)。

示例（文生图）：

```bash
curl -X POST "https://queue.fal.run/fal-ai/nano-banana" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a corgi astronaut on the moon, photorealistic"
  }'
```

返回 `request_id` 与三个 URL，按 queue 协议继续推进。

---

## 参考链接

- 模型市场总览：https://fal.ai/models
- 定价：https://fal.ai/pricing
- Queue API 文档：https://docs.fal.ai/model-endpoints/queue
- 单模型主页示例：https://fal.ai/models/fal-ai/nano-banana
