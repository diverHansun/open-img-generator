# web-ui 模块 · use-case

> 前置: dfd-interface.md
> 修订说明: 2026-07-16 对齐 library UC

---

## UC-UI1 Project 门禁进入工作台

同 library UC1；UI 负责 Gate 与「当前 project/session」本地记忆（按 project 存 lastSessionId）。

## UC-UI2 生成并展示状态

1. 用户勾选启用池内模型 → 派生参数
2. Generate → POST（带 sessionId）
3. Results 区立即出现 job 行与 status
4. 轮询更新；出图可点击收藏

## UC-UI3 浏览最近 10 次 vs History

工作台只绑当前 project 最近 10 次；「查看全部」→ History。

## UC-UI4 Gallery 收藏浏览

网格展示；点开看 prompt/provider/model/回溯链接（可跳 History 对应 generation）。

## UC-UI5 Models 启用

开关写 prefs；返回 Generate 时可选池变化；已勾选但被禁用的模型自动剔除。
