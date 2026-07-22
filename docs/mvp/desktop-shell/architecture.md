# desktop-shell 模块 · architecture

> 前置：`goals-duty.md` 已确认。
> 目标平台：macOS（`arm64`、`x64` 独立 `.dmg`）；Windows 由独立工作流后续适配。

## 1. Architecture Overview

桌面版采用“薄 Electron 外壳 + 原样复用本机 Next 运行时”的单向结构。Electron 是安装、生命周期、系统数据目录与受限原生能力的所有者；既有 Next 应用仍是所有页面、HTTP API、任务、数据库和图片存储的唯一所有者。

- **Desktop Bootstrap**：Electron 主进程创建用户级应用窗口，确定应用身份和 `userData` 目录，协调启动、失败提示和退出清理。
- **Local Runtime Manager**：以仅监听 `127.0.0.1` 的受控子进程运行随应用打包的 Next 运行时；在窗口加载前完成健康检查，并为本次启动提供独立访问令牌。
- **Runtime Environment**：将数据库、图片、设置、日志和加密凭据定向到 `app.getPath('userData')` 下的固定子目录。应用窗口只访问该本机运行时，业务代码不感知 Electron。
- **Native Capability Broker**：主进程和隔离 preload 共同提供最小、参数受校验的原生能力；首版覆盖受信任 Provider 的外部 API Key 申请链接与“打开数据目录”。
- **Credential Protection**：主进程使用 macOS Keychain 保存凭据文件的本地加密秘密。Keychain 正常时，既有 `credentials.enc.json` 跨启动可读；短暂不可用时，凭据只在本次运行保存在内存中。
- **Packaging Boundary**：打包配置把 Electron、可启动的 Next 生产运行时和 Electron 兼容的 SQLite 原生依赖组合为一个用户级 macOS App，并从根 `package.json` 读取唯一版本号。

依赖方向固定为：Desktop Bootstrap → Local Runtime Manager / Native Capability Broker → 已有 Next Runtime。Next Runtime 不导入 Electron；渲染页面不直接依赖 Node.js 或系统文件。

## 2. Design Pattern & Rationale

采用**薄壳（Thin Shell）**而非把现有 HTTP API 改写为大量 Electron IPC。它直接服务于“复用既有 Web 应用”和“首版保持简单”两个目标：页面和业务运行时继续按当前方式协作，Electron 只在必须接触 macOS 的边界出现。

原生能力采用**能力收口（Capability Broker）**：preload 不透传 Electron 模块，也不提供通用 IPC；每个动作由主进程验证来源和参数后执行。这能保留“打开默认浏览器”“打开应用数据目录”等必要体验，同时避免渲染页面获得任意文件、命令或外部链接权限。

不引入插件框架、通用事件总线或多进程业务抽象。它们没有解决当前 macOS 首版的明确问题，反而会让已有 Next API、任务和桌面生命周期产生两套变化路径。

## 3. Module Structure & File Layout

```text
electron/
  main.ts                    # 应用生命周期与窗口组合根（内部）
  runtime/
    local-server.ts           # Next 运行时的启动、健康检查、终止（内部）
    environment.ts            # userData 到既有环境变量的映射（内部）
  security/
    credentials.ts            # Keychain 主密钥与临时会话模式（内部）
    external-links.ts         # Provider 官方 HTTPS 链接白名单（内部）
  preload.ts                  # 受限、稳定的渲染页面桥接面
  shared/
    desktop-api.ts            # preload 与页面共用的类型契约
scripts/
  desktop-build.mjs           # 将 Next 生产运行时置入桌面产物的构建编排
electron-builder.yml          # macOS 产物、Bundle ID、原生依赖打包规则
```

`electron/` 是桌面专属实现，不能被 `src/` 中的业务模块反向依赖。`shared/desktop-api.ts` 是唯一可以被渲染代码引用的桌面边界；它只描述经批准的原生能力，不包含 API Key、文件路径或 Electron 实例。

## 4. Architectural Constraints & Trade-offs

1. **选择受控 loopback Next 服务，放弃 `file://` 静态页面。** 代价是需要管理子进程、随机端口和启动健康检查；收益是复用现有 App Router、Route Handler、数据库和任务行为，不制造第二套桌面业务实现。
2. **选择用户级隔离数据，放弃首版自动迁移。** 新安装从空数据开始，减少误迁移或覆盖开发期数据的风险；正式发布前如确有需要，再以可预览、可回退的显式导入工具解决迁移。
3. **选择 Keychain + 临时会话，放弃明文兼容模式。** 用户在异常情况下仍能完成本次生成，但退出后需重新输入 API Key；以此避免把长期密钥写入任何未受系统保护的文件。
4. **选择两个架构独立的 `.dmg`，放弃 Universal 二进制。** 首版维护和构建路径更直观，代价是需要分别产出并验证 Apple Silicon 与 Intel 安装包。
5. **首轮仅本机未签名试装，暂不接入公证。** 这降低前期准备成本，但在其他 Mac 上会遇到 Gatekeeper 提示；公开分发前必须单独完成 Apple Developer 签名与公证流程。
