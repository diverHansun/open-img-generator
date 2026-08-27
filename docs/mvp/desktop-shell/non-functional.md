# desktop-shell 模块 · non-functional

## 1. Quality Priorities

1. **安全边界优先**：渲染页面无 Node 权限，API Key 不进入 preload，任意网页不能借 App 打开文件或命令。
2. **数据正确性其次**：单实例、迁移完成后再启动服务，退出时只终止本 App 拥有的进程，不触碰用户其他数据。
3. **可诊断和实现简单并重**：首版接受单一 loopback 子进程与基础日志，不为未来 Windows/Linux 建立通用桌面框架。
4. **启动速度随后**：正常机器应在可接受的桌面启动时间内出现窗口，但不以跳过健康检查换取更快首屏。

## 2. Operational Constraints

- macOS 首版支持当前 Electron 所覆盖的 Apple Silicon 与 Intel 系统，分别打包，不产生 Universal artifact。
- 本机服务只绑定 `127.0.0.1`，使用随机端口和每次启动随机令牌；不得监听局域网地址。
- 数据只写入 `app.getPath('userData')`、用户确认的下载目录和必要的系统临时目录。
- Next 启动和数据库迁移不得永久阻塞；启动超时需显式失败并清理子进程。Keychain 首次授权属于系统交互，用户拒绝或系统返回失败后进入仅本次使用模式。
- `better-sqlite3` 必须针对目标 Electron/CPU ABI 构建，不能把开发机 Node ABI 产物直接当作安装包依赖。
- 日志不能包含 Prompt、API Key、访问令牌、完整签名 URL 或凭据文件明文。

## 3. Reliability & Observability

- 主进程记录启动阶段、目标架构、数据目录类别、健康检查结果和子进程退出码；路径只在本机诊断中出现，不进入导出。
- App 正常退出、启动失败和 Runtime 崩溃都应回收子进程；重复调用清理保持幂等。
- Keychain 错误分为暂时不可用与不可恢复密文错误，二者都不得静默覆盖既有凭据。
- 无法打开 Finder、浏览器或下载目录时，将可理解错误返回页面或系统对话框，不使主进程崩溃。
- 打包门禁至少验证 Electron 编译、Next production build、macOS artifact 生成、解包后的关键资源存在，以及目标架构的 SQLite Mach-O 类型正确。

## 4. Trade-offs & Deferred Requirements

- 首版不接入 crash reporting、远程遥测和自动更新，避免把纯本地产品引入新的数据出口。
- 首版不承诺 Windows/Linux 的目录和安全存储实现；共享契约保持窄接口，平台适配由各自分支完成。
- 首轮未签名 `.dmg` 仅供本机验证；公开分发前再加入 Developer ID、Hardened Runtime、公证与 staple。
- 暂不自动迁移 Web 开发数据，也不建立复杂的备份恢复系统；项目导出继续作为当前可见的数据带出手段。
