# storage 模块 · architecture

## 生命周期

`cleanupStoredImages({ db, retentionDays, orphanGraceMs, dryRun })` 由可选 Node worker 定期调用，也可由维护脚本显式调用：

1. 查询 cutoff 之前、仍有 `storage_path` 且未收藏的 image；用 `NOT EXISTS favorite` 保护的原子更新把它改为 `retention_expired` 墓碑并清空 path。
2. 墓碑提交后删除文件；文件删除失败则保留 failure 计数，下一轮孤儿扫描/维护任务继续修复。Generation/Job/Prompt/Provider error 与 image 历史身份不删除。
3. 扫描 `LOCAL_STORAGE_DIR`，未被任何 image 行引用且超过 `orphanGraceMs` 的文件视为孤儿并删除。
4. 收藏关系参与查询和删除 CAS，清理不会删除收藏图片。

默认 `IMAGE_RETENTION_DAYS=7`，设为 `0` 禁用自动过期清理；非法值回退 7 天并记录不含路径/密钥的 warning。默认孤儿宽限期为 1 小时。所有路径继续经过 storage root canonicalize，阻止路径穿越。

## 下载安全边界

`downloadAndStore()` 把 Provider/CDN 返回值视为不可信输入：每个初始 URL 与最多三次 manual redirect 都校验协议、userinfo、DNS 解析出的全部 IP 与地址类别；默认只接受公网 HTTPS。透明代理兼容仅限 `TRUSTED_PROXY_IMAGE_HOSTS` 中的精确 HTTPS hostname，且该 host 的**全部** DNS 结果均为 `198.18.0.0/15`；mixed answer、其他 reserved/private 段和未白名单 redirect 一律拒绝。它不是 `ALLOW_PRIVATE_IMAGE_URLS` 的替代品，后者仍仅供本地 fake provider。响应在 `.tmp/` 中流式写入，`Content-Length` 与实际字节都不能超过 25 MiB，只有 PNG/JPEG/WebP 且 MIME 与 magic bytes 一致才会原子 rename 到正式路径。失败只产生固定 `StorageError` 文案和 allowlist 安全类别，最多保留验证后的 hostname，不拼接签名 URL 的 pathname/query/fragment、Prompt、响应体或本地绝对路径。

`data:` 图片先分块解码到私有 `.staging/`，同样校验 25 MiB、声明 MIME 与 magic bytes；DB snapshot 仅能引用 `staging:<uuid>`。ZenMux 与豆包优先使用此路径；URL-only Provider 仍在任务完成后立即下载转存。当前单图 sync adapter 的 encoded JSON 入口固定为 36 MiB，普通 Provider JSON 仍为 2 MiB；未来若放开 sync 多图，必须先重做 encoded 总预算。`.tmp/` 或 `.staging/` 的崩溃残留仍由现有 orphan grace 扫描回收。

## 并发边界

cleanup 不参与 provider 调用；worker 使用传入的 `DbClient`，避免测试/多实例误操作全局 DB。`markImageExpiredIfUnfavorited` 与收藏写入都使用 SQLite immediate transaction；收藏先胜则 cleanup 条件更新为 0，cleanup 先胜则墓碑不可重新收藏。主动单图删除在短事务中移除 favorite 并写 `user_deleted` 墓碑。
