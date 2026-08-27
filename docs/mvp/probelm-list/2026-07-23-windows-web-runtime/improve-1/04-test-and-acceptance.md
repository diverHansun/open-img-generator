# 4. 测试与验收标准

> 本文遵循 `docs/test-blueprint.md`。测试围绕路径分叉、真实 Windows 文件系统、启动进程和既有 Electron 回归，不追求空洞覆盖率数字。

## 4.1 测试范围

| 类型 | 本批职责 | 放置与命名 |
| --- | --- | --- |
| Unit | 纯路径、模式、env 优先级、SQLite URL、平台权限策略 | 与 `src/lib/runtime-paths/` 同目录，`.unit.test.ts` |
| Contract | 确认 API 不新增绝对路径或桌面能力泄漏；无 DTO 变化时主要跑回归 | `tests/contract/`，沿用现有文件 |
| Integration | 真实临时 SQLite + 文件系统 + 配置/凭据/storage/log 协作 | `tests/integration/`，`.integration.test.ts` |
| Smoke | 真实迁移、Drizzle、build、Windows `npm run dev` 启动 | `tests/smoke/`，`.smoke.test.ts` |
| Manual | Edge/Chrome 关键 Web 流程；Firefox 基础冒烟 | 本文清单 |

不新增 Playwright，不把真实 Provider、真实用户目录、用户 API key 或浏览器付费调用放入自动化。

## 4.2 Unit 场景

| ID | 场景 | 验证点 | 问题 | Phase |
| --- | --- | --- | --- | --- |
| U01 | development 无覆盖 | 四类路径分别为 `<projectRoot>/data/app.db|images|config|logs` | P1 | 1 |
| U02 | win32 production 无覆盖 | 根位于 `%LOCALAPPDATA%/Open Image Generator` | P3 | 1 |
| U03 | win32 production 缺 `LOCALAPPDATA` | 回退 `<home>/AppData/Local/Open Image Generator` | P3 | 1 |
| U04 | 四环境变量覆盖 | 每项独立覆盖且最高优先；未覆盖项仍用模式默认 | P1 | 1 |
| U05 | 空字符串/空白 env | 按未设置处理，不解析成项目根 | P1、P4 | 1 |
| U06 | SQLite 本机路径矩阵 | 相对 `file:`、raw path、Windows drive、规范 local file URL、空格、中文、反斜杠、`:memory:` 得到期望 canonical 结果 | P4 | 1 |
| U07 | 非本机 SQLite | 非 file scheme、UNC、network file URL 返回结构化错误 | P4 | 1 |
| U08 | mode 优先级 | CLI > `NODE_ENV` > development default；非法 mode 失败 | P2 | 1 |
| U09 | storage 相对路径 | 正常年月/UUID 路径通过；绝对、drive、UNC、`..` 越界拒绝 | P4 | 2 |
| U10 | 权限策略 | POSIX 请求 0700/0600；win32 不声称精确 POSIX mode | P3 | 2 |
| U11 | Electron 显式覆盖 | userData 四路径覆盖 production 默认，Provider key 清空逻辑保持 | P7 | 4 |

Unit 必须断言最终结果/错误类别，不断言内部 helper 调用次数。win32 纯路径用显式 `platform: 'win32'`，不能依赖测试主机平台。

## 4.3 Integration 场景

测试根目录必须包含空格和中文，例如 `<temp>/Open Image Generator 测试 空格/`，并在 `finally` 恢复 env、关闭 SQLite、删除临时目录。

| ID | 场景 | 验证点 | 问题 | Phase |
| --- | --- | --- | --- | --- |
| I01 | runtime preflight 首次运行 | 创建 DB parent、images、config、logs；写探针被清理 | P3、P4 | 2 |
| I02 | 必需目录不可写/类型错误 | DB/images/config 明确失败，错误含 resource/path/errno，不启动迁移 | P3 | 2 |
| I03 | 日志目录不可用 | 返回 warning，主流程继续；safe logger 不抛出递归错误 | P3 | 2 |
| I04 | SQLite + storage ownership | 迁移后的 DB hash 与 marker 配对；改为另一 DB 时 fail closed | P1、P2 | 2 |
| I05 | 设置与加密凭据 | 中文/空格路径下原子写入并可读回；临时文件不残留；Windows 不断言 mode | P3 | 2 |
| I06 | 图片与日志 | 图片落在统一 root，日志落在统一 log dir，API/安全事件不包含绝对路径 | P1、P4 | 2 |

