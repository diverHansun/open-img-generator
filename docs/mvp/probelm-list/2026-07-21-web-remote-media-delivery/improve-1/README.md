# Web 远程图片交付 · improve-1

> 状态：已实施；自动化测试与真实 Qwen 链路已通过，浏览器视觉回归待手工确认
>
> 日期：2026-07-21
>
> 代码基线：`mvp@f0adcc6`
>
> 数据库迁移：schema manifest v5 → v6

## 用户结果

- 生成列表使用远程图片预览；点击缩略图打开大图预览。
- 大图右下角始终显示下载 icon；应用不记录或推断浏览器下载是否完成，用户可重复下载。
- 每次从“未收藏”切换为“收藏”时，同时触发一次浏览器下载；收藏写入与浏览器下载相互独立。
- 远程链接过期后保留任务、Prompt、Provider/模型、错误、收藏和生成记录，图片位置显示“远程图片链接已过期”，而不是删除历史。
- 既有本地图片、Base64 结果和本地收藏继续可用，不进行破坏性迁移。

## 必须诚实表达的 Web 限制

普通 Web 页面无法可靠获知用户是否取消下载、最终文件名和本地路径，也不能管理或删除浏览器已下载的副本。因此本批完全舍弃下载状态：不增加 `downloadRequestedAt`/`downloadCompletedAt`，下载 icon 常驻，也不显示“已保存到本地”。

## 方案摘要

```text
Provider submit / poll（服务端，保留 API Key）
                    │
                    ▼
            ProviderImageRef
              ┌─────┴─────┐
              │           │
         URL / HTTPS   Base64 / Data URL
              │           │
              ▼           ▼
       remote image row   现有安全落盘
              │           │
              └─────┬─────┘
                    ▼
          同源 /api/images/:id
         ┌──────────┴──────────┐
         │                     │
   remote: 受控重定向     managed: 本地流式读取
         │                     │
         └────────浏览器────────┘
             预览 / 下载
```

## 文档地图

1. [00-discussion.md](./00-discussion.md)：已确认需求、产品语义和不做事项。
2. [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md)：现有链路、根因、代码与文档冲突。
3. [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md)：数据模型、状态机、API、UI、安全和分阶段实施契约。
4. [03-reference-projects.md](./03-reference-projects.md)：Open Generative AI 与浏览器标准的可借鉴边界。
5. [04-test-and-acceptance.md](./04-test-and-acceptance.md)：单元、契约、集成、真实 Provider 和浏览器验收。

## 已确认边界

- 已确认下载 icon 常驻，不记录下载请求或完成状态。
- 已确认远程收藏只永久保留收藏/生成元数据；远程源过期后不能保证应用内继续显示原图。
- 实施时先上线兼容读取远程行的 schema/API/UI，再切换 job-engine 的 URL 写入路径，避免不可回滚的数据不兼容。
