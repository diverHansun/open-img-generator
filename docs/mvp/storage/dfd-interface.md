# storage 模块 · dfd-interface

> 模块路径: `src/lib/storage/`
> 前置文档: goals-duty.md
> 文档顺序: ④ dfd-interface(本文)

---

## 1. Context & Scope（上下文与范围）

| 方向 | 模块 | 交互内容 |
|------|------|----------|
| 上游调用方 | job-engine | downloadAndStore(url) → storagePath |
| 上游调用方 | API 层 | getReadStream(storagePath) → 文件流 |
| 下游依赖 | 远程 URL（厂商 CDN） | HTTP GET 下载 |
| 下游依赖 | 本地文件系统（v1） | 文件写入/读取 |

---

## 2. Data Flow Description（数据流描述）

### 2.1 下载并存储

```
job-engine
  → storage.downloadAndStore(remoteUrl)
    → 校验 storage ownership marker 与当前 DATABASE_URL 配对
    → 校验 HTTPS、无 userinfo、DNS/IP 非私网（每次 redirect 重新校验；仅精确白名单 host 可使用全为 198.18/15 的透明代理映射）
    → manual redirect（最多 3 跳）→ 流式读取图片二进制（25 MiB 硬上限）
    → 校验 PNG/JPEG/WebP 的 Content-Type 与 magic bytes 一致
    → 先写 LOCAL_STORAGE_DIR/.tmp/{uuid}.tmp，再原子移动为 storagePath
  → 返回 { storagePath, contentType, sizeBytes }
→ job-engine 将 storagePath 写入 db image 记录
```

### 2.2 读取（API 层图片访问）

```
API 层: GET /api/images/:id
  → db.getImage(id) → available / tombstone
  → available: storage.getReadStream(storagePath) → HTTP 200 + 图片流
  → tombstone: HTTP 410 + IMAGE_EXPIRED / IMAGE_DELETED / IMAGE_MISSING
  → unknown id: HTTP 404
  → DB available 但文件缺失: 原子转为 storage_missing 后返回 410
```

---

## 3. Interface Definition（接口定义）

### storage.downloadAndStore(url)

| 属性 | 值 |
|------|-----|
| 输入 | 远程 HTTPS URL；`data:` 仅限内部 Provider Base64 staging 路径 |
| 输出 | `{ storagePath: string; contentType: string; sizeBytes: number }` |
| 失败 | 下载/URL/DNS/redirect/大小/类型/signature 任一失败均抛不含原 URL 的 `StorageError` |
| 超时 | 建议 60s（图片文件可能较大） |
| 网络安全 | 默认拒绝 `http:`、userinfo、localhost、loopback、RFC1918、link-local、multicast、IPv4-mapped IPv6；仅 `TRUSTED_PROXY_IMAGE_HOSTS` 的精确 HTTPS host 且所有 DNS answer 在 `198.18.0.0/15` 时例外，redirect 逐跳复核；本地 fake provider 才可用显式 `http` + private 开关；远端 MIME 仅作提示，落盘格式由 PNG/JPEG/WebP magic bytes 决定 |
| 内容边界 | `Content-Length` 预检 + 流式计数均限制为 25 MiB；只接受 magic bytes 可识别的 PNG/JPEG/WebP，并以实际格式决定扩展名与响应 MIME |

### storage.getReadStream(storagePath)

| 属性 | 值 |
|------|-----|
| 输入 | storagePath 字符串（相对 LOCAL_STORAGE_DIR） |
| 输出 | `ReadableStream` 或 Node.js `ReadStream` |
| 失败 | 文件不存在抛 NotFoundError |
| 安全 | 拼接后 canonicalize，断言路径仍在 LOCAL_STORAGE_DIR 下（防 `../` 遍历）。见 `api/constraints.md` §9 |

MVP **不实现** `getPublicUrl`；图片访问统一走 API 二进制响应。

---

## 4. Data Ownership & Responsibility（数据归属与责任）

| 数据 | 创建 | 读取 | 责任 |
|------|------|------|------|
| 图片文件 | storage | storage + API 层 | storage 拥有文件，db 存 storagePath 索引 |
| storagePath | storage（路径生成） | db 存储路径值 | storage 生成，db 记录 |

---

## 5. 生命周期清理

worker 定期调用 `cleanupStoredImages()`；该调用先校验 DB/root ownership 并获取本地清理锁，再把过期未收藏图片改为墓碑、删除图片字节并清理超过宽限期且未被 image/video/staging 引用的孤儿文件，不删除生成历史。`GET /api/images/:id/download` 只导出副本且不续期；`DELETE /api/images/:id` 幂等写 `user_deleted` 墓碑。支持 `dryRun` 供维护检查。

## 环境配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| STORAGE_PROVIDER | `local` | v1 仅支持 local |
| LOCAL_STORAGE_DIR | `./data/images` | 本地存储根目录 |
| APP_LOG_DIR | `./data/logs` | 脱敏 JSONL 审计日志目录；5 MiB 当前文件 + 3 份轮转 |
| APP_FILE_LOG_ENABLED | `1` | 设为 `0` 时关闭文件日志，stderr 仍保留 |
| ALLOW_INSECURE_IMAGE_URLS | `false` | 仅本地 fake-provider 允许 `http:`；生产保持关闭 |
| ALLOW_PRIVATE_IMAGE_URLS | `false` | 仅本地 fake-provider 允许私网/loopback 地址；生产保持关闭 |
| TRUSTED_PROXY_IMAGE_HOSTS | 空 | 透明代理把已验证外部 HTTPS CDN 映射为 `198.18.0.0/15` 时的逗号分隔精确 host 列表；不是通配符或私网 bypass |
| IMAGE_RETENTION_DAYS | `7` | 未收藏图片自动保留天数；`0` 关闭自动过期，合法上限 36500 |
