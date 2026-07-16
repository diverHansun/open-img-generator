# storage 模块 · architecture

## 生命周期

`cleanupStoredImages({ db, retentionDays, orphanGraceMs, dryRun })` 由可选 Node worker 定期调用，也可由维护脚本显式调用：

1. 查询 cutoff 之前且未收藏的 image；先用带收藏保护的 CAS 删除 DB 行，再删除文件。
2. 文件已缺失时仍视为删除成功；文件删除失败则保留 failure 计数，下一轮孤儿扫描/维护任务可继续修复。
3. 扫描 `LOCAL_STORAGE_DIR`，未被任何 image 行引用且超过 `orphanGraceMs` 的文件视为孤儿并删除。
4. 收藏关系参与查询和删除 CAS，清理不会删除收藏图片。

默认 `IMAGE_RETENTION_DAYS=30`，设为 `0` 禁用过期清理；默认孤儿宽限期为 1 小时。所有路径继续经过 storage root canonicalize，阻止路径穿越。

## 并发边界

cleanup 不参与 provider 调用；worker 使用传入的 `DbClient`，避免测试/多实例误操作全局 DB。`deleteImageIfUnfavorited` 在删除前再次检查 favorites，降低清理与用户收藏并发时误删的风险。
