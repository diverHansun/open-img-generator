# desktop-shell 模块 · dfd-interface

## 1. Context & Scope

`desktop-shell` 位于 macOS 与既有 Next Runtime 之间。它接收 Electron 生命周期、用户发起的受限原生操作和 Provider 外链请求，输出一个只访问受控 loopback 服务的应用窗口，并把运行目录与凭据保护模式传给 Next Runtime。

本文只描述桌面启动、凭据保护、原生能力和下载的数据流；生成、历史、图片清理与项目导出继续属于现有 Next 模块。

## 2. Data Flow Description

### 2.1 应用启动

1. macOS 启动 Electron 主进程；主进程在创建窗口前获得当前用户的 `userData` 路径。
2. 主进程创建数据库、图片、配置和日志子目录，生成本次启动专用的 API 访问令牌。
3. 主进程请求 Keychain 解密或首次创建凭据文件的主秘密；成功时选择 `encrypted-file` 模式，暂时失败时选择 `session-memory` 模式。
4. 目录映射、访问令牌和凭据模式作为子进程运行环境传入本机 Next Runtime；Provider API Key 本身不经过 Electron 渲染进程。
5. Next Runtime 完成数据库迁移并只监听 `127.0.0.1` 的随机可用端口；主进程循环读取公开存活探针，超时或进程提前退出则显示启动失败。
6. 健康检查成功后，主进程为该 loopback origin 设置 HttpOnly 会话 Cookie，再让 BrowserWindow 加载首页。
7. App 退出时，主进程终止其拥有的 Next Runtime；业务数据库和图片保留在用户目录。

### 2.2 保存和读取 Provider API Key

1. 用户在现有 Provider 页面提交 Key，页面通过受保护的 Next HTTP API 发送请求。
2. `encrypted-file` 模式下，Next Runtime 使用本次启动收到的主秘密更新 `credentials.enc.json`；该主秘密的磁盘副本仅以 Keychain 加密后的形式存在。
3. `session-memory` 模式下，Next Runtime 只更新当前进程内存，不创建或覆盖凭据文件；API 响应标明凭据仅本次运行有效。
4. Provider adapter 仍通过既有 user-config 解析接口读取 Key；渲染页面和 Electron preload 均不接收明文。

### 2.3 打开外部链接与数据目录

1. 页面请求打开新窗口或调用桌面桥接时，URL/动作进入 Electron 主进程。
2. 主进程只接受 Provider catalog 中已知的 HTTPS 申请地址和项目许可证地址；校验失败则拒绝且不打开任何窗口。
3. 合法外链交给 macOS 默认浏览器；“打开数据目录”只定位固定的 `userData`，不接受页面传入任意路径。

### 2.4 下载文件

1. 页面沿用现有同源下载 URL；Electron session 捕获下载事件。
2. 未设置桌面下载目录时使用 macOS 当前用户的默认 Downloads 路径；用户选择目录后，由主进程保存桌面偏好并用于后续下载。
3. 页面只能请求正常下载，不能指定任意绝对保存路径。

## 3. Interface Definition

- **Local Runtime Port**（异步）：主进程提供目录、端口、访问令牌与凭据模式，返回健康的 loopback origin 或明确启动错误。
- **Desktop Capability Bridge**（异步）：向渲染页面公开运行信息、打开数据目录、选择/重置下载目录；每项能力具有固定语义，不暴露通用 IPC。
- **External Navigation Policy**（同步判定、异步执行）：接收候选 URL，只对精确允许的 HTTPS 目标调用系统浏览器。
- **Credential Storage Mode**（启动期输入）：`encrypted-file` 或 `session-memory`；Next user-config 根据该输入选择持久化或仅内存行为。
- **Packaging Input**：根 `package.json` 提供版本，Electron 配置提供显示名称、Bundle ID 与目标架构；输出独立的 arm64/x64 `.dmg`。

## 4. Data Ownership & Responsibility

- Electron 主进程创建并销毁本次运行令牌、子进程与窗口，拥有 Keychain 密文主秘密和桌面下载偏好。
- Next Runtime 拥有业务 SQLite、图片、非敏感应用设置和 Provider 凭据文件内容；Electron 不解析业务记录。
- macOS Keychain 负责主秘密的系统级保护；`credentials.enc.json` 负责 Provider Key 的应用级加密封装。
- 渲染页面只拥有表单草稿与展示状态；提交后不长期保存 API Key，也不拥有任何本机路径。
- 下载产物归用户所有；应用只决定默认或用户已选择的保存目录，不把导出文件纳入业务数据库。
