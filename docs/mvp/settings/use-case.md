# settings 模块 · use-case

## 1. Use Case Overview

- 配置自动保留
- 查看本地数据占用
- 导出项目快照

## 2. Main Flow Description

配置自动保留时，用户选择“永不”或输入天数，模块校验后持久化；下一次清理据此处理未收藏图片。查看占用时，模块汇总受管文件大小而不返回路径。导出时，模块固定当前完成快照，按 Session 创建目录，写入可用图片和历史清单后流式返回。

## 3. Responsibility Boundaries

设置模块不执行 Provider 请求、不改变业务历史，也不管理 API Key。浏览器负责下载目标；未来 Electron 才负责原生目录选择与 Finder / Explorer 打开。

## 4. Failure & Decision Points

无效天数拒绝写入并保留既有设置。设置文件损坏时安全回退为默认“永不”。导出中遇到缺失图片时在清单标记不可用并继续；进行中的 Generation 不进入快照。
