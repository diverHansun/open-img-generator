# Provider Detail · 测试与验收

## Critical Scenarios

- 初始 DOM/input 不含已保存 secret；眼睛只显示当前 draft。
- Save/Replace 成功写正确固定 key，清空 draft；其他 keys 保留。
- 已配置 user-config 空输入 + Save 仅删目标 key；没有 Clear 控件或确认弹层；重复删除行为稳定。
- 未配置 user-config 空输入 + Save 就地提示且不发请求；env source 无 input/Save，直接 API 写/删返回 409。
- 缺 encryption key、错误 key、损坏 envelope 不破坏文件且错误无 secret。
- 两个 Provider 并发保存无 lost update。
- canary secret 不出现在 JSON、error、console、URL、snapshot。
- Kling 写 `KLING_API_KEY`，绝不写 `DASHSCOPE_API_KEY`。

## Strategy

provider-config unit；route contract allowlist；临时目录/真实加密 integration；并发 Promise integration；浏览器检查 password/eye、空值 Save、toast/focus。

## Acceptance

满足 E05–E11、F03、F11；Save 是 user-config 表单唯一实心 accent；env 来源无输入；未来存储替换不会要求 UI DTO 暴露文件或数据库字段。
