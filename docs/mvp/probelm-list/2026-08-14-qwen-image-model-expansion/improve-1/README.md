# Improve 1：Qwen Image 3.0 与 Wan 2.7 标准版模型扩展

> 状态：规划已确认，随后在本次任务中实施并验收。
>
> 基线：当前 `mvp` 分支，Qwen provider 已支持 `qwen-image-plus`、`qwen-image-2.0-pro` 与 `wan2.7-image-pro`。

## 本批目标

- 删除 `qwen-image-plus` 模型支持和 legacy `text2image/image-synthesis` 异步协议。
- 新增 `qwen-image-3.0-pro`、`qwen-image-3.0`、`qwen-image-2.0-pro-2026-06-22`。
- 新增 `wan2.7-image`，使用官方 multimodal 同步接口。
- 保持当前产品只开放文生图；不把官方图生图能力暴露到本批公开 capabilities。
- 保留并回归现有 `qwen-image-2.0-pro` 与 `wan2.7-image-pro`。

## 文档地图

- [00-discussion.md](./00-discussion.md)：用户确认的范围与边界
- [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md)：基线、问题与代码证据
- [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md)：实施契约与文件改动面
- [03-reference-projects.md](./03-reference-projects.md)：官方资料核对与取舍
- [04-test-and-acceptance.md](./04-test-and-acceptance.md)：自动化、编译与 WebUI 验收标准
- `05-implementation-acceptance.md`：实施完成后由验收审查补充

## 明确不做

- 不实现 `image-to-image`、参考图上传、多图融合、交互式编辑或组图生成。
- 不新增动态模型发现、价格展示、区域自动切换或 SDK 依赖。
- 不删除历史数据库中的旧 model 字符串；只禁止新的 `qwen-image-plus` dispatch，并保持未知模型安全失败。
- 不修改 Qwen provider 的凭据名称和默认 base URL。
