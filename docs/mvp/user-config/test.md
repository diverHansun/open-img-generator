# user-config 模块 · test

> 2026-07-16 已落地 `src/lib/user-config/user-config.unit.test.ts`。

| ID | 场景 | 期望 |
|----|------|------|
| C1 | 仅 env | registry 启用对应 provider |
| C2 | 仅用户库 | 同上 |
| C3 | env 与用户库皆有 | env 覆盖 |
| C4 | API 响应 | 无 key 字段 |
| C5 | 损坏库文件 | 回退 env + warning |
| C6 | round-trip | 解密结果与写入一致，文件不含明文 key |
| C7 | 文件权限 | 用户目录 0700、凭据文件 0600 |
| C8 | 缺 master key | 读取已有 store 明确失败；registry 仍可回退 env |
