# Models · UI 布局与样式

## 1. 页面结构

```text
Models                                     [Search…] [Provider ▼]
还有未配置的服务商，去配置 →
──────────────────────────────────────────────────────────────
fal.ai                                                    2/2
  ▸ FLUX Schnell   fal-ai/flux/schnell   async       [switch on]
  ▸ FLUX Dev       fal-ai/flux/dev       async       [switch off]
──────────────────────────────────────────────────────────────
ZenMux                                                    1/1
  ▸ GPT Image 2     openai/gpt-image-2    sync        [switch on]
```

页面使用完整主区与 Linear 式扁平目录，不使用 inspector 或模型卡片。Search 和 Provider filter 位于 PageHeader 右侧，只做客户端过滤；有未配置 Provider 时，标题下方显示轻量“去配置”提示。

## 2. Provider group 与 Model row

- Provider group header 只显示 display name 与 enabled/available count。
- Model 主行只保留用户识别与启用所需内容：展开箭头、display name、model ID、必要的 mode/protocol 摘要、Switch。
- 不把 default size、价格、远端健康、Last checked 或后端未提供的状态放进主行。
- 行高 48–52px 起步，model ID 使用等宽字体，Switch 始终可见。

## 3. Capability disclosure

展开区使用 subtle surface + definition rows，只展示 DTO 真实字段，例如 modes、sizes/aspect ratios、max count、negative prompt、seed。字段不存在时不渲染，不显示“未知”占位列，也不为每项能力创建卡片。

页面底部只显示“X of Y models enabled”。无已配置 Provider 时显示去 Providers 的唯一主动作；不渲染七个空模型组。

## 4. 响应式与样式边界

- 移动端隐藏 protocol/mode 等低优先级摘要并移入展开区；模型名、ID 和 Switch 保持可达。
- 行用 hairline 与对齐分组，hover/focus 使用轻 surface；不开厚卡、静态 Enabled pill 或多余状态徽章。
- Search/Filter 可在极窄屏换行；不新增服务端搜索、批量开关或自定义模型字段。
- 使用统一 Switch/chevron 图标，不使用 emoji。具体列宽和 accent hue 可调整，主行字段数量不可膨胀。
