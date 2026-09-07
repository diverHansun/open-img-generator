# 4. 测试与验收标准

> 遵循 `docs/test-blueprint.md`。浏览器 E2E 不进 CI；关键界面手工过一遍。对应 01 高风险项与 02 Stage DoD。

## 4.1 测试范围

| 层 | 覆盖什么 | 不覆盖什么 |
|----|----------|------------|
| Unit（与源码同目录） | promote 条件更新；addFavorite 失败不插行；条件更新失败删除新文件；cleanup 不隐式 pin；`classifyApiError(StorageError)` 的 code/retryable/details | 真 CDN |
| Contract | `POST /api/favorites` 成功后 delivery=managed；失败码；`GET /api/settings` 含逻辑 `storageDirectory`；Stage 2 `POST /api/images/:id/pin` 合法/非法字节 | Electron `openPath` |
| Integration（临时 SQLite + `createStorageDir` + MSW） | 生成 remote 图 → 收藏 → 文件在 storageRoot 且预览不再 302；MSW 让后端下载 403 时不写 favorite | 真实 fal/qwen |
| 手工 | Web 设置能看见 `images/` 而非绝对路径；桌面打开的是 images 存储根；全局顶部提示；Gallery 用户触发的旧收藏补钉或诚实墓碑 | 像素回归全站 |

## 4.2 关键场景与用例

| ID | 场景 | 类型 | 验证点 | 对应 Stage |
|----|------|------|--------|------------|
| F1 | managed 图收藏 | unit + 现有 integration | 不调用 download；favorites 一行；幂等 | 1 |
| F2 | live remote 收藏成功 | integration + MSW 返回 PNG | `sourceKind=managed`；storagePath 文件存在；`GET /api/images/:id` 200 本地流，非 302 | 1 |
| F3 | CDN 4xx/过期 URL 收藏 | integration | 不插入 favorites；410 或 STORAGE_ERROR `retryable=false` | 1 |
| F4 | 可重试下载失败（timeout / 5xx） | unit/integration | STORAGE_ERROR `retryable=true`，`details.category` 为现有分类之一；无 favorite 行 | 1 |
| F5 | 前端乐观红心 + F3 | 组件级或手工 | 回滚红心；文案含「已经存不了了」同类语义，不是笼统「请重试」 | 1 |
| F6 | 前端可重试失败 | 手工或组件 | 文案请重试；不残留红心 | 1 |
| F7 | 收藏不再触发浏览器下载 | unit（generate-stage 若可测）/手工 | 点红心不创建 download 导航；下载 icon 仍可用 | 1 |
| F8 | remote TTL cleanup vs 收藏 | unit | cleanup 不请求网络；收藏关系保留，已知过期 remote 仍成为 `remote_expired` 墓碑 | 1 |
| F9 | `classifyApiError(new StorageError(..., { diagnostic }))` | unit | JSON `error.code==='STORAGE_ERROR'`，retryable 时 503、否则 422，details 只有 category/hostname；客户端保留该 details | 1 |
| F10 | settings 路径 | contract | GET 含 `localData.storageDirectory === 'images/'`，不含测试用绝对 storageRoot | 1 |
| F11 | 非法 pin 字节 | contract Stage 2 | 非图片魔数 / 超 25MiB → 不 promote | 2 |
| F12 | 合法 pin 字节 | integration Stage 2 | 后端 download 被 MSW 阻断时，POST 字节后收藏成功 | 2 |
| F13 | 存量已收藏仍 remote | integration + Gallery 行为 | 普通 Gallery 加载不发补钉请求；用户点「保存到本地」成功 → managed；链接失效 → 墓碑，favorite 行仍在、显示「原图已删除或丢失」 | 1 |
| F15 | 条件更新竞态后的孤儿补偿 | unit + integration | 下载成功但 promote/favorite 写库失败 → 新 storagePath 被删除，DB 维持胜出状态 | 1 |
| F16 | 全局保存提示 | 组件级或手工 | 生成、详情、Gallery 复用顶部队列；成功/错误卡片向下堆叠，均在 3 秒后消失；屏幕阅读器有状态播报 | 1 |
| F14 | 取消收藏 | unit | 只删 favorite，storagePath 仍在 | 1 |

