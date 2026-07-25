# Windows Web Runtime 适配

> 议题日期：2026-07-23
>
> 状态：`improve-1` 已实施，等待目标环境与人工验收
>
> 文档目录沿用仓库既有 `probelm-list` 拼写；本批不做无关目录重命名。

## 目标

让 Windows x64 开发者通过 `npm run dev` 启动本机 Next.js，并使用 Edge/Chrome 访问；统一数据库、图片、配置和日志路径，同时保持 macOS 和现有 Electron 行为不回退。

## 批次

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| `improve-1` | Windows Web 开发运行时、统一路径策略、浏览器验收、Windows x64 CI | 已实施，待 Node 24 CI、浏览器及 macOS desktop smoke 验收 |
| `improve-2` | Windows Electron、x64 NSIS `.exe`、生命周期、安全存储与签名 | 后续另行讨论，尚未建立实施契约 |

## 文档地图

- [`improve-1/README.md`](./improve-1/README.md)：范围、阅读顺序和实施契约说明。
- [`improve-1/00-discussion.md`](./improve-1/00-discussion.md)：用户已确认的目标与边界。
- [`improve-1/01-problem-analysis-and-current-state.md`](./improve-1/01-problem-analysis-and-current-state.md)：当前代码基线、问题编号和风险。
- [`improve-1/02-optimization-plan-and-change-scope.md`](./improve-1/02-optimization-plan-and-change-scope.md)：后续实施会话的文件级改动契约。
- [`improve-1/04-test-and-acceptance.md`](./improve-1/04-test-and-acceptance.md)：测试矩阵、CI 门禁和人工验收。
- [`docs/plans/2026-07-23-windows-web-runtime-design.md`](../../../plans/2026-07-23-windows-web-runtime-design.md)：已确认设计总览。

## 关于 03

本议题没有采用外部参考项目，因此不创建空的 `03-reference-projects.md`。Next.js、Node.js 等官方资料在设计总览和相关正文中直接引用。
