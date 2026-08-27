# SiliconFlow（硅基流动）接口文档

> 来源：本目录文档由 AI 根据 [siliconflow.cn](https://siliconflow.cn) 与官方文档公开内容整理，整理时间 2026-05-19。
> 涉及具体价格、模型、字段，**接入前请以官方文档为准**。

SiliconFlow 是一个聚合多家开源/商业 AI 模型的云服务平台，对外暴露 **OpenAI 兼容** 的 API。核心特点：

1. **API 协议主要是 OpenAI 兼容**（`/v1/chat/completions`、`/v1/images/generations` 等），接入心智负担小。
2. **聚合大量开源 + 部分商业模型**（FLUX、Stable Diffusion、Qwen、Wan、Z-Image、ERNIE-Image 等）。
3. **价格相对低**（官方宣称图像模型相对其他云"省 66%"，需自行核对）。
4. **同时按 token 与按张计费**：部分图模型按 **token** 计费（这点比较反常，业务层估算需注意）。

本目录包含：

| 文件 | 内容 |
|---|---|
| [README.md](./README.md) | 本文件：平台综述、认证、协议 |
| [models.md](./models.md) | 模型目录（含 model_id 与已知定价） |
| [images-api.md](./images-api.md) | 图像生成 API（OpenAI 兼容协议） |

---

## 认证

OpenAI 兼容：

```
Authorization: Bearer $SILICONFLOW_API_KEY
```

API Key 在 [cloud.siliconflow.cn](https://cloud.siliconflow.cn) 控制台创建。

---

## Base URL

- 国内：`https://api.siliconflow.cn/v1/`
- 国际：`https://api.siliconflow.com/v1/`（**境外站点，本项目应使用此 URL**）

> 项目部署在海外，请优先用 `.com` 域名；`.cn` 域名走中国大陆出口，跨境调用延迟与稳定性都不理想。

---

## 协议综述

| 类型 | 端点 | 说明 |
|---|---|---|
| 文生图 / 图生图 | `POST /v1/images/generations` | OpenAI 兼容 |
| 对话（用于 prompt 改写） | `POST /v1/chat/completions` | OpenAI 兼容 |
| 模型列表 | `GET /v1/models` | OpenAI 兼容 |

---

## 调用模式

绝大多数图像模型走 **同步 HTTP**（与 OpenAI 一致）：请求发出后服务端阻塞处理，直到出图返回。

> **设计含义**：worker 端调用 SiliconFlow 时是一次普通的 HTTP `await`，单个 HTTP 连接占用直到返回。**对单机 worker 而言，并发上限主要由 Node 的事件循环 + per-provider 限流决定**。

---

## 与本项目（AI 绘图网站）的对应关系

- **SiliconFlow 是本项目的两大主力 provider 之一**，承担"初级档"主力模型（FLUX schnell、Qwen-Image、Z-Image、ERNIE-Image-Turbo 等）。
- 在 `packages/providers/siliconflow/` 中实现 `SiliconFlowProvider implements ImageProvider`。
- 协议与 OpenAI 一致，可考虑用 `openai` npm 包传入自定义 `baseURL` 与 `apiKey`（不引入新 SDK）。

---

## 计费的特殊点（重要）

SiliconFlow 的图像模型出现了 **两种计费单位混用**：

- **按张计费**：与 OpenAI / fal 相同的模式
- **按 token 计费**：部分模型（如 `Tongyi-MAI/Z-Image-Turbo`、`baidu/ERNIE-Image-Turbo`）公示价格是 "¥X / M Tokens"

> **业务层影响**：
> 1. 在 `packages/shared/cost.ts` 中，**每个 provider × model 需要一个独立的成本估算函数**，输入为 `(prompt, resolution, modes)`，输出为预估元成本（人民币 / 美元）。
> 2. token 计费模型的成本受 prompt 长度影响，**积分扣除应在 worker 完成后按 `usage.total_tokens` 实际扣减**——而不是 submit 时静态扣。
> 3. 或者：保守策略，submit 时按"上限 token 数"先冻结积分，完成后再退差额。

---

## 待补条目

接入前需在 SiliconFlow 控制台/文档确认：

- [ ] 完整的图像模型列表（含 model_id 与单价）
- [ ] 是否提供 webhook / 异步任务（按现有信息看主要是同步）
- [ ] 是否对单账户有 QPS / 并发上限
- [ ] 内容审核策略（是否对 prompt 与图像做审查、错误码定义）
- [ ] 海外站点（`.com`）的 base URL 是否与 `.cn` 完全等价
- [ ] 是否支持图生图（`image` 字段或 `mask` 字段）
