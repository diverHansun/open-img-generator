# MVP 模块文档总览（代码 ↔ 文档）

> 原则：文档按**模块**组织，目录名与 `src/lib/*` / `src/app` 对齐；每个模块内部严格按 `plan-module-design` 顺序推进。
> 架构前提：路径 1（单体扩展）+ 路径 2 纪律（按域分包）；不拆前后端服务；不学 Spring 细切技术分层。

---

## 1. 代码架构 ↔ 文档架构

```
src/
├── app/                          →  docs/mvp/web-ui/          （页面壳、路由 UI）
│   ├── page.tsx / layout.tsx
│   ├── globals.css
│   └── api/                      →  docs/mvp/api/             （HTTP 契约；薄路由）
├── components/                   →  docs/mvp/web-ui/          （与 app 同属 web-ui）
└── lib/
    ├── job-engine/               →  docs/mvp/job-engine/      （已有 · 已修订 session 必填）
    ├── providers/                →  docs/mvp/providers/       （已有 · Non-Duties 已补）
    ├── db/                       →  docs/mvp/db/              （已有 · 扩表已修订）
    ├── storage/                  →  docs/mvp/storage/         （已有 · 基本不动）
    ├── prompt/                   →  docs/mvp/prompt/          （已有 · 基本不动）
    ├── web-client/               →  docs/mvp/web-client/      （文档已补）
    ├── library/                  →  docs/mvp/library/         （已实现：资产域与只读历史）
    └── user-config/              →  docs/mvp/user-config/     （边界文档 · 后续实现）
```

| 代码路径 | 文档目录 | 本轮动作 | 一句话职责 |
|----------|----------|----------|------------|
| `src/lib/library/` | `docs/mvp/library/` | **已实现** | Project / Session 归属、History、Favorite、模型启用偏好 |
| `src/lib/db/` | `docs/mvp/db/` | **已修订** | schema + queries；业务库唯一真相 |
| `src/lib/job-engine/` | `docs/mvp/job-engine/` | **已修订** | 扇出生成与状态推进；不管 History/Gallery/Project CRUD |
| `src/lib/providers/` | `docs/mvp/providers/` | **小修订** | 厂商适配；密钥来源仍 env（本轮） |
| `src/lib/user-config/` | `docs/mvp/user-config/` | **边界文档** | 用户目录加密配置；与业务库分离 |
| `src/lib/web-client/` | `docs/mvp/web-client/` | **已补文档** | 浏览器侧 API/轮询/capabilities 派生 |
| `src/app/` + `components/` | `docs/mvp/web-ui/` | **已修订** | Project 门禁、Generate/History/Gallery/Models/Providers |
| `src/app/api/` | `docs/mvp/api/` | **已修订** | 路由清单 + constraints |
| `src/lib/storage/` | `docs/mvp/storage/` | 基本不动 | 图片转存 |
| `src/lib/prompt/` | `docs/mvp/prompt/` | 基本不动 | prompt 预处理 |

**刻意不建**: `docs/mvp/controllers/`、`services/`、`repositories/`。

跨模块检查: [`phase8-library-consistency.md`](./phase8-library-consistency.md)

---

## 2. 单模块文档套件（plan-module-design）

| 序号 | 文件 | 何时要 |
|------|------|--------|
| ① | `goals-duty.md` | 必须 |
| ② | `architecture.md` | 必须 |
| ③ | `data-model.md` | 有领域状态则写 |
| ④ | `dfd-interface.md` | 必须 |
| ⑤ | `use-case.md` | 有多步编排则写 |
| ⑥ | `non-functional.md` | 有明确工程约束则写 |
| ⑦ | `test.md` | 必须 |

---

## 3. 已锁定的产品不变量

1. Generate：先选/建 Project → 进工作台；面板内只选/建该 Project 下 Session；最近约 10 次。
2. 无零散 Session：`Session.project_id` 必填；`Generation.session_id` 必填。
3. History：`Project → Session → Generation`，可看图。
4. Gallery：收藏单张 Image，可追溯到 Job。
5. Models：启用池；Generate：当次勾选。
6. Providers：本轮 `.env`；后续用户目录加密 SQLite（`user-config`）。
7. 状态：沿用既有枚举；补齐 UI 可见性。
8. negativePrompt：全部勾选支持时 Advanced 可选。

---

## 4. 当前进度（文档）

| 模块 | ① goals | ② arch | ③ data | ④ dfd | ⑤ use | ⑥ nfr | ⑦ test |
|------|---------|--------|--------|-------|-------|-------|--------|
| library | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| db | — | — | ✅ 修订 | — | — | — | — |
| job-engine | ✅ 修订 | 既有 | — | ✅ 修订 | ✅ 修订 | — | 既有 |
| api | constraints §12–§16 + quickstart ✅ | — | — | — | — | — | — |
| web-client | ✅ | ✅ | — | ✅ | — | — | ✅ |
| web-ui | ✅ | ✅ | — | ✅ | ✅ | — | ✅ |
| providers | ✅ 小修 | 既有 | 既有 | 既有 | — | — | 既有 |
| user-config | ✅ | ✅ | — | — | — | ✅ | ✅ 意图 |
| storage / prompt | 不动 | | | | | | |

---

## 5. 实施状态（2026-07-16）

**API 契约权威**: `docs/mvp/api/constraints.md` **§12–§16**（页面矩阵、DTO、迁移）。

1. ✅ `src/lib/db` schema + 显式幂等迁移（projects / favorites / prefs；收紧 NOT NULL；删除无 Session 旧 generation）
2. ✅ `src/lib/library/` + §14 API 路由；Session/History 列表只读
3. ✅ job-engine / 测试改为 sessionId 必填；扇出上限 8，目标提交并发隔离
4. ✅ web-client 全资源 API；Generate 工作台接入 Project/Session 门禁、Recent 10、收藏和 negativePrompt
5. ✅ 同页 view-state 接入 History / Gallery / Models / Providers；user-config 另开
