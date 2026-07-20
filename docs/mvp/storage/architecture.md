# storage 模块 · architecture

## 生命周期

`cleanupStoredImages({ db, retentionDays, orphanGraceMs, dryRun })` 由可选 Node worker 定期调用，也可由维护脚本显式调用：

1. 查询 cutoff 之前且未收藏的 image；先用带收藏保护的 CAS 删除 DB 行，再删除文件。
2. 文件已缺失时仍视为删除成功；文件删除失败则保留 failure 计数，下一轮孤儿扫描/维护任务可继续修复。
3. 扫描 `LOCAL_STORAGE_DIR`，未被任何 image 行引用且超过 `orphanGraceMs` 的文件视为孤儿并删除。
4. 收藏关系参与查询和删除 CAS，清理不会删除收藏图片。

默认 `IMAGE_RETENTION_DAYS=30`，设为 `0` 禁用过期清理；默认孤儿宽限期为 1 小时。所有路径继续经过 storage root canonicalize，阻止路径穿越。

## 下载安全边界

`downloadAndStore()` 把 Provider/CDN 返回值视为不可信输入：每个初始 URL 与最多三次 manual redirect 都校验协议、userinfo、DNS 解析出的全部 IP 与地址类别；默认只接受公网 HTTPS。响应在 `.tmp/` 中流式写入，`Content-Length` 与实际字节都不能超过 25 MiB，只有 PNG/JPEG/WebP 且 MIME 与 magic bytes 一致才会原子 rename 到正式路径。失败只产生固定 `StorageError` 文案，不拼接签名 URL 的 pathname/query/fragment。

`data:` 图片先分块解码到私有 `.staging/`，同样校验 25 MiB、声明 MIME 与 magic bytes；DB snapshot 仅能引用 `staging:<uuid>`。当前单图 sync adapter 的 encoded JSON 入口固定为 36 MiB，普通 Provider JSON 仍为 2 MiB；未来若放开 sync 多图，必须先重做 encoded 总预算。`.tmp/` 或 `.staging/` 的崩溃残留仍由现有 orphan grace 扫描回收。

## 并发边界

cleanup 不参与 provider 调用；worker 使用传入的 `DbClient`，避免测试/多实例误操作全局 DB。`deleteImageIfUnfavorited` 在删除前再次检查 favorites，降低清理与用户收藏并发时误删的风险。
