# Provider Detail · UI 布局与样式

PageHeader 带返回 Providers、Provider mark/name、配置状态。正文为两个平面 section：Configuration 与 Available models/capabilities。

Configuration 使用 definition rows 展示 Credential name、Source、Status。密钥输入只在 source 非 env 时出现：label 为固定 env name，password field + eye + Save。已配置不渲染圆点占位 password；显示“Saved value is not available to the browser”。不提供 Clear 按钮：对已配置 user-config，留空并 Save 即清除；该帮助文案紧靠输入框，避免隐藏删除语义。

Environment 来源显示只读说明、变量名和“Edit `.env`, then restart the app”；不显示 input/Save 或清除动作。表单旁保留“申请 API key ↗”官方外链，供需要获取/替换密钥的用户使用。

Capabilities 用分组 rows/definition list，不用模型卡片。移动端输入 actions 纵向，眼睛保持输入尾部 icon button。
