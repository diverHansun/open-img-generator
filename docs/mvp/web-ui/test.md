# web-ui 模块 · test

> 前置: goals-duty, dfd-interface
> 修订说明: 2026-07-16 增补门禁与状态可见性场景

---

## 1. Test Scope

**要验证**: Project 门禁；sessionId 必填提交；job 状态可见；启用池过滤；收藏入口调用。
**不验证**: 厂商真实出图（integration 另测）；像素视觉回归（可选后续）。

---

## 2. Critical Scenarios

| ID | 场景 | 期望 |
|----|------|------|
| U1 | 无 project 时 | 不出现可点 Generate 的主面板 |
| U2 | POST 后轮询前 | 至少展示 pending/running 级状态，非空白 |
| U3 | prefs 关闭某模型 | 工作台可选池消失该项 |
| U4 | 提交缺 sessionId | 客户端拦截或服务端 400 有提示 |
| U5 | 收藏 | 调用 favorites API |

---

## 3. Integration Points

- web-client unit（已有）扩展 list/favorites/prefs
- 可选 Playwright：门禁 → 选 session → Generate 状态行出现

---

## 4. Verification Strategy

优先补 web-client + 组件级状态逻辑；E2E 门禁与状态行作为冒烟。
