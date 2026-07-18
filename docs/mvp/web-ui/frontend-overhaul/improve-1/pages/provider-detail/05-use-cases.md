# Provider Detail · 用户用例

## Use Case Overview

1. Inspect Credential Source。
2. Save Or Replace Local Credential。
3. Clear Local Credential By Empty Save。
4. Understand Environment-managed Credential。

## Main Flows

### Save/Replace

打开未配置/user-config Provider → 输入新值（可临时显示）→ Save → 服务端固定映射、合并并加密写 → 返回摘要 → 清空输入。

### Clear By Empty Save

已配置 user-config → 清空输入 → Save → 服务端只移除目标 key → 返回 none 摘要 → toast 确认已清除。没有独立 Clear 或确认步骤。

### Environment-managed

页面显示 env 来源和变量名 → 不提供编辑动作 → 用户在应用外修改 `.env` 并重启/刷新。需要凭证时可打开表单旁官方申请 key 链接。

## Responsibility Boundaries

页面不拥有已保存 secret；service 不负责远端 probe；adapter 只在真实生成时消费解析凭证。

## Failure Points

错误 encryption key、损坏文件、并发写、env 竞态、未知 Provider。预期行为是拒绝且不破坏旧数据、不泄密、不谎称成功。
