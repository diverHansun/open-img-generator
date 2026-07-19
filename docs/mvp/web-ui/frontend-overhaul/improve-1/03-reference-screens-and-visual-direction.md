# 3. 参考界面与视觉方向

> 用户提供的品牌参考、效果图和 ASCII 排版只用于提炼设计语言与信息结构，不构成逐像素实现或对品牌的复制。最终 UI 必须以本项目真实能力、语义和数据密度为准。

## 3.1 方向结论

目标是一套安静但不寡淡的本地创作工具：图片是内容主角，界面 chrome 后退；操作区具有开发者工具的密度，目录页具有明确列纪律，视觉仍保留适度人文感。

方向短句：**Human clarity / Tool density / Flat hierarchy / Image first**。

固定的是层级、密度、表面和禁用项，不固定某个品牌色：

- 只维护亮色主题；背景可以是偏中性或微冷的浅色，但不是刺眼纯白堆叠。
- 不把陶土色作为主色，也不使用蓝紫渐变、霓虹外发光和多色光晕制造“AI 感”。
- 主强调色是单一纯色，需清爽、有辨识度、能与状态色区分；具体 hue/hex/OKLCH 在首个视觉实现提交中用真实页面校准。
- success、warning、danger 是状态语义，不参与品牌装饰；任何状态同时提供文本或图标，不能只靠颜色。
- 一屏最多一个实心 accent 主动作；accent 不作为大面积背景、正文色或每行装饰。

## 3.2 参考映射：借什么，不借什么

| 参考 | 借用的设计语言 | 明确不借用 |
|---|---|---|
| Claude | 柔和浅色画布、人文温度、克制留白 | serif 大标题、陶土色品牌复刻 |
| Cursor | 浅色画布、accent 稀用、hairline 分层、8–12px 圆角、工具密度 | IDE mock 的营销节奏、过暗代码画布 |
| Linear | 扁平行列表、表面阶梯、稳定列对齐、无卡片堆叠 | 近黑主画布、过度产品化动效 |
| Replicate | 图片优先、模型目录行、浅画布上的清晰 surface | 128px 展示字、全圆角 pill 按钮、品牌外形复制 |
| Runway | 图片即 UI、界面 chrome 后退 | 全黑电影感、沉浸效果压过可读性 |

本项目不是营销站，也不是 IDE。参考的价值在于“怎么组织内容”，而不是“长得像谁”。

## 3.3 页面结构来源

### 3.3.1 Home

```text
┌────────────────────────────────────────────────────────────┐
│ Brand                                         中文 | EN    │ 56–64
├────────────────────────────────────────────────────────────┤
│                                                            │
│                        选择工作区                           │ display only here
│                    创建或进入一个创作空间                   │ muted
│                                                            │
│        ┌──────────────────────────────────────────┐        │
│        │ 选择已有…      │ 新建工作区  [title] [创建] │        │ single surface
│        └──────────────────────────────────────────┘        │
│                                                            │
│ 最近工作区                                                 │
│ [cover/title/stats] [cover/title/stats] [initial/title] …  │ 3–4 columns
└────────────────────────────────────────────────────────────┘
```

- Home 使用顶部品牌条，不使用 Workspace 侧栏。
- 选择/创建共享一个 surface，Create 是该屏唯一实心 accent。
- Recent 卡是可选择对象，因此允许使用卡片边界；无数据时整个 Recent 区不渲染，中央只保留“创建第一个工作区”。
- 不复制 Prompt、模板、团队版、Star、Discord 等参考站业务。

### 3.3.2 Workspace Shell + Generate

