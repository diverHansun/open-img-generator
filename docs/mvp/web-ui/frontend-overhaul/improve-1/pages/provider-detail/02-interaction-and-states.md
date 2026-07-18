# Provider Detail · 交互与状态

## Secret draft

初始值始终为空、`type=password`。眼睛只切换当前 draft。切 route/provider、保存成功、清除成功或页面卸载时清空 draft 并恢复隐藏；不写 localStorage/query。它从不显示已保存 secret。

## Save/Replace

对未配置来源，trim 空值不提交，在输入框就地提示“请输入 API key”。对已配置 user-config，trim 空值加 Save 映射为 DELETE；非空值才 PUT。点击后锁定表单，PUT/DELETE 成功以返回摘要更新 configured/source、清空 draft 并给 toast；失败保留 draft 便于修正，但错误文案不拼接 value。source 在请求期间变为 env 时，409 后保留当前输入直到用户离开，同时明确未保存。

## 空输入清除

仅 source=user-config 且 configured 时，空输入 + Save 清除加密本地值；没有独立 Clear 按钮或确认 dialog。成功后 source=none 并 toast。source=env 不显示可执行编辑动作。

## Invalid provider/error

未知 providerId 404。缺 `USER_CONFIG_ENCRYPTION_KEY` 显示服务端配置说明；损坏文件提示修复/查看服务端日志，不显示路径、ciphertext 或 stack。
