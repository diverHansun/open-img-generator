# user-config 模块 · test

> 实现里程碑再落测试；本轮仅列意图。

| ID | 场景 | 期望 |
|----|------|------|
| C1 | 仅 env | registry 启用对应 provider |
| C2 | 仅用户库 | 同上 |
| C3 | env 与用户库皆有 | env 覆盖 |
| C4 | API 响应 | 无 key 字段 |
| C5 | 损坏库文件 | 回退 env + warning |
