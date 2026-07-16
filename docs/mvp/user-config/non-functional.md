# user-config 模块 · non-functional

> 前置: architecture.md
> 适用于**实现里程碑**，非本轮编码门禁。

---

## 1. 安全

- API key at rest 必须加密（或委托 OS 凭证柜）；禁止明文提交 git。
- 日志与 API 响应禁止打印 key。
- 文件权限：用户私有目录（如 `~/.config/open-image-generator/`）。

---

## 2. 可靠性

- 用户库损坏时：回退 env；启动警告；不拖垮业务库。
- 迁移：从 `.env` 导入到用户库为显式操作，非静默。

---

## 3. 性能

- 启动时读一次缓存；非每请求解密封。

---

## 4. 兼容

- 开发模式可仅 env，无用户库文件亦能运行。
