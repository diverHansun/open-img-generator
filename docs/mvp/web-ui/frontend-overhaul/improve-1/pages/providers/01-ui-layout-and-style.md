# Providers · UI 布局与样式

PageHeader 只有 title/description，不放 Refresh、Add provider，也不重复 Backend connected。正文为单一目录表：Provider、Configuration、Models、Action。

每行包含品牌 mark（可用统一线性占位，不依赖远端 logo）、display name、credential name、`Configured via Environment` / `Configured via Encrypted local config` / `Not configured`、enabled/available model 数、官方“申请 API key ↗”外链与 chevron/detail link。

行使用分隔线；hover/focus 轻背景与左侧细 accent。Configured 使用绿色点但必须带文本；Not configured 中性灰，不当成错误。

移动端变 stacked row，配置来源、模型数和申请 key 链接仍可见。外链以新标签打开并带 `rel="noopener noreferrer"`。底部安全说明准确表述：“Credentials are resolved locally; saved values are never returned to the browser.”
