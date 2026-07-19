# 响应式与可访问性

## 1. 质量优先级

优先保证：主流程可达 > 状态/错误可理解 > 键盘与触控可操作 > 桌面信息密度 > 装饰一致性。移动端不要求保留桌面所有列，但不得删除进入详情、状态、Provider/Workspace 来源等关键语义。

## 2. 响应式策略

| 宽度 | 壳 | 内容策略 |
|---|---|---|
| `>=1180` | 完整 Workspace 侧栏 | 表格式行、Generate inspector 并排、Gallery 多列 |
| `920–1179` | 完整或稍窄侧栏 | 隐藏低优先级列，inspector 折叠到页内 |
| `620–919` | 顶栏 + drawer | 列表改 stacked row，filters 可横向滚动/折叠 |
| `<620` | 顶栏 + drawer | 单列表单、触控 actions、Gallery 1–2 列 |

组件用 container/content 条件优先，不依赖设备名称。长 Prompt、Workspace title 和 model ID 必须可换行/截断且有查看完整内容的方法。

## 3. 键盘

- Tab 顺序遵循视觉和 DOM 阅读顺序。
- Enter/Space 可操作 Switch、Session 展开/折叠、密码小眼睛、Favorite。
- 列表行如果整体可点击，内部按钮必须避免嵌套交互元素；History 行内不放置其他交互控件，整行点击打开 Detail 弹层。
- Escape 关闭 drawer/dialog/popover；关闭后焦点返回触发元素。
- Load more 完成后焦点不跳到页面顶部；新增内容通过 live region 简短播报。
- 弹层（Dialog）打开时焦点进入并锁定背景滚动；任何时刻只存在一个弹层，从预览弹层进入 Detail 弹层时先关闭前者并让焦点落到新弹层。

## 4. 屏幕阅读器与语义

- 主区域 `<main>`、侧栏 `<nav>`、页面标题唯一 `<h1>`。
- Providers/Models/History 桌面若使用 table，保证 header/scope；移动可保持 table 可滚动或使用语义 list，不用视觉 div 假表格而无 label。
- 状态更新使用适度 `aria-live="polite"`；轮询每次 tick 不重复播报相同状态。
- 图像 alt：生成图使用简短 Prompt 摘要；纯装饰/provider mark 用空 alt；错误占位有文字。
- 字段 error 通过 `aria-describedby` 与输入关联。

## 5. Secret 输入

- label 明确为固定 credential name，如 `FAL_KEY`。
- 默认 `type=password`；眼睛按钮 label 在“Show current input”/“Hide current input”间切换。
- 不用一串圆点表示服务端已保存密钥，以免暗示可以回显；使用独立 `Configured via …` 文本。
- Save 成功后清空 DOM value、React state 和可见状态；浏览器 autocomplete 策略实施时按本地工具实测决定。
- 已配置 user-config 的清除由“空输入 + Save”明确触发，不另设 Clear 或确认弹层；env 来源不显示可执行编辑动作。

## 6. 颜色、焦点和运动

- 常规文字/背景达到 WCAG AA；禁用文字仍需可读。
- focus ring 不只改变颜色，至少 2px 轮廓或等价明显效果。
- success/warning/error 同时有文本/图标。
- 支持 `prefers-reduced-motion`；skeleton/transition 不导致眩晕。

## 7. 图片与 Gallery

- 图片加载保留尺寸/比例，避免布局跳动。
- hover overlay 同样可由 focus/tap 打开；Gallery 图片无常驻信息标签，hover/focus 只浮现 model、收藏时间与统一 Favorite 图标；完整来源信息由预览弹层信息卡承载。
- CSS columns 若导致 DOM/视觉阅读顺序不一致，优先规则 grid；审美不能优先于可达顺序。
- 图片预览弹层需要 alt、关闭按钮/ESC/遮罩点击的键盘语义；本批不做上一/下一张切换与复杂 lightbox。

## 7.1 图标与非文字内容

- UI 不使用 emoji 充当导航、状态、收藏、显示密码或主动作图标。
- 采用统一线性图标集并保持相近 stroke/尺寸；装饰图标使用空替代文本，交互图标必须有可访问名称。
- 状态图标不能替代文字；Provider mark 无官方本地资产时使用一致的中性几何占位，不从远端临时抓 logo。

## 8. 可恢复错误

页面级错误有 Retry 与返回入口；行级保存错误就地显示；Load more 错误保留已有 items。认证失败遵循现有登录门，不在每页重复一套弹窗。404 不暴露其他 Workspace 的资源内容。成功反馈使用 toast（自动消失，不打断焦点流）；错误一律就地展示并可被屏幕阅读器感知。

## 9. 人工检查

使用键盘、VoiceOver（或等价）、200% zoom、390px 宽、reduced motion 检查各页关键路径。重点验证移动 drawer、双层分页、组折叠、Switch saving、密码显隐、图片 hover/focus overlay、预览与 Detail 弹层焦点流转、轮询状态播报，以及中/英文切换后的排版溢出。
