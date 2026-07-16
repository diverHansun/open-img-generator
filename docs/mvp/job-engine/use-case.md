# job-engine 模块 · use-case

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md, architecture.md, dfd-interface.md
> 文档顺序: ⑤ use-case(本文) → ⑦ test
> 说明: 可选文档；因扇出含多步骤编排，供 Codex 实施时对照主路径

> 修订说明: 2026-07-16 sessionId 必填；Project 由 library 先创建

---

## 1. 用例一览

| ID | 名称 | 触发 | 结果 |
|----|------|------|------|
| UC-1 | 单模型 sync 生成 | POST targets=[zenmux] + sessionId | generation+1 job completed，含 images |
| UC-2 | 单模型 async 生成 | POST targets=[fal] + sessionId → 轮询 GET | pending → completed |
| UC-3 | 双模型扇出 | POST targets=[fal, zenmux] + sessionId | 1 gen + 2 jobs；sync 可能先完成，async 靠 GET 推进 |
| UC-4 | 扇出部分失败 | 一 target submit 失败 | 该 job failed；另一 job 可 completed；generation 聚合为 completed（若有成功）或 failed（全败） |
| UC-5 | 非法共享宽高比 | aspectRatio 不被某 target 支持 | 400，无库记录 |
| UC-6 | 缺少 sessionId | POST 无 sessionId | 400，无库记录 |
| UC-7 | Session 内查看 | GET session | 只读返回历史；不推进任何未终结 job |

---

## 2. UC-3 双模型扇出（主路径，逐步）

**前置**: FAL_KEY、ZENMUX_API_KEY 均配置；已存在 Project 与 Session（经 library/API 创建）。

1. 客户端 POST：
   ```json
   {
     "prompt": "a red balloon",
     "aspectRatio": "1:1",
     "count": 1,
     "sessionId": "<existing-session-uuid>",
     "targets": [
       { "provider": "fal", "model": "fal-ai/flux/schnell" },
       { "provider": "zenmux", "model": "openai/gpt-image-2" }
     ]
   }
   ```
2. validator 确认 session 存在；两 target 均支持 `1:1`；count=1 满足 sync 限制。
3. 事务写入 1 generation + 2 jobs。
4. fal.submit → async handle → fal job pending。
5. zenmux.submit → sync images → storeImages → zenmux job completed。
6. 聚合 status → `pending`（因 fal 未完成）。
7. 客户端按 constraints §2 轮询 GET：
   - advance fal job → completed + 转存
   - 聚合 → `completed`
8. `GenerationView.jobs` 含两条；`images` 含两 job 的图，用 `jobId` 区分。

---

## 3. UC-4 部分失败

1. 同 UC-3，但 zenmux 返回 failed。
2. fal 仍可后续 completed。
3. 全部终态后：generation.status = `completed`（有成功 job）；zenmux JobView.error 可见。

---

## 4. 与 web-ui 的衔接

- web-ui 负责：模型多选、aspectRatio 交集、seed 显隐（任一 supportsSeed 则显示）。
- job-engine 负责：接收已构造的 targets + 共享参数并执行 UC-1～UC-6。

---

## 自检

- 每个用例可映射到 goals-duty 的 Duties
- 无取消、重试、成本等 Non-Duties 内容
