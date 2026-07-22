# desktop-shell 模块 · test

> 遵循 `docs/test-blueprint.md`；默认测试不读取真实用户目录、Keychain 内容或 Provider API Key。

## 1. Test Scope

覆盖桌面环境映射、外链与 IPC 参数校验、持久/临时凭据模式、Runtime 生命周期、认证 Cookie、下载目录和 macOS 打包资源。现有生成业务、Provider 协议和项目导出语义继续由各自模块测试负责。

不在自动化中调用真实 Provider、修改真实 Keychain 或强制 Finder/浏览器交互；这些只在本机试装清单中人工验证。

## 2. Critical Scenarios

- 正常启动：随机 loopback 端口健康后才显示窗口，现有 API 使用 HttpOnly 会话，无登录页。
- 数据隔离：数据库、图片、设置、日志和凭据路径全部位于临时 userData 映射；测试不写项目 `data/`。
- 单实例与退出：第二次启动聚焦原窗口；退出、失败和崩溃均只终止本 App 的 Runtime。
- Keychain 可用：主秘密可跨启动恢复，Provider Key 文件不含明文，权限保持 owner-only。
- Keychain 不可用：保存/读取在当前进程内有效，磁盘不出现新的凭据或明文文件，API 返回临时模式。
- 外链与 IPC：已知 Provider/许可证 HTTPS 地址允许；HTTP、凭据 URL、未知域名、任意路径和未知 channel 拒绝。
- 下载：默认目录为当前用户 Downloads；用户选择后生效，取消选择保持原值。
- 打包：arm64/x64 配置共享同一版本和 Bundle ID，artifact 中包含 main/preload、Next Runtime、静态资源和正确 ABI 的 SQLite 扩展。

## 3. Integration Points

- **Electron ↔ Next Runtime**：以临时 DB/storage/config 启动真实生产 Runtime，验证健康检查、认证保护和关闭。
- **Electron ↔ user-config**：以 fake safe-storage provider 验证持久秘密、损坏密文和 session-memory 分支，不访问真实 Keychain。
- **Renderer ↔ preload/main**：验证桥接对象只有已声明能力，错误参数不会到达系统调用。
- **Packaging ↔ native dependency**：解包 smoke 校验 `better-sqlite3` 能在目标 Electron Runtime 打开临时 SQLite。
- **Settings ↔ desktop bridge**：Web 环境保持禁用说明；桌面环境启用打开数据目录和下载位置动作。

## 4. Verification Strategy

- Unit 测试与 Electron 源码同目录，使用注入的 fake 进程、safe-storage、shell 和路径值，不启动外部应用。
- user-config 临时模式使用现有 Vitest 单元层，验证与加密文件模式一致的 Provider 配置语义。
- Smoke 测试使用 Electron 的 Node ABI 执行真实迁移、生产服务、未鉴权/已鉴权设置 API；macOS 当前架构额外运行未签名 `.app`/`.dmg` 的人工试装。
- 提交前运行 `npm run preflight`；桌面提交额外运行 desktop typecheck/compile、Next build 和当前架构 package。
- x64 artifact 可在 Apple Silicon 上构建，但最终启动验收留给真实 Intel Mac 或对应 CI；不得仅凭文件生成宣称已兼容。
