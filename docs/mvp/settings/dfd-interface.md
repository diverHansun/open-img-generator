# settings 模块 · dfd-interface

## 1. Context & Scope

设置模块接收 Web 设置界面的读写请求，依赖用户配置目录、storage、日志和业务 SQLite；它向浏览器返回不含绝对路径和秘密的数据。

## 2. Data Flow Description

1. 设置页读取应用设置与本地数据汇总，显示当前保留策略和浏览器下载行为。
2. 用户保存保留天数后，API 校验并原子写入 `settings.json`；下一轮 cleanup 读取该值。
3. 用户发起项目导出后，服务读取当前已完成的 Generation，按 Project / Session 组织可用图片与 `history.json`，并将 ZIP 流返回浏览器下载。

## 3. Interface Definition

- 设置查询与更新：同步 JSON API，表达“永不”或受限天数。
- Project 导出：只读 GET，返回附件 ZIP；它不触发 Provider、轮询或后台任务推进。

## 4. Data Ownership & Responsibility

`app-settings` 拥有 `settings.json`；storage 拥有媒体文件及其生命周期；library / DB 拥有 Project、Session 和 Generation 历史；浏览器仅拥有下载文件的最终保存位置。
