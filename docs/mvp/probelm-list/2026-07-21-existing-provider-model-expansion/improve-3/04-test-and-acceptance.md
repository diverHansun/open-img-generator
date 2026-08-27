# 4. 测试与验收

1. 单测逐 profile 断言 URL、body、字段互斥、Base64/URL parser、错误诊断与未知模型前置拒绝。
2. `npm run test:release` 与 `npm run build` 通过。
3. 使用真实 3000 服务、已保存凭据、count=1 测试至少一个 ZenMux Gemini、Fal Nano Banana 和 Fal FLUX 2；每个协议家族验证终态、落盘和本地图片 API。
4. 若某精确模型因账户权限/地区不可用，记录安全错误码并从默认目录撤回，不扩大重试或泄露上游响应。
5. FLUX Schnell、GPT Image 2 既有单测必须继续通过。
