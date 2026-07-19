# 共享设计语言与 CSS Tokens

## 1. 目标

为七个路由页面及共享弹层提供一致的颜色语义、字体、间距、边界与状态语言，同时允许每页形成自己的内容节奏。共享层不是营销站主题，也不追求覆盖所有可能组件。

本文件冻结 token 角色和约束，不冻结最终品牌色数值。首个视觉实现提交必须用 Home、Generate、Gallery、Providers 四种不同页面校准实际色值，再统一写入 `:root`；组件不得自行挑选颜色。

## 2. CSS 分层

```text
src/app/globals.css                 tokens + reset + Tailwind 入口；不放页面规则
src/components/ui/                  shadcn/ui primitives + CSS variable 映射
src/components/shell/*.module.css   Home/Workspace 壳、品牌条、侧栏
src/components/<page>/*.module.css  单页布局、网格与局部响应式
src/components/dialogs/*.module.css Detail / Preview 弹层布局
```

技术栈：Tailwind CSS + shadcn/ui（Radix UI 底层，源码复制型）。tokens 以 CSS variables 定义于 `:root` 并映射到 Tailwind theme；CSS Modules 与 Tailwind 必须消费同一组 variables。

实施约束：

1. `globals.css` 最终只保留 tokens、reset、字体/body 和 Tailwind 入口；当前约 1700+ 行的页面私有规则按纵切迁移后删除。
2. `components/ui/*` 以 shadcn 可访问性与状态模型为基线，但外观必须消费本项目 tokens。
3. 壳、页面和弹层分别使用 CSS Modules；禁止页面用全局 class 互相覆盖。
4. 不引入 Ant Design/MUI 等运行时组件库，不为 masonry 引入重型运行时。
5. 不保留旧 `.app-shell` 三栏、卡片阴影体系、重复参数区或 Backend connected 微章的“兼容样式”。

只维护一套亮色主题，不做明暗切换，也不预留空的 dark-mode 变量分支。

## 3. 颜色 token：固定语义，不固定 hue

实现必须提供以下 token；具体 hex/OKLCH 在视觉实现首提交中确定：

| Token | 角色 | 约束 |
|---|---|---|
| `--color-canvas` | 页面画布 | 浅色、中性或微冷；不可刺眼纯白，不做渐变 |
| `--color-surface` | 输入组合、弹层和可选择对象 | 与 canvas 形成清晰但克制的阶梯 |
| `--color-surface-subtle` | hover、展开区、次级分组 | 不得像第二主按钮 |
| `--color-ink` | 主文字 | 高对比、中性，不带品牌色 |
| `--color-ink-muted` | 元信息 | 仍满足可读对比度 |
| `--color-ink-faint` | 极次要辅助 | 不用于关键状态、字段 label 或错误 |
| `--color-line` | 1px hairline | 负责目录分层，不用阴影替代 |
| `--color-accent` | 主动作、active nav、focus | 单一纯色、清爽且有辨识度；不固定陶土或蓝紫 |
| `--color-accent-soft` | 选中/hover 的浅色面 | 只作小面积状态面，不作页面背景 |
| `--color-success` | completed/configured | 只用于真实成功语义 |
| `--color-warning` | pending/running/需注意 | 不伪造进度 |
| `--color-danger` | failed/destructive/cancel | Cancel 使用 outline，不抢占主动作层级 |
| `--color-focus` | 键盘焦点 | 可与 accent 同源，但必须在 canvas/surface/图片上可见 |

颜色规则：

- 不把陶土色作为默认主色；不使用蓝紫渐变、霓虹外发光、多色 glow 或玻璃拟态表达“AI”。
- 每个颜色必须有代表意义；不要为了“丰富”增加相近色相。状态色不承担装饰。
- 一屏最多一个实心 accent 主动作。accent 不用于大面积背景、正文、全部链接或每个列表行。
- 颜色不是唯一信号：状态需配文本或统一图标；focus 需有至少 2px 轮廓。
- 禁止在组件中写死颜色字面值；视觉调色只能改 tokens。

## 4. 固定的结构 tokens