## 4.3 集成边界

- **library ↔ storage：** pin 必须走 `downloadAndStore` 或抽出的同一 finalize；测试断言未另写未校验文件。
- **library ↔ db 不变量：** promote 后满足 managed live check；失败行仍为 remote live 或原样。
- **API ↔ UI：** 前端只依赖 `error.code` / `retryable` / `details.category`，不解析 `error.message` 里的英文内部句。
- **settings ↔ runtime-paths：** 返回值与 `getStorageRoot()` 同一函数，禁止前端拼路径。
- **MSW：** 新/改的 integration 不得再手改 `global.fetch`（test-blueprint §1.3）。

## 4.4 回归清单

- 未收藏 remote 预览仍 302，生成成功不依赖 Node 转存（07-21 仍有效）。
- inline/managed Provider（doubao/zenmux 等）生成与收藏路径不被 pin 逻辑误伤。
- `markImageExpiredIfUnfavorited` 仍跳过收藏的 managed 文件。
- 单图删除、generation 删除、导出 ZIP 行为不变。
- `POST /api/favorites` 缺 `imageId` 仍 400。
- 桌面「选择下载目录」与「打开存储目录」不是同一个路径。

## 4.5 验收标准（发布门）

| 项 | 标准 | 如何验证 |
|----|------|----------|
| 新收藏可见 | 对至少一个 URL 型 Provider（测试用 MSW 即可）收藏后，刷新 Gallery 仍能打开 | F2 + 手工 |
| 无假红心 | 人为让 download 失败，红心不保留 | F3–F6 |
| 错误可区分 | 不可恢复 vs 可重试文案不同；网络面板里有 `STORAGE_ERROR` 或 410，而不是无 details 的 500 | F5、F6、F9 |
| 设置 | Web 设置页看得到 `images/`、不含主机绝对路径；桌面点击打开后系统文件管理器落到实际图片目录 | F10 + 手工 |
| 权威文档 | 07-21 收藏语义、library UC4、settings「不返回路径」已改或显式标注 superseded | diff 审查 |
| 自动化 | F1–F16 有对应测试且 CI 可跑 | `pnpm test` 中 unit/contract/integration |
| Stage 2 | 若宣称 Stage 2 完成：F11、F12 必须绿 | 未做 Stage 2 则不得声称代理环境收藏已通 |

## 4.6 对抗性审查要点

1. **cleanup 与收藏竞态：** 一边用户触发 pin、一边 `markRemoteImageExpired`。防御：双方条件更新；收藏看到 0 rows 则 410，并删除已下载的孤儿文件。残余：极端下用户需重试。测试 F8/F15 加并发不必强求，但实现必须用 CAS 与补偿删除。
2. **Stage 2 当后门：** 对任意 imageId POST 字节写入磁盘。防御：仅 live remote、魔数、大小、所有权校验；本机单用户无多租户。残余：本机其它网页若能打到 API，与现有删除/导出面相同，不单为本轮扩大。
3. **GET 预览误加副作用：** 若实施把「打开即钉盘」写进 `openDeliverableImage`，会让列表加载变慢并在 GET 写库。04 回归明确禁止；发现则验收失败。
4. **假成功窗口：** 先 insert favorite 再下载。防御：02 规定下载在事务外、insert 在 promote 成功之后。测试 F3 查库无行。
5. **CORS 被当成已做完：** 文档若写「Web 一定能收藏」但只完成 Stage 1，代理环境会全灭。发布说明必须写清：Stage 2 未验证 CORS 前，Web+Fake-IP 不是已验收能力。
