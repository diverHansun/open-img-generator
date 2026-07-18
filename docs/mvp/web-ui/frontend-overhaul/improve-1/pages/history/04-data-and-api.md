# History · 数据与 API

## 数据流

1. `GET /api/projects/:projectId/history?page=&sessionLimit=5&generationLimit=10` 返回外层页与每组首批。
2. 用户对单组 Load more：`GET /api/generations?sessionId=&limit=10&cursor=`。
3. 用户打开共享 Detail 弹层时，弹层才请求 `GET /api/generations/:id`；History 自身不调用该接口。

## 契约

`HistoryPage` DTO 以根级 `02 §2.5.2` 为准。只统计/返回有 Generation 的 Session；Session 按 `lastGenerationAt DESC, id DESC`；Generation cursor 沿用现有只读排序。

## 数据所有权

Session/Generation 数据由 library/DB；History 只读。页面 totals 不通过客户端已加载 items 推算。

## 禁止

History route、组内 route 与 server component render 都不得调用 `GET /api/generations/:id` 或 job-engine poll。不得对每个 Session 发 N+1 首屏请求。
