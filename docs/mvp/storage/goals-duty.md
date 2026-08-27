# storage 模块 · goals-duty

> 模块路径: `src/lib/storage/`
> 文档顺序: ① goals-duty(本文) → ④ dfd-interface

---

## 1. Design Goals（设计目标）

1. **把厂商临时 URL 转化为本地可持久访问的图片资产**
   - 输入是有时效性的 HTTPS URL，输出是本地文件系统上的稳定路径。
   - 衡量标准: 厂商 URL 过期后，通过 storage 存储的文件仍可访问。

2. **让存储后端可替换，MVP 不感知差异**
   - v1 用本地文件系统，v2 可切 R2/S3，上层（job-engine）调用签名不变。
   - 衡量标准: 切换 STORAGE_PROVIDER 环境变量后，job-engine 代码零改动。

---

## 2. Duties（职责）

1. **下载并存储**: 从远程 URL 下载图片内容，写入存储后端，返回 storagePath。
2. **读取**: 根据 storagePath 提供文件内容（供 API 层返回图片二进制）。
3. **路径生成**: 按约定规则生成唯一存储路径（如 `{year}/{month}/{uuid}.png`）。

---

## 3. Non-Duties（非职责）

1. **不调用厂商 API**: 只下载 URL，不关心 URL 来源。
2. **不管理图片元数据**: 宽高、contentType 等信息由 job-engine 写入 db。storage 只存文件。
3. **不做图片处理**: 不压缩、不裁剪、不加水印。
4. **执行图片生命周期清理**: `cleanupStoredImages()` 删除保留期外且未收藏的 DB 图片与文件，并按 grace period 清理孤儿文件；收藏图片保留。
5. **不处理 HTTP 路由**: 图片的 HTTP 响应由 API 层调用 storage.getReadStream() 后返回。

---

## 自检（提交前）

- **一句话存在意义**: storage 把临时 URL 变成持久文件，屏蔽存储后端差异。
- **不该做什么**: 不调厂商 API、不存业务元数据、不做图片处理、不处理 HTTP；清理只依据 DB 引用与配置，不改变收藏语义。