Integration 只替换不可控厂商 HTTP；这里没有必要 mock 文件系统或 SQLite，因为真实协作正是风险所在。

## 4.4 Smoke 场景

| ID | 场景 | 验证点 | 问题 | Phase |
| --- | --- | --- | --- | --- |
| S01 | `db:migrate --mode=development` | 无覆盖时创建项目根 `data/app.db`；重复执行幂等 | P1、P2 | 1 |
| S02 | `.env.local` 覆盖 | 迁移输出的 DB 与随后 Next health 实际使用的 DB 相同 | P2 | 1、4 |
| S03 | 从非根调用迁移 | 相对路径仍以项目根解释 | P1、P2 | 1 |
| S04 | `db:push` | Drizzle 与 runtime policy 指向相同 development DB | P1、P2 | 1、4 |
| S05 | Windows `npm run dev` | 使用 `npm.cmd` 启动；在期限内页面和 `/api/health` 成功 | P5、P6 | 4 |
| S06 | Windows 二次启动 | 复用同一 DB，无重复迁移错误，数据/marker 保持 | P1、P6 | 4 |
| S07 | 启动失败清理 | 超时/断言失败后 npm/Next/Node 进程树退出，端口释放 | P6 | 4 |
| S08 | production build | `npm run build` 在 Windows x64 Node 24 通过 | P6 | 4 |
| S09 | desktop runtime 回归 | macOS desktop 显式路径与凭据隔离 smoke 继续通过 | P7 | 4 |

Windows dev smoke 使用随机可用端口和临时四路径，不写开发者真实 `./data`。启动日志可用于失败诊断，但测试输出不得打印 key。

## 4.5 API 与浏览器回归

### Contract 回归

| ID | 场景 | 标准 |
| --- | --- | --- |
| C01 | Settings API | 不返回数据库、图片、配置或日志绝对路径 |
| C02 | Image download | `Content-Disposition` 文件名无 Windows 非法字符，Content-Type 与 nosniff 保持 |
| C03 | Project export | ZIP attachment 和内部路径经过现有清理；中文标题可用 |
| C04 | Desktop capability | 普通 Web 环境仍显示浏览器管理下载，不获得原生目录能力 |

### 人工浏览器验收

在 Windows x64、Node.js 24 LTS 上，Edge 与 Chrome 最新稳定版各完成一次 M01–M07。Firefox 最新稳定版至少完成 M01、M02、M04 的基础冒烟。Safari 延续现有 macOS 回归，不属于 Windows workflow。

| ID | 步骤 | 通过标准 |
| --- | --- | --- |
| M01 | 访问 `http://localhost:3000` | 页面正常加载；控制台无阻断错误；不使用 `127.0.0.1` |
| M02 | 创建项目、刷新页面、重启服务 | 项目仍存在，SQLite 位于仓库 `data/app.db` |
| M03 | 保存设置与测试凭据 | 设置和加密凭据位于 `data/config`；页面不显示真实绝对路径 |
| M04 | 浏览历史/图库并打开预览 | 图片显示、焦点和刷新行为正常 |
| M05 | 下载图片 | 浏览器接管下载，Windows 文件名合法，文件可打开 |
| M06 | 导出含中文标题的项目 ZIP | ZIP 下载成功、可解压、内部文件名合法、`history.json` 可读 |
| M07 | 清理当前浏览器站点数据后重开 | 浏览器偏好可重置，但服务端项目和图片未删除；Edge/Chrome 互不共享偏好是预期行为 |

真实生成不是 CI 要求。需要验证完整 Provider 流程时，只能由用户显式授权并使用测试账户；不把付费调用写入固定脚本。

