# Providers · 用户用例

## Use Case Overview

1. Inspect Supported Providers。
2. Find Configuration Source。
3. Open Provider Configuration。

## Main Flow

打开目录 → 获取固定七家摘要 → 比较 configured/source/model counts → 需要凭证时由官方申请 key 外链跳转，或选择 Provider 进入详情。页面挂载/重新可见时只重新读取本地配置状态。

## Responsibility Boundaries

Providers 页面说明“系统支持什么、凭证从哪里解析”；它不证明厂商可用。实际调用成功与否由 Generate/Detail 的真实 job 结果体现。

## Failure Points

加密配置损坏、缺 encryption key、summary API 失败。页面显示配置读取错误，不把失败伪装为全部未配置，也不泄漏文件路径/异常 payload。
