# Models · 数据与 API

## 数据流

1. 获取 configured Provider capabilities（现有 `/api/providers` 或 provider configuration 摘要过滤 configured）。
2. `GET /api/model-preferences`。
3. 以 `(provider, model)` join；缺行默认 enabled。
4. 用户切换时 `PUT /api/model-preferences { provider, model, enabled }`。
5. Generate 重新加载后使用同一偏好。

## 契约

Provider/model 必须来自固定 catalog；API 拒绝未知组合。`ModelPreference.updatedAt` 用于服务端确认，不用于客户端冲突合并。

## 所有权

providers 拥有 capability；library 拥有 preference；Models 只编排展示与更新。Project route 不参与偏好过滤。

## 并发

同一 row 保存时锁定；自动重新验证不覆盖正在提交的 row，或先等待其完成后再重载。失败回滚到最后确认状态。
