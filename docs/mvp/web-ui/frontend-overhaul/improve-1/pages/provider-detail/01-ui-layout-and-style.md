# Provider Detail · UI 布局与样式

## 1. 页面结构

```text
← Providers
fal.ai · FAL_KEY
Configured via Environment
本凭证由 .env 管理（只读，无输入）

或 user-config：
API key  [password draft                         show/hide]
          留空后保存将清除已保存密钥
          还没有 key？去申请
                                                    [Save]

──────────────────────────────────────────────────────────────
Available models / capabilities
flat definition rows
```

PageHeader 提供返回 Providers、Provider mark/name、固定 credential name 与真实配置摘要。正文是 Configuration 与 Available models/capabilities 两个平面 section，不套卡。

## 2. Environment 来源

- 只显示变量名、`Configured via Environment` 和“Edit `.env`, then restart the app”说明。
- 不显示 input、Save、Clear 或可编辑假状态。
- 页面仍可显示官方申请 key 外链，但必须明确它不会覆盖当前 env 来源。

## 3. User-config 来源

- PasswordField 初始为空，默认隐藏；eye 只切换当前 draft，绝不渲染 masked saved secret。
- 输入旁说明“已保存值不会返回浏览器”；已配置时再说明“留空并保存将清除已保存密钥”。
- 不提供独立 Clear/Confirm；Save 是该页唯一实心 accent 动作。
- 保存成功后 draft 和显示状态复位；错误紧贴表单，不用 toast 隐藏失败原因。
- show/hide、ExternalLink 等均使用统一线性 icon 和 accessible label，不使用 emoji。

## 4. Capability section

使用 Provider/model 分组的 definition rows，只展示真实 capability。不开模型卡、价格栏、Connected、Last checked 或远端 health。

## 5. 响应式与样式边界

- 桌面表单保持适中宽度，不把 password input 拉满整个主区；Save 与表单对齐。
- 移动端 input/action 纵向排列，eye 保持输入尾部 icon button；帮助文案不截断删除语义。
- 常规 section 无阴影；Dialog 仅用于真正的共享 Detail/Preview，不为 Provider 配置再套弹层。
- 青瓷/茉莉绿家族内的具体明度、表单宽度和 section 间距可校准，env 只读和 secret 不回显不可改变。
