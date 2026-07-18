# 共享设计语言与 CSS Tokens

## 1. 目标

为七个路由页面及其共享弹层提供一致的颜色、字体、间距、边界与状态语言，同时允许每页独立布局。共享层不是完整设计系统包，不追求覆盖所有可能组件。

## 2. CSS 分层

```text
src/app/globals.css              Tailwind 入口、reset、字体、body、全局 tokens（CSS variables）
src/components/ui/               shadcn/ui primitives（组件内样式走 Tailwind，消费 tokens）
src/components/shell/*.module.css 两种壳与导航的布局
src/components/<page>/*.module.css 页面局部组合和响应式
```

技术栈：Tailwind CSS + shadcn/ui（Radix UI 底层，源码复制型）。tokens 以 CSS variables 定义于 `:root`，同时映射进 Tailwind theme，使 Tailwind 类与 CSS Modules 消费同一套数值。禁止引入 Ant Design / MUI 等运行时组件库；禁止页面用全局 class 名互相覆盖；禁止在 `globals.css` 继续追加只服务单页的复杂 grid。已有全局样式按页面迁移后删除，不保留"也许以后用"的死规则。

主题：只维护一套亮色暖白主题，不做明暗切换，不预留 `prefers-color-scheme` 分支变量。

## 3. Token 建议

实施时以现有 OKLCH 暖白/陶土色为基准，可按对比度微调：

```css
:root {
  --color-canvas: oklch(0.975 0.01 80);
  --color-surface: oklch(0.99 0.006 80);
  --color-surface-subtle: oklch(0.955 0.012 75);
  --color-ink: oklch(0.23 0.02 55);
  --color-ink-muted: oklch(0.5 0.02 60);
  --color-line: oklch(0.88 0.015 70);
  --color-accent: oklch(0.57 0.15 38);
  --color-accent-soft: oklch(0.93 0.035 45);
  --color-success: oklch(0.55 0.13 145);
  --color-warning: oklch(0.68 0.15 75);
  --color-danger: oklch(0.53 0.18 25);
  --color-focus: oklch(0.62 0.15 250);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --shadow-float: 0 12px 32px oklch(0.25 0.02 55 / 0.12);
  --content-max: 1440px;
  --sidebar-width: 248px;
  --home-brand-bar-height: 60px;
  --control-height: 40px;
}
```

数值是实施起点，不是对视觉像素的永久冻结；修改时必须保持语义名和全局一致性。这些变量同时映射为 Tailwind theme 的颜色/间距/圆角刻度（shadcn/ui 的 `bg-accent`、`text-ink-muted` 等语义类由此派生），禁止在组件里写死十六进制/OKLCH 字面值。

## 4. 字体与密度

| 层级 | 建议 | 用途 |
|---|---|---|
| Display | 40/1.1，600 | Home 核心标题，仅一处 |
| Page title | 32/1.15，650 | Workspace 页面标题 |
| Section | 20/1.3，600 | 页面主要 section |
| Body | 15/1.55，400 | 正文、Prompt |
| Row primary | 14/1.4，550 | 表格主信息 |
| Meta | 12–13/1.4，400 | ID、来源、时间 |

长 Prompt 最多显示两到三行并提供完整 title/详情入口；model ID 可用 `font-variant-numeric: tabular-nums` 或等宽字体。不得把辅助文字降到不可读的低对比度。

## 5. 表面规则

1. 页面大 section 默认无外框，使用标题、间距和下边线分组。
2. 表格/目录行用水平分隔线；hover/focus 使用轻背景，不逐行加圆角卡片。
3. 卡片只用于可独立选择的对象：Home Workspace、媒体预览、空状态主引导。
4. Dialog/popover 才使用 `--shadow-float`；常规内容不使用阴影。
5. 一个屏幕最多一个实心主按钮组，次要动作使用 outline/text。

## 6. 状态语义

| 状态 | 文案/色彩 | 禁止 |
|---|---|---|
| completed/configured | 绿色点 + 明确文本 | 只用绿色无文本 |
| pending/running | 警示色 + 状态文本 | 伪造百分比 |
| failed | 红色 + 简短错误 + 详情 | 用红色装饰所有 destructive 以外元素 |
| cancelled | 中性灰 + 文本 | 与 failed 混同 |
| disabled/not configured | 灰色 + 原因 | 表现为页面坏掉 |

Configured 不等于 Connected。Backend health 与 Provider credential source 是两个独立概念，不共用徽章文案。

## 7. 动效

- 页面切换不做大幅 slide；使用浏览器导航和轻微 opacity 即可。
- loading skeleton 只在结构已知且等待明显时使用；短请求用按钮级 spinner。
- 状态更新不得通过闪烁或跳动改变布局。
- `prefers-reduced-motion: reduce` 时关闭非必要 transition/animation。

## 8. 验收

- 无三级卡片嵌套。
- 无页面私有选择器残留在全局命名空间。
- focus ring 在暖白、强调色和图片上均可见。
- 文本与背景满足 WCAG AA 的常规对比要求。
- 同一状态在七个路由页面与共享弹层使用同一文案和颜色语义。
