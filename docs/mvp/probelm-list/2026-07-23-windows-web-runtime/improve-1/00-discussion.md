# 讨论记录与已确认要点

> 2026-07-23 与用户逐节讨论定稿。本文只冻结有效结论；分析与实施方案见 01、02、04。

## 1. 背景与动机

项目已经完成 macOS Web/Electron 适配，下一阶段需要覆盖 Windows。用户决定先解决 Windows 本机启动 Next.js 后通过浏览器使用的开发模式，不让 Electron 打包、签名和安装器阻塞 Web 适配。

## 2. 已确认：目标与范围

| 决策项 | 结论 |
| --- | --- |
| 首批使用方式 | Windows 用户在仓库执行 `npm run dev`，浏览器访问本机 Next.js |
| 架构 | 采用统一运行时路径策略，不增加 `dev:win` 或 Windows 专属业务分支 |
| 开发数据 | 继续保留在仓库 `./data/`，不迁移现有数据 |
| production 路径 | Windows production 模式使用 `%LOCALAPPDATA%/Open Image Generator/`；本批只预置并测试路径解析 |
| 目标架构 | Windows x64；Node.js 24 LTS x64 |
| 浏览器 | 现代浏览器兼容，Edge/Chrome 为首要验收对象 |
| canonical origin | 只文档化并启动 `http://localhost:3000`，避免与 `127.0.0.1` 分裂浏览器存储 |
| 环境覆盖 | `DATABASE_URL`、`LOCAL_STORAGE_DIR`、`USER_CONFIG_DIR`、`APP_LOG_DIR` 继续拥有最高优先级 |
| 环境加载 | 迁移、Drizzle 与 Next.js 必须遵循相同 `.env*` 规则 |
| Windows 路径 | 支持盘符、反斜杠、空格和中文；首批拒绝 UNC/网络共享路径 |
| 权限 | POSIX 保持 `0700/0600`；Windows 不断言无意义的精确 POSIX mode，继承用户 ACL |
| 下载 | Web 版仍由浏览器管理默认下载位置，不引入原生目录选择 |
| 测试 | 沿用 Unit/Contract/Integration/Smoke，不引入 Playwright，不调用真实 Provider |
| CI | 新增 GitHub Actions Windows x64 门禁，覆盖安装、类型检查、测试、构建和启动冒烟 |

## 3. 已确认：本批不做

| 项目 | 处理 |
| --- | --- |
| Windows Electron 主进程与生命周期 | 后续 `improve-2` 单独设计 |
| x64 NSIS `.exe` | 后续批次 |
| 代码签名、SmartScreen、自动更新 | 正式公开分发前单独处理；当前无证书 |
| DPAPI | 留给 Electron production 凭据适配 |
| x86、ARM64 | 不在当前目标平台 |
| UNC/网络共享存储 | 不支持 |
| `./data` 到用户目录的自动迁移 | 不做 |
| IE、旧版 Edge | 不支持 |
| 浏览器自动化 | 不新增；Edge/Chrome 采用人工关键流程验收 |
| 真实 Provider CI 调用 | 禁止 |

## 4. 与关联模块的关系

- `db`、`storage`、`user-config`、`settings`、`observability` 继续拥有各自业务职责，只把路径默认值交给统一策略。
- `desktop-shell` 仍通过 `electron/runtime/environment.ts` 显式注入四类数据路径；Next Runtime 不反向依赖 Electron。
- 浏览器下载语义继续遵守 `docs/mvp/settings/*`：浏览器拥有最终下载位置，服务端不向页面暴露本机绝对路径。
- 本批不修改数据模型和 API DTO。

## 5. 用户确认记录

用户依次确认了：

1. 开发数据继续留在仓库 `./data/`。
2. production 使用 Windows 用户配置位置，首批只做 x64，Edge/Chrome 优先。
3. 采用统一运行时路径策略。
4. `npm run dev` 环境加载与迁移启动闭环。
5. Windows 文件系统、权限和本机磁盘边界。
6. 浏览器兼容与测试矩阵。
7. 增加 Windows x64 CI 门禁。
8. 先写文档，完成后执行文档自检。
