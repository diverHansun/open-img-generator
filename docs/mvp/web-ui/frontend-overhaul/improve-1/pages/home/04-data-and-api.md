# Home · 数据与 API

## Context & Scope

Home 与 Project/library 交互；不加载 Session、Provider 或 Generation detail。创建成功后仅导航；首次 Session 由 Generate 自行创建。

## 数据流

1. 页面请求 `GET /api/project-summaries`。
2. 服务端聚合 Project 及 counts/cover，返回稳定排序。
3. 页面渲染最近列表。
4. 创建时调用现有 `POST /api/projects { title }`。
5. 成功用返回 `project.id` 组装 Generate 路由。

## 接口

- `listProjectSummaries(): Promise<ProjectSummary[]>`
- `createProject(title): Promise<Project>`

DTO 以根级 `02 §2.5.1` 为准。封面 URL 必须是应用持久化图片 URL；counts 为服务端聚合，客户端不逐 Project 发 N+1 请求。

## 所有权

Project 由 library 创建/更新；Home 只读 summary 并发起 create。UI 不缓存完整 summary 到 localStorage。