以下数值来自已确认的排版密度，可在响应式下按文档允许范围微调：

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --content-max: 1440px;
  --sidebar-width: 248px;
  --inspector-width: clamp(320px, 24vw, 360px);
  --home-brand-bar-height: 60px;
  --control-height: 40px;
  --directory-row-height: 50px;
}
```

按钮和输入采用 8px 左右的圆角矩形，不做默认 pill。chip/小状态片可用 6px；卡片/弹层约 12px；图片预览/Workspace 卡可到 16px。列表行通常无圆角。

## 5. 字体与密度

字体：`Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`；中文 fallback 使用 `PingFang SC` / `Noto Sans SC`。model ID、credential name、session 标识使用 `JetBrains Mono` 或可靠系统等宽 fallback，并启用 tabular nums。

| 层级 | 尺寸 / 字重 / 行高 | 用途 |
|---|---|---|
| Display | 32–40 / 600 / 1.15 | 仅 Home 主标题 |
| Page H1 | 24–28 / 600 / 1.2 | Workspace 页面标题 |
| Section | 16–18 / 600 / 1.3 | 主要 section / Provider group |
| Body | 14–15 / 400 / 1.5 | 正文、Prompt、表单说明 |
| Row primary | 13–14 / 500 / 1.4 | History/Models/Providers 主行 |
| Meta | 12–13 / 400 / 1.4 | 来源、时间、计数 |
| Code/ID | 12–13 / 400 / 1.4 | model/credential/session ID |

- 常规控件高 40px；History/Models/Providers 目录行最小 48–52px。
- 长 Prompt 默认截断两至三行，通过 Detail 获取完整内容；不把页面行高无限撑开。
- 不用 serif 大标题、128px marketing display 或过细浅灰正文。

## 6. 表面与动作规则

1. 页面大 section 默认无外框，使用标题、间距和 hairline 分组。
2. History/Models/Providers 用水平分隔线和列对齐；hover/focus 使用 subtle surface，不逐行加卡片。
3. 卡片只用于独立可选择对象：Home Workspace、媒体预览、明确空态引导。
4. 常规内容无投影；Dialog/Popover 允许一级轻阴影，阴影只定义一个 `--shadow-float` token。
5. 一屏最多一个实心 accent 主动作；secondary 使用 outline/ghost/text。
6. Generate 进行中，主按钮原位变为 danger-outline Cancel；不出现两个并列主按钮。
7. 图标来自统一线性图标集（首选 lucide-react），统一线宽；不使用 emoji 作为界面图标。

## 7. 状态语义

| 状态 | 文案/色彩 | 禁止 |
|---|---|---|
| completed/configured | success + 明确文本 | 只显示绿色点；写成 Connected |
| pending/running | warning + 状态文本 | 伪造百分比、duration |
| failed | danger + 简短错误 + 详情 | 用红色装饰普通信息 |
| cancelled | 中性 + 文本 | 与 failed 混同 |
| disabled/not configured | muted + 原因 | 表现为页面损坏 |

Configured 不等于 Connected。Backend health、credential source 和实际生成成功是三个独立概念。

## 8. 动效

- 页面切换不做大幅 slide、粒子或渐变流动；浏览器导航配轻微 opacity 即可。
- loading skeleton 只在结构已知且等待明显时使用；短请求用按钮级 spinner。
- hover/press 过渡建议 120–180ms，不改变布局；`prefers-reduced-motion` 下关闭非必要动效。
- 状态更新不得闪烁、跳动或自动滚走用户焦点。

## 9. 验收

- 无三级卡片嵌套、全 pill 按钮、蓝紫渐变、emoji UI 或页面级阴影体系。
- 无页面私有选择器残留在 `globals.css`，无组件写死颜色字面值。
- 同屏实心 accent 主动作不超过一个；状态颜色与品牌 accent 不混用。
- focus ring 在 canvas、surface 和图片上均可见；常规文字满足 WCAG AA。
- 同一状态在七个路由页面与共享弹层使用同一文案和颜色语义。
- 具体 palette 可以迭代，但 token 名、用途与禁用项不能被页面私自改写。
