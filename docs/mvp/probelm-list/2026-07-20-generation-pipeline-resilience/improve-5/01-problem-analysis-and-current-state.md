# 1. 问题分析与现状

## 1.1 症状不是一个根因

当前同一任务页面同时展示三项失败，但必须分开处理：

| Provider/模型 | 失败阶段 | 诊断 | 根因方向 |
|---|---|---|---|
| Doubao `doubao-seedream-5-0-260128` | Provider 请求 | `model_or_endpoint` | 模型标识与 Lite 名称不一致，或账号/Endpoint 未开通 |
| Qwen `qwen-image-2.0-pro` | 图片保存 | `proxy_mapping_not_trusted` | 路由器 Fake-IP + 精确媒体主机未声明 |
| Qwen `wan2.7-image-pro` | 图片保存 | `proxy_mapping_not_trusted` | 同上 |

因此不能把所有失败归类为“网络不好”，也不能通过重试整个 Generation 解决：Doubao 需要修正模型配置；Qwen 已经完成生成，重做会产生重复费用和不一致结果。

## 1.2 路由器 Mihomo 为什么会影响本机 Node

Mihomo Fake-IP 模式可由路由器 DNS 返回 `198.18.0.0/15` 合成地址，再在网关透明识别并转发到真实域名。应用层看到的是保留地址，而不是公网 A/AAAA：

```text
Node resolve(media.example.com)
            │
            ▼
router DNS returns 198.18.x.y
            │
            ├─ Browser/curl connects → router maps fake IP → upstream succeeds
            │
            └─ SSRF preflight sees reserved IP → rejects before connect
```

所以“macOS 代理关闭”和“后端仍受代理影响”并不矛盾。系统代理只描述应用显式使用的 HTTP/SOCKS 设置，不能代表上游路由器没有劫持 DNS 或透明转发。

## 1.3 当前安全策略是合理但配置承载不足

`src/lib/storage/image-url-policy.ts` 会解析远程图片域名，并拒绝回环、私网、链路本地及保留地址。它已提供一个窄例外：只有精确 HTTPS 主机被列入 `TRUSTED_PROXY_IMAGE_HOSTS`，且所有 DNS 结果都在 `198.18.0.0/15` 时，才允许继续。

优点：

- 没有关闭 SSRF；真实私网地址仍被拦截。
- 开关代理后都能工作：公网解析不需要例外，Fake-IP 解析才使用例外。
- 不依赖 Clash/Nikki 的本地端口。

缺口：

- 已知媒体主机只散落在本机 `.env`，Provider adapter 没有声明自己的媒体主机契约。
- 新 Provider/模型返回新 CDN 时容易再次漏配。
- UI 能诊断精确 hostname，但用户修好网络后只能重新生成，无法继续保存。

## 1.4 当前生命周期为什么丢失可恢复性

现有内部 phase 为：

```text
queued → dispatching → polling → storing → terminal
                                  └──────→ cancelling
```

`storeNextImage()` 在以下路径调用 `applyTerminalFailure()`：

- 非 retryable StorageError；
- 下载自动重试预算耗尽；
- 图片/视频结果快照解析失败；
- 本地文件写入后的 DB 记录提交失败。

终态补丁会把 status 设为 `failed`、phase 设为 `terminal`，并清空 `resultSnapshot` 与 `requestSnapshot`。`keepMonotonicStatus()` 又保证 terminal status 不可逆。因此新增一个按钮把 failed 改回 running 会破坏状态机不变量，也没有结果可继续保存。

最近两条 Qwen job 已验证该损失：一个无 provider handle 且 snapshot 已空，另一个虽有 handle但 snapshot 同样已空。旧失败不能从 DB 直接恢复。

## 1.5 当前自动重试不等于用户重试保存

下载重试策略目前最大 3 次、总预算约 60 秒。它适合短暂超时和瞬态 HTTP 故障，但不适合：

- 用户需要修改 Nikki DNS/域名规则；
- 需要新增精确 trusted media host；
- 本地磁盘权限/空间需要人工修复；
- Provider 临时 URL 的可用窗口长于 60 秒。

继续自动重试只会制造日志和流量；进入 terminal 又丢掉结果。缺少的正是一个“暂停但可恢复”的持久检查点。

## 1.6 模型标识现状

`src/lib/providers/capabilities/doubao.ts` 当前把：

```text
model: doubao-seedream-5-0-260128
displayName: Seedream 5.0 Lite
```

绑定在一起。官方资料同时列出 `doubao-seedream-5-0-lite-260128` 和 `doubao-seedream-5-0-260128`，它们是不同标识；产品公开名称与 Lite 计费项也明确区分 Lite。当前绑定会把用户选择 Lite 的意图发送为非 Lite 标识。

模型偏好表使用 `(provider, model)` 作为键。能力列表读取偏好时，只匹配当前 ModelSpec；因此旧偏好不会启用不存在的模型，但会留下无效行。历史 job 的 `model` 是事实字段，不应随能力表更新而改写。

官方参考：

- [火山引擎发布记录：Seedream 5.0 系列模型标识](https://www.volcengine.com/docs/6492/2165228?lang=en)
- [阿里云 Qwen-Image API：结果存储于 OSS](https://help.aliyun.com/en/model-studio/qwen-image-api)
- [阿里云图片生成模型列表](https://help.aliyun.com/en/model-studio/image-model/)

## 1.7 设计约束

1. no-replay 优先：存储重试不能变成新的 Provider submit。
2. SSRF fail closed：不能因为路由器 Fake-IP 就信任任意返回主机。
3. 单机可恢复：服务重启后仍能看见 blocked 状态并继续。
4. 幂等：重复点击、worker 重入、部分图片落盘不得产生重复行或孤儿文件。
5. 公共 API 兼容：不新增一个“半终态”公共 GenerationStatus；使用内部 phase + 视图字段表达。
6. KISS：不实现通用代理路由器，只维护 Provider 明确知道的媒体边界。
