# Models · UI 布局与样式

PageHeader 右侧为 Search models 与 Provider filter。标题下方在有未配置 Provider 时显示轻量提示“还有未配置的 Provider，去配置 →”；没有未配置项时不占位。正文按已配置 Provider 分组，每组标题显示 display name 与 enabled/available 数。模型使用平面 rows：展开箭头、display/model ID、mode 摘要、protocol、default size、Switch。

展开区域使用浅背景和定义列表展示 capability：modes、sizes/aspect ratios、max count、negative prompt、seed 等，只展示 DTO 真实字段。

页面底部显示“X of Y models enabled”。无已配置 Provider 时显示去 Providers 的主动作；不显示七个空模型组。

移动端隐藏低优先级列，把 protocol/default size 放展开区；Switch 始终可见。
