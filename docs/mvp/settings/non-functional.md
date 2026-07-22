# settings 模块 · non-functional

## 1. Quality Priorities

优先保证数据安全和行为可预测，其次是导出吞吐；不为了设置页引入云同步或桌面运行时。

## 2. Operational Constraints

设置写入必须原子完成。导出不能把全部图片缓冲到内存，且只能读取受管存储根下的常规文件。Web 下载位置由浏览器管理。

## 3. Reliability & Observability

设置损坏回退默认值并允许后续保存修复。导出不暴露绝对路径、远端签名 URL 或凭据；缺失媒体作为部分成功写入历史清单。

## 4. Trade-offs & Deferred Requirements

本轮不实现批量清库、导出导入、桌面文件夹打开、下载目录选择和更新检查；这些待 Electron runtime 设计完成后再接入。