```text
┌──────────────┬──────────────────────────────────┬───────────────┐
│ ← 工作区列表 │ Generate                         │ Models 2/2    │
│ Workspace    ├──────────────────────────────────┤ ───────────   │
│ ───────────  │ Session: session-a7f2  编辑 新建 │ [ ] FLUX      │
│ 生成         ├──────────────────────────────────┤ [x] GPT Image │
│ 历史         │ Prompt                           │ ───────────   │
│ 图库         │ ┌──────────────────────────────┐ │ 比例 1:1      │
│ 模型         │ │                              │ │ 张数 1        │
│ 服务商       │ └──────────────────────────────┘ │ Seed          │
│              │ Clear                 Generate   │ Advanced      │
│              ├──────────────────────────────────┤               │
│              │ 结果：fal 进行中 / zenmux 完成   │               │
│ 中文 | EN    │                                  │               │
└──────────────┴──────────────────────────────────┴───────────────┘
     248px              minmax(0,1fr)                   320–360px
```

- WorkspaceShell 桌面使用 248px 完整侧栏；不提供 Home/Settings，占用顶部第一位置的是返回工作区列表。
- 只有 Generate 可以创建 320–360px inspector。Session 是紧凑横条，不是 Workspace 卡。
- Prompt 只出现一次；模型与参数只在 inspector；结果紧跟 composer，不保留 Recent 10。
- generation 进行中，原 Generate 原位变为 danger-outline Cancel，不并排增加第二个主按钮。

### 3.3.3 History

```text
History · 8 sessions · 47 generations · 120 images
─────────────────────────────────────────────────────────────
▾ session-a7f2              12 generations · 30 images · 2h
  [thumb strip +N] Prompt…   fal / FLUX      Completed     2h
  [thumb strip]    Prompt…   zenmux          Completed     3h
  … 10 rows                                  Load more
─────────────────────────────────────────────────────────────
▸ session-b21e               8 generations · 16 images · 昨天
─────────────────────────────────────────────────────────────
                         Previous  1  2  3  Next
```

- Session 为一级组，Generation 为组内扁平行；依靠分隔线、展开和列对齐，不包卡片。
- 每页 5 个非空 Session；每组首批 10 条并可 Load more；最新组默认展开。
- 整行打开 Generation Detail；行内不再放其他动作；不显示 duration、伪百分比或空 Session。

### 3.3.4 Gallery

```text
Gallery
[Workspace ▼] [Provider ▼]                         Newest
─────────────────────────────────────────────────────────────
[ portrait ][ landscape ][ square ][ tall ][ landscape ... ]
[   tall   ][ square    ][ wide                ][ portrait  ]
                    Load more

Preview dialog
┌──────────────────────────────┬──────────────────────────────┐
│                              │ Workspace                    │
│          large image         │ Provider / model             │
│                              │ time · prompt                 │
│                              │ View generation detail       │
└──────────────────────────────┴──────────────────────────────┘
```

- 使用图片原始比例形成参差错落的 masonry-like 节奏，gutter 细，默认无常驻标签和厚卡框。
- hover/focus/tap 只显示 model、时间和 Favorite 图标；完整来源由预览弹层右侧信息区承载。
- 第一批只有 Workspace、Provider 筛选；Newest 固定，不做搜索、方向、下载、多选或 Favorites only。
- 不因视觉 masonry 破坏 DOM/键盘阅读顺序；实现选择见 `shared/04-responsive-and-accessibility.md`。

### 3.3.5 Models / Providers

```text
Models                                  [Search…] [Provider ▼]
还有未配置的服务商，去配置 →
─────────────────────────────────────────────────────────────
fal.ai                                                   2/2
  ▸ FLUX Schnell   fal-ai/…    async          [switch on]
  ▸ FLUX Dev       fal-ai/…    async          [switch off]
─────────────────────────────────────────────────────────────

Providers
─────────────────────────────────────────────────────────────
fal.ai       FAL_KEY      Configured · Environment    2/2  ↗ ›
ZenMux       ZENMUX_…     Configured · Local encrypted 1/1 ↗ ›
Silicon…     SILICON…     Not configured               0/n ↗ ›
```

