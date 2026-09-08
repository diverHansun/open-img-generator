# Improve 1 实施与验收记录

> 日期：2026-09-08
>
> 结果：实施完成，复检通过

## 已交付

- 新收藏先将 remote 图片转为 managed；落盘失败不写 favorite，并回滚乐观红心。
- Node 下载失败时，同一次点击尝试浏览器回传字节；两条路径都失败才向用户报错。
- 存量 live remote 收藏只在用户点击“保存到本地”时补存；墓碑保留收藏关系并显示“原图已删除或丢失”。
- 生成页、详情弹窗、Gallery 共用顶部提示卡片，统一停留 3 秒；不可恢复、本地写入和可重试错误使用不同文案。
- 设置 API 只返回 `images/`；Electron 通过受信桥接打开当前设备应用数据目录下的实际图片目录。
- Node 版本固定到受支持范围，并补齐 Electron CommonJS 迁移编译与运行目录权限边界回归。

## 自动化验收

- Node 24 全量测试：101 个测试文件通过、669 项通过，1 项 Windows 专用用例按平台跳过。
- 新增 Stage 2 集成链路：浏览器字节流落盘 → remote promote → 再收藏，最终 GalleryItem 为 managed。
- Next.js production build、Electron CommonJS compile、macOS arm64 打包与 desktop runtime smoke 通过。

## Electron E2E

- 设置页“打开图片目录”按钮可用，系统文件管理器打开 `Application Support/open image generator Development/images/`。
- 收藏失败场景中红心回滚；工作区顶部提示出现并在约 3 秒后自动收起。
- 验收使用的临时工作区、Generation 与图片记录已在完成后清理。

## 约束仍然成立

- 浏览器回传受 CDN CORS 与浏览器网络能力限制，是同次点击的 best-effort 兜底，不是通用代理。
- pin 仅接受 live remote 图片，并继续执行大小、图片魔数、受管路径与存储所有权校验。
- 普通 Gallery 加载和保留期清理不会自动补钉；未收藏图片继续遵循原有保留期清理。
