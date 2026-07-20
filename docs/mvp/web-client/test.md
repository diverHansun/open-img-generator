# web-client 模块 · test

> 前置: goals-duty, dfd-interface

---

## 1. Scope

Unit：api-client（mock fetch）、polling 退避与终态、capabilities 交集。
不测真实后端（integration 层）。

---

## 2. Critical Scenarios

| ID | 场景 | 期望 |
|----|------|------|
| W1 | derive 多模型无共同比 | Generate 禁用信号 |
| W2 | poll 全部 job 终态 | stop |
| W3 | submit 类型要求 sessionId | 类型/运行时构造含该字段 |
| W4 | list vs get | list 路径不含 advance 语义假设 |
| W5 | detail deadline | 15 秒后 abort；旧请求不能无限挂起 |
| W6 | offline/hidden | 不发详情 GET；恢复后下一 tick 继续 |
| W7 | 连续详情失败 | 6 次后停止自动轮询；用户动作可重新订阅 |
| W8 | Seed 交集 | 任一 target 不支持即隐藏并拒绝构造请求 |

---

## 3. Strategy

延续现有 `*.unit.test.ts`；新资源方法补 mock 用例。