## 4.6 Windows x64 CI 门禁

目标 workflow：`.github/workflows/windows-x64.yml`。

最低步骤：

```text
checkout
setup-node 24.x with npm cache
npm ci
npm run typecheck
npm run test:verify
npm run build
npm run test:smoke:windows
```

要求：

- runner 为 GitHub-hosted Windows x64。
- workflow 设置总超时，启动 smoke 也设置独立超时。
- 不配置 Provider secrets。
- 任一步骤失败均阻断合入。
- 不用 workflow 级自动重试掩盖 flaky；先判定测试、依赖安装或产品实现的根因。
- `npm ci` 必须使用已提交 lockfile；不得在 CI 临时更新依赖。

## 4.7 回归命令

实施完成后至少执行：

```powershell
npm ci
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:integration
npm run build
npm run test:smoke:windows
```

在 macOS/Linux 或现有桌面发布环境还应执行与改动相称的既有 `npm run test:release`、`npm run desktop:smoke`；Windows CI 不替代 macOS 桌面产物验收。

## 4.8 Phase 完成映射

| 02 Phase | 必须通过 |
| --- | --- |
| Phase 1：路径/启动事实源 | U01–U08、S01–S04 |
| Phase 2：消费者/文件语义 | U09–U10、I01–I06、现有 DB/storage/config/log 回归 |
| Phase 3：onboarding/browser | README 步骤复核、C01–C04、M01–M07 |
| Phase 4：测试/CI | U11、S05–S09、Windows workflow 全绿 |

## 4.9 最终验收标准

| 门禁 | 标准 | 验证方式 |
| --- | --- | --- |
| 运行环境 | Windows x64 + Node.js 24 LTS 可安装依赖 | `npm ci` |
| 开发启动 | 单一 `npm run dev` 完成迁移并监听 localhost | S05 |
| 数据位置 | development 四类数据均在仓库 `./data` | U01、M02、M03 |
| env 一致性 | migration/Drizzle/Next 对同一输入解析相同 DB | S02、S04 |
| Windows 路径 | drive、空格、中文有效；UNC/越界拒绝 | U06、U07、U09、I01 |
| 权限语义 | POSIX mode 不回退；Windows 不作虚假 mode 断言 | U10、I05 |
| 数据安全 | 无自动迁移/删除；ownership fail-closed 保持 | I04、S06 |
| 浏览器 | Edge/Chrome 关键流程通过 | M01–M07 |
| CI | Windows x64 workflow 全绿并阻断失败 | workflow run |
| 回归 | macOS/Linux tests 与 desktop 显式 userData 映射不回退 | U11、S09、既有 suites |
| 范围 | 未加入 Electron Windows、NSIS、签名、DPAPI、Playwright | diff 审查 |

只有全部发布门满足，才能把 improve-1 标记完成。

## 4.10 对抗性审查要点

| 攻击面/故障面 | 防御 | 残余风险 |
| --- | --- | --- |
| `.env.local` 令迁移与服务分叉 | `@next/env` + 同一 resolver + S02 | Next 大版本升级后 loader 行为需回归 |
| `file:`/drive/UNC 混淆导致写错位置 | 明确 parser、local-only allowlist、U06/U07 | 本批不支持网络盘是有意限制 |
| 路径穿越或 DB 中恶意 storage path | 相对路径约束 + canonical boundary + U09 | 目录内 junction/symlink 的更强策略本批不扩展 |
| Windows AV 锁定 rename | 原子写失败显式上报、临时文件清理 | 未稳定复现前无自动重试 |
| startup smoke 留孤儿进程 | finally 终止进程树、端口复查、S07 | runner 异常中断由 CI 机器回收兜底 |
| 共享 resolver 破坏 Electron | 显式 env 最高优先、Provider key 清空、U11/S09 | Windows Electron 尚未实现，不能由本批测试替代 |
| 绝对路径泄漏到浏览器或安全日志 | C01、I06、既有 safe logger allowlist | 本机 startup stderr 有意显示诊断路径 |
