# 品牌说明

open-img generator 的品牌只用黑、白、灰，并且只有浅色版，不使用任何彩色。品牌由两部分组成，**不要混用**：

- **字标**用在 README、分享图、关于页。
- **Logo** 用在界面、favicon、应用图标。

## 文件

| 文件 | 用途 |
| --- | --- |
| `wordmark.svg` | 字标（浅色版，唯一版本），文字已转成路径 |
| `logo.svg` | Logo「显影」，单色，没有底板 |
| `wordmark-plate.svg` | 带白色圆角底板的字标，用在 README 页头，GitHub 深色模式下也能看清 |
| `app-icon.svg` | 应用图标的源文件，1024 画布，浅色圆角底板 |

由这些源文件导出的产物：

- `src/app/icon.svg`：favicon
- `src/app/apple-icon.png`：iOS 主屏图标，180px
- `electron/assets/icon.icns`：macOS 应用图标

界面里使用的 Logo 是 `src/components/shell/brand-logo.tsx`。它的几何形状和 `logo.svg` 完全一致，改动时两边要一起改。

## 字标

- 内容是完整的 `open-img generator`。开头的 `o` 换成细网点组成的圆，网点从左上角的稀疏小点逐渐长大，到右下角融成实心。
- 只有浅色版：`open-img` 用 `#111113`，`generator` 用 `#8a8a93`，必须放在白色或浅灰底上。项目界面不做深浅色切换。
- 字体是 Noto Sans SC（OFL 授权），字重 800，字距 -0.045em。圆的直径约为 0.64em，底部落在基线上。
- 显示高度不要小于 20px，太小时网点会糊成一团。

## Logo「显影」

- 一个方框，里面的斜线从左上往右下越来越粗、越来越密，最后在右下角融成实心，像一张图正在显影。
- 方向和字标的网点一致，都是从左上到右下；形状上一个是线，一个是点，所以不会混淆。
- 只有一种颜色：`#111113`，放在浅色底上使用。
- 最小显示尺寸 16px。四周留白不少于 Logo 宽度的 1/8。
- 不要旋转，不要加描边、阴影、渐变，也不要换颜色。

完整的设计讨论和规范在 Design System 文档里：https://claude.ai/artifact/WhG4dQ93YriJ5JFoesDMYW
