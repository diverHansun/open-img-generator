# desktop-shell 模块 · use-case

## 1. Use Case Overview

1. **Launch Desktop Application**：启动用户级 App 并连接隔离的本机业务运行时。
2. **Protect Provider Credential**：在 Keychain 正常或暂时不可用时安全保存或临时使用 API Key。
3. **Invoke Native Capability**：打开受信任外链、数据目录并管理下载位置。

## 2. Main Flow Description

### Launch Desktop Application

1. 接收 macOS 启动事件并确定当前用户的数据目录。
2. 准备启动令牌、凭据模式和 Next Runtime 环境；运行数据库迁移。
3. 启动并等待 loopback 健康检查。
4. 为应用窗口建立 HttpOnly 本机会话并加载现有首页。
5. 关闭窗口后保留本机 Runtime，符合 macOS 应用生命周期；再次点击 Dock 图标时恢复单窗口，用户退出 App 时再终止 Runtime。

### Protect Provider Credential

1. 启动时优先从 Keychain 恢复主秘密；没有既有秘密时创建并保护新的随机值。
2. Keychain 可用时，Provider 页面按现有流程更新加密凭据文件。
3. Keychain 暂时不可用时，页面显示“仅本次使用”，提交的 Key 只进入 Next Runtime 内存。
4. App 退出后清空内存模式凭据；下次启动重新检测 Keychain，不将临时值迁入文件。

### Invoke Native Capability

1. 接收页面的受限动作并验证动作来源与参数。
2. 合法 Provider/许可证 URL 在默认浏览器打开；非法 URL 被拒绝。
3. 数据目录动作只打开固定 userData；下载目录动作只接受用户通过系统目录选择器确认的结果。
4. 用户取消目录选择时保持原偏好，不产生错误状态。

## 3. Responsibility Boundaries

- desktop-shell 负责生命周期、安全判定、系统目录、Keychain 和 OS 对话框。
- Next Runtime 负责凭据 API、Provider 调用和全部业务数据，不负责创建 Electron 窗口。
- macOS 负责 Keychain、Finder、默认浏览器和目录选择器；desktop-shell 只调用并解释结果。
- 页面负责展示持久/临时模式和用户反馈，不验证或持有系统级权限。

## 4. Failure & Decision Points

- Next Runtime 启动失败或健康检查超时：不加载半可用页面，显示可复制的安全错误并允许退出/重试启动。
- Keychain 暂时不可用：降级为 session-memory，不覆盖现有密文文件；用户仍可完成本次生成。
- 已有 Keychain 密文损坏或无法解密：不生成新主秘密覆盖证据，进入临时模式并记录不含秘密的诊断。
- 外链不在精确 allowlist：拒绝打开；不降级为“允许所有 HTTPS”。
- 子进程退出：关闭业务窗口并展示运行时已停止，避免页面持续发送到失效端口。
- App 重复启动：聚焦已有窗口，不创建第二套 Runtime 或并发迁移同一数据库。
