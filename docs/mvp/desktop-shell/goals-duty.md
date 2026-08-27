# desktop-shell 模块 · goals-duty

> 应用标识（已确认）：显示名称 `open image generator`；Bundle ID `com.diverhansun.openimagegenerator`
> 模块路径（目标态）：`electron/`、`scripts/desktop-*`、桌面打包配置
> 状态：macOS 首版目标与架构已确认；进入实施。

## 1. Design Goals

1. 让用户无需手动启动 Web 服务，即可在 macOS 上安装并使用本项目的本地优先绘图工具。
2. 最大限度复用既有 Next Web 应用、API、SQLite、图片存储和设置能力，避免为桌面版复制一套业务逻辑。
3. 将桌面运行产生的图片、历史数据库、非敏感设置、日志和加密凭据统一隔离在 macOS 标准应用数据目录中，且不影响项目工作目录或用户的其他文件。
4. 保持 API Key 的本地加密文件存储策略：安全存储正常时跨启动可用；异常时仍允许用户在本次运行中使用临时 Key，但不写入明文或 `.env`。
5. 以可验证、可回退的最小 macOS 外壳交付 `v0.1.0`，优先正确性、可维护性和安全边界，而非为未确认的平台与功能预先抽象。

## 2. Duties

1. 在 Electron 生命周期内启动、健康检查并关闭现有本机 Next 服务，并将单一应用窗口连接到该受控本机服务。
2. 为已有运行时配置应用专属的数据根目录：`~/Library/Application Support/open image generator/`，使 SQLite、图片、设置、日志和凭据各自落在该目录的受控子路径。
3. 提供严格受限的桌面原生能力边界，包括打开经校验的 Provider API Key 申请 HTTPS 链接，以及未来设置页所需的受控本机目录操作入口。
4. 使用 macOS Keychain 保护凭据加密所需的本地秘密；若 Keychain 暂时不可用，向用户说明原因并只允许本次会话内存中的 API Key 使用。
5. 提供开发启动、打包和基础验证路径，生成 Apple Silicon (`arm64`) 与 Intel (`x64`) 两个独立的 macOS `.dmg` 安装包。
6. 继续以根目录 `package.json` 的版本号为唯一版本来源，使桌面应用、About 页面、打包产物与发布检查保持一致。

## 3. Non-Duties

1. 不重写或双实现现有 Next 页面、Route Handler、任务引擎、Provider 调用、SQLite 查询和图片生命周期逻辑。
2. 不把 Node.js、任意文件系统、任意命令执行或 API Key 明文暴露给渲染页面；不允许由页面任意调用 `shell.openExternal`。
3. 不在首版实现 Windows 适配、Linux 支持、云同步、多账户、自动更新、托盘、多窗口或“清除全部本地数据”。
4. 不将 API Key 持久化为 `.env`、明文配置文件或导出归档的一部分；安全存储失效时也不进行明文降级。
5. 不在本轮自动迁移开发期 Web 数据目录中的既有图片或数据库；是否提供显式迁移工具留待真实桌面发布前按用户需求决定。
6. 不包含面向公开分发的签名、公证和自动更新发布服务配置；本轮先交付可本机验证的 macOS 安装包，正式分发前再单独接入 Apple Developer 签名与公证。
