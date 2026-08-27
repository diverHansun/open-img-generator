# 3. 参考项目与平台约束

## 3.1 Open Generative AI

参考仓库：[anil-matcha/Open-Generative-AI](https://github.com/anil-matcha/open-generative-ai)

截至 2026-07-21，其 README 同时提供 hosted Web 与 Electron desktop 形态，描述了浏览器存储的 generation history、一键下载以及桌面应用目录中的本地下载/模型文件。仓库包含独立 `electron/` 目录，说明它的桌面下载能力不能直接等同于普通 Web 页面能力。

### 可以借鉴

- 把历史/预览与用户显式下载分开，不要求生成结果一定先由 Web 服务端转存。
- 图片和视频结果以可点击媒体卡片展示，下载是用户主动动作。
- Web 与 desktop 共享产品界面，但 desktop 可逐步增加操作系统级能力。

### 不应照搬

- 其 README 描述 generation history 持久化于 browser storage；本项目已使用 SQLite、Generation/Job/Image/Favorite 关系和 retention，不应退回 localStorage 作为事实源。
- 其 README 描述 API Key 存于浏览器 localStorage；本项目继续坚持服务端加密配置和 adapter 边界，不把 Provider Key 下放前端。
- Electron 的文件路径、下载事件和 App Data 目录只适用于桌面 runtime；当前 Next.js Web 不能据此声称知道下载完成或本地路径。
- 本项目还需要保留 Provider 错误、安全诊断、remote expiry 墓碑、历史删除和 source invariant，不能只保存一个 URL 数组。

结论：借鉴的是“展示与下载分离”的产品结构，不是其存储、安全或桌面实现细节。

## 3.2 浏览器 `<a download>` 的限制

[MDN `<a>` 文档](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a) 把 `download` 的可靠适用范围限定为同源、`blob:` 或 `data:` URL；[WHATWG HTML 下载算法](https://html.spec.whatwg.org/multipage/links.html#downloading-resources) 进一步要求跨域场景配合最终响应的 `Content-Disposition: attachment`，并允许浏览器基于安全策略中止或改变下载处理。

对本项目的含义：

- 公共下载入口应保持同源 image ID，不直接在 React DTO 中放跨域签名 URL。
- 但同源端点最终重定向到 CDN 后，浏览器面对的是跨域最终响应；302 上的 header 不能替最终图片响应声明附件。
- 如果 CDN 最终返回 `Content-Type: image/*` 且没有 `Content-Disposition: attachment`（或明确为 `inline`），浏览器具备直接展示图片的能力，可能选择打开原图；[RFC 6266](https://www.rfc-editor.org/rfc/rfc6266.html) 也把 `attachment` 定义为提示本地保存、把 `inline` 定义为按媒体类型正常处理。用户设置还会影响是否提示、自动保存或打开。
- 因此 Improve 1 采用 best-effort 浏览器下载，并提供“若打开原图，请使用浏览器保存”的明确回退，不承诺统一文件名或保存弹窗。
- 如未来必须保证附件行为，只有三类选择：Node/对象存储代理字节、获得 CDN CORS 后 fetch-to-Blob，或 Electron download manager。三者都超出当前 KISS 边界。

## 3.3 跨域图片与 Blob/Canvas

[MDN CORS-enabled images](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image) 说明，跨域 `<img>` 可以展示，但若源站没有允许 CORS，把它绘制到 canvas 后再 `toBlob()`/`toDataURL()` 会得到 tainted canvas 安全错误；跨域读取/保存需要源服务器配合 CORS。

对本项目的含义：

- 远程预览不需要应用读取像素，因此可以直接交给浏览器。
- “先加载图片、画到 canvas、再强制下载”不是通用方案，各 Provider CDN 的 CORS 行为不一致。
- Improve 1 不把 Canvas/Blob 作为主路径；未来可对经过真实验证且稳定支持 CORS 的 ModelSpec 增加可选优化，但必须保留导航回退。

## 3.4 Electron 能力是下一阶段，不是 Web 假设

[Electron `DownloadItem` 官方文档](https://www.electronjs.org/docs/latest/api/download-item) 提供 `will-download`、进度、`done` 终态、`setSavePath()` 和 `getSavePath()`。这正是普通 Web 缺失的能力：Electron 可以区分 completed/cancelled/interrupted，并取得或设置实际保存路径。

未来 Improve 2 可以：

- 拦截 remote download，使用 Chromium/Electron 网络栈写入用户选择位置；
- 在 `done=completed` 后记录真实 `downloadCompletedAt` 和受控本地 path/bookmark；
- 收藏时下载到应用媒体目录或用户选择目录，并在完成后让 image source 切为 managed；
- 处理暂停、恢复、重复文件名和 App 卸载/迁移。

当前 schema 的 `sourceKind` 为这种演进保留了空间，但 Improve 1 不添加 Electron-only 字段，也不在 Web 中模拟完成事件。

## 3.5 参考结论

| 问题 | Web Improve 1 | Future Electron |
|---|---|---|
| Provider 生成 | 服务端 adapter | 仍可复用本地服务/主进程边界 |
| 远程预览 | 浏览器跟随受控重定向 | Chromium 跟随受控重定向 |
| 下载传输 | 浏览器/系统网络栈 best-effort | Chromium `DownloadItem` |
| 确认完成 | 不可可靠确认；不记录下载状态，icon 常驻 | 可记 completed/cancelled/interrupted |
| 保存路径 | 应用不可见 | 可提示选择或由 App 管理 |
| 收藏永久显示 | 只保元数据，remote 会过期 | 可在下载完成后登记 managed source |

因此，本批方案既能立即减少 Node 媒体网络问题，也不会把未来 Electron 设计锁死；关键是只保留应用能够证明的 source 与 remote lifecycle，不为 Web 下载建立虚假状态。
