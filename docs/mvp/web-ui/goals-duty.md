# web-ui 模块 · goals-duty

> 模块路径: `src/app/`（页面）+ `src/components/`
> 文档顺序: ① goals-duty(本文) → ② architecture → ④ dfd-interface → ⑤ use-case → ⑦ test
> 修订说明: 2026-07-16 Project 门禁、History/Gallery/Models、最近 10 次、状态可见性；取消零散 Session

---

## 1. Design Goals（设计目标）

1. **Generate 工作台绑定单一 Project 作用域**
   - 进入主面板前必须选/建 Project；面板内只切换/新建该 Project 下的 Session。
   - 衡量标准: 无 Project 时无法到达可点 Generate 的主面板。

2. **把「选模型 → 写 prompt → 看按模型分组的结果」做成单一工作台**
   - 结果区展示当前 Project 下**最近约 10 次** generation（可页内下滑）；更早记录去 History。
   - 参数控件由**启用池 ∩ 当次勾选**模型的 capabilities 驱动；无声明则不展示假控件。

3. **生图过程状态始终可见**
   - 每个 job 展示 pending/running/completed/failed（及 error）；禁止「点了 Generate 后空白未知」。
   - 衡量标准: POST 后至终态，用户能区分各模型进度。

4. **History / Gallery / Models / Providers 职责分离**
   - History：结构化 `Project → Session → Generation`（可看图）。
   - Gallery：仅收藏 Image 的视觉浏览，可回溯到 Job。
   - Models：启用池开关；Generate 右侧为当次勾选。
   - Providers：本轮展示配置/健康状态（key 仍 env）；不写明文 key 到前端。

5. **只消费 HTTP API，不直连厂商、不绕过 job-engine / library**

---

## 2. Duties（职责）

1. **Project 门禁 UI**: 选/建 Project 后再进入 Generate 主面板。
2. **Session 选择器**: 在当前 Project 下选已有 Session、新建 Session、默认续写当前 Session。
3. **加载启用池与当次勾选**: `GET providers` ∩ `GET model-preferences` → 右侧多选 targets。
4. **提交生成**: `POST /api/generations`，**必带 sessionId**；轮询 `GET /api/generations/:id` 直至终态。
5. **渲染最近 N 次与当前结果**: 按 job 分行；展示 status 与图片。
6. **History 页**: 树形浏览；可看图；支持 Session 迁 Project（调 move API）。
7. **Gallery 页**: 收藏列表；收藏/取消；详情回溯。
8. **Models 页**: 切换 model-preferences。
9. **Providers 页**: 展示已配置/未配置与健康（不展示 key 值）。
10. **negativePrompt**: 仅当当次勾选模型**全部**支持时在 Advanced 显示（可选填）。

---

## 3. Non-Duties（非职责）

1. **不实现扇出编排与状态机**: job-engine。
2. **不持有 API key、不写用户加密库**: providers / user-config（后续）。
3. **不持久化图片文件**: 只展示 `/api/images/:id`。
4. **不做多用户账号**。
5. **不发明 capabilities 中不存在的参数控件**。
6. **不在服务端算宽高比交集**: 交集仅 UI；非法组合以服务端 400 为准。
7. **不实现 Inbox / 零散 Session UI**。
8. **不做独立设计系统库（MVP）**。

---

## 自检（提交前）

- **一句话**: web-ui 是 Project 门禁下的多模型工作台 + History/Gallery/Models/Providers 壳。
- **不该做**: 假参数、直连厂商、密钥、零散 Session。
- **重叠风险**: 与 library——UI vs 资产命令；与 web-client——可把 fetch/poll 下沉到 web-client。
