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
    → HTTP GET remoteUrl → 图片二进制
    → 生成 storagePath（如 "2026/07/{uuid}.png"）
    → 写入 LOCAL_STORAGE_DIR/storagePath
  → 返回 { storagePath, contentType, sizeBytes }
→ job-engine 将 storagePath 写入 db image 记录
```

### 2.2 读取（API 层图片访问）

```
API 层: GET /api/images/:id
  → db.getImage(id) → { storagePath, contentType }
  → storage.getReadStream(storagePath) → ReadableStream
  → 返回 HTTP 200 + Content-Type + 二进制 body
```

---

## 3. Interface Definition（接口定义）

### storage.downloadAndStore(url)

| 属性 | 值 |
|------|-----|
| 输入 | 远程 HTTPS URL |
| 输出 | `{ storagePath: string; contentType: string; sizeBytes: number }` |
| 失败 | 下载失败抛 StorageError（网络错误、404、超时） |
| 超时 | 建议 60s（图片文件可能较大） |

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

## 环境配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| STORAGE_PROVIDER | `local` | v1 仅支持 local |
| LOCAL_STORAGE_DIR | `./data/images` | 本地存储根目录 |
