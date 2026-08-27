# Provider Detail

## Design Goals

- 让用户安全配置固定 Provider 的 API credential，同时永不回显已保存值。
- 明确区分 Environment 和 Encrypted local config 两种来源。
- 让未来把存储迁到数据库时不必改变浏览器契约。

## Duties

1. 展示 Provider identity、credential name、source 与真实 capability。
2. 对可编辑 user-config 来源 Save/Replace credential；已配置时清空输入再 Save 即清除。
3. 当前新输入默认隐藏并可临时显示。
4. 处理 encryption key、env managed、损坏配置等安全错误。

## Non-Duties

- 不查看已保存或 `.env` 明文。
- 不允许任意 credential name。
- 不提供独立 Clear 按钮或删除确认弹层。
- 不真实测试连接、不显示余额/Last checked。
- 不修改模型偏好。

路由：`/workspace/:projectId/providers/:providerId`。