- 两页都使用 Linear 式扁平目录，不为每个 Provider/Model 创建卡片。
- Model 主行只保留识别与启用所需字段：display name、model ID、必要 mode/protocol 摘要和 Switch。详细 capability 按需展开，禁止虚构字段。
- Search/Provider filter 只在 Models 使用，且为客户端轻量过滤；不新增价格、健康、默认尺寸等无可靠来源字段。
- Providers 不提供 Add provider、Connected、Last checked 或 Refresh；只显示真实配置来源、凭证名、模型数、申请 key 外链与详情入口。

### 3.3.6 Provider Detail

```text
← Providers
fal.ai · FAL_KEY
Configured via Environment
本凭证由 .env 管理（只读，无输入）

或 user-config：
API key  [password draft                         show/hide]
          留空后保存将清除已保存密钥
          还没有 key？去申请 ↗
                                                    [Save]
```

- `.env` 来源只读：没有输入、Save 或 Clear。
- user-config 只显示空的 draft password field；小眼睛只能显隐当前输入，绝不回显已保存值。
- 清空已配置 draft 后 Save 表示删除；不另设 Clear；Save 是该页唯一实心 accent 动作。
- UI 不使用眼睛 emoji；实现使用统一图标库中的 Eye/EyeOff，并提供可访问名称。

## 3.4 统一排版与表面规则

- Home 的 Display 为 32–40px；Workspace 页面 H1 为 24–28px；不使用 serif 展示标题。
- 目录主行高 48–52px；常规控件高 40px；间距以 4/8/12/16/24/32/48px 建立节奏。
- ID、credential name、session 名与计数可使用等宽字体和 tabular nums；正文保持 sans-serif。
- chip 约 6px、Button/Input 约 8px、Card/Dialog 约 12px、图片预览/Workspace card 约 16px；按钮是圆角矩形，不做全 pill 化。
- canvas → surface → subtle → hairline 构成主要层级。常规 section 无阴影；Dialog/Popover 最多一级轻阴影。
- 卡片只用于独立可选择对象或媒体预览；History/Models/Providers 依赖平面行和分隔线。
- 使用少量统一线宽图标；不使用 emoji、装饰性图标雨或无功能占位图标。

## 3.5 视觉禁区

1. 蓝紫渐变、霓虹光晕、玻璃拟态和大面积品牌色背景。
2. 用十几个相近白色卡片制造层级，或卡片内再嵌同等级卡片。
3. 将所有按钮做成 pill，或一屏出现多个实心 accent 主按钮。
4. 把 accent 当正文色、面积背景或每行固定装饰。
5. 在非 Generate 页面保留空 inspector、Workspace selector 或 Backend connected 重复徽章。
6. 显示后端未提供的 Connected、Last checked、duration、进度百分比、价格或模型能力。
7. 用 emoji 代替产品图标；用 hover 作为唯一信息入口。
8. 为追求参差图片墙破坏 DOM 阅读顺序、焦点顺序或布局稳定性。

## 3.6 允许实现模型发挥的范围

在不违反以上契约时，实施可以自主调整：

- 主强调色的具体 hue、明度与饱和度；canvas 的中性/微冷倾向；
- 8–12px 范围内的局部圆角、1px 边界透明度、页面间具体留白；
- Home Workspace cover 的占位构图与 Gallery 网格的列宽算法；
- 字体实际 fallback、轻量 hover/press 过渡和图标尺寸；
- 中英文不同字长下的列宽和换行策略。

任何调整都必须先满足可读性、真实状态和可访问性，再评价“高级感”。不以参考图像素相似度作为验收目标。

## 3.7 验收方式

- 在 1440、1024、390px 三档对 Home、Generate、History、Gallery、Models、Providers、Provider Detail 截图走查。
- 同时检查正常、空、loading、error、长 Prompt/模型名和中英文状态。
- 重点寻找：卡片堆叠、过多 accent、蓝紫渐变、emoji、pill 泛滥、空白 inspector、常驻 Gallery 标签和虚假字段。
- 不建立依赖字体抗锯齿或固定色值的像素快照；用层级、密度、语义和交互行为验收。
