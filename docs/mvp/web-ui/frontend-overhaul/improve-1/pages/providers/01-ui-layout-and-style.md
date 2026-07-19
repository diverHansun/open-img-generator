# Providers · UI 布局与样式

## 1. 页面结构

```text
Providers
──────────────────────────────────────────────────────────────
fal.ai       FAL_KEY       Configured · Environment       2/2 ↗ ›
ZenMux       ZENMUX_…      Configured · Encrypted local   1/1 ↗ ›
Silicon…     SILICON…      Not configured                 0/n ↗ ›
… fixed seven providers
```

PageHeader 只有 title/description，不放 Refresh、Add provider、Backend connected 或 Last checked。正文是单一扁平目录，列为 Provider、Credential、Configuration、Models、Actions。

## 2. Provider row

- mark 使用本地统一线性资产；没有可靠官方资产时用中性几何占位，不运行时抓远端 logo。
- 主信息：display name、固定 credential name、真实配置来源、enabled/available model count。
- `Configured via Environment`、`Configured via Encrypted local config`、`Not configured` 是允许的三类摘要；Configured 不等于 Connected。
- Actions 只含官方“申请 API key”外链与详情入口；外链用统一 ExternalLink icon，不使用字符 emoji。
- 行高 48–52px 起步，用 hairline 分隔；hover/focus 为轻 surface，可使用克制的 focus 边界，但不常驻 accent 竖条。

## 3. 响应式与说明

移动端转为 stacked row，顺序为 Provider/credential → source → model count → actions；所有真实信息保持可见。底部安全说明准确表述：“Credentials are resolved locally; saved values are never returned to the browser.”

## 4. 样式边界

- 不使用 Provider card、阴影、健康徽章、彩色品牌大背景或 Add provider CTA。
- Configured 使用 success + 文本，Not configured 使用中性 + 文本；不只显示彩色点。
- 页面通常没有实心主按钮；不要为了满足 accent 配额虚构动作。
- 具体 mark 造型、列宽和 subtle hover 可由实现校准，固定七行与字段真实性不可改变。
