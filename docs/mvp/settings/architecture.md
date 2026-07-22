# settings 模块 · architecture

> 前置：`goals-duty.md`

## 1. Architecture Overview

模块由配置存储、运行时设置服务、项目导出服务和 Web 设置界面组成。配置存储只持久化非敏感偏好；运行时服务把保留策略提供给存储清理并汇总数据大小；导出服务从业务库和受管媒体目录生成流式 ZIP；界面只通过 API client 调用这些服务。

## 2. Design Pattern & Rationale

使用“配置文件 + 服务门面”而非在组件中直接读取文件或把偏好塞进业务 SQLite。这样 Web 本地服务和未来 Electron 都能通过同一配置契约运行。项目导出采用专用服务而非复用 History DTO，避免把临时 URL、绝对路径或后台状态暴露给客户端。

## 3. Module Structure & File Layout

```text
src/lib/app-settings/       # settings.json、保留策略与本地占用
src/lib/project-export/     # Project 完成快照与 ZIP 流
src/app/api/settings/       # 设置查询与更新
src/app/api/projects/:id/export/ # Project ZIP
src/components/settings/    # Web 设置界面
```

## 4. Architectural Constraints & Trade-offs

- 选择本地 JSON 文件，放弃设置的多用户同步和复杂迁移；它与现有本地优先部署一致。
- ZIP 流式生成，放弃在客户端组装或将整个项目读入内存。
- Web 明示浏览器限制，放弃模拟原生文件选择；Electron 后续只补能力桥接，不改变设置 API。
