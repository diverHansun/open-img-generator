# providers 模块 · goals-duty

> 模块路径:`src/lib/providers/`
> 文档顺序:① goals-duty(本文)→ ② architecture → ③ data-model → ④ dfd-interface → ⑤ use-case(可选)→ ⑥ non-functional(可选)→ ⑦ test

---

## 1. Design Goals(设计目标)

1. **让"新增一家图片生成厂商"的成本最小化**
   - 加一家厂商 = 加一个 adapter 文件 + 在 registry 登记,不需要改 job-engine、API 或其他 adapter。
   - 衡量标准:接入第 8 家时,不改动任何已有 adapter 和 job-engine 的代码。

2. **把厂商间的协议/字段/能力差异藏在一个统一接口身后**
   - 上层(job-engine)只面对 `ImageProvider` 接口,不感知:同步 HTTP / 异步队列 / 多模态对话三种协议形态、字段命名差异(`image_size` vs `size` vs messages.content)、结果 URL 临时性。

3. **让"某 provider 能做什么"成为可查询的显式声明**
   - 能力差异(纯文生图 / 图生图 / 多图融合 / 组图 / 张数上限 / 尺寸枚举)通过 capabilities 声明,供前端显隐选项 + job-engine 扇出前校验降级,而不是调用时才发现不支持。

4. **provider 启用按需,缺 key 不报错**
   - 开源工具语境:用户按需配置 API key,哪个 key 存在哪个 provider 就启用;缺 key 静默不启用,不抛错。

---

## 2. Duties(职责)

1. **统一生成接口**:对外提供 `submit(req, model)`;sync 厂商当场返回结果,async 厂商返回任务句柄。
2. **统一推进/取消接口**:对 async 厂商提供 `poll(jobHandle)` 与 `cancel(jobHandle)`;sync 厂商无此职责。
3. **请求归一化**:把上层传入的归一化请求(NormalizedRequest)翻译成各家厂商的真实请求体(含厂商特技透传)。
4. **响应归一化**:把各家厂商的响应体解析成统一的 SubmitResult / PollResult（含 ProviderImageRef 与 ProviderError）。
   - **注意:不负责下载/转存图片**——只返回厂商临时 URL,转存由 job-engine + storage 负责(见 Non-Duties #1)。
5. **能力声明**:每个 provider 声明 capabilities(支持的模式/张数上限/尺寸/宽高比),供 UI 显隐 + 扇出校验降级。
6. **启用注册**:registry 按 env key 判断哪些 provider 启用,懒初始化 adapter 实例,对外提供已启用列表与按 id 取实例。

---

## 3. Non-Duties(非职责)

1. **不下载、不转存图片**:adapter 只返回厂商临时 URL + 元数据(宽高/seed/index);下载临时 URL 并写入我们存储是 job-engine + storage 的职责。providers 不依赖 storage。
2. **不扇出生成任务**:扇出(一次生成发多个 provider)是 job-engine 的职责;providers 只服务单个 (provider, model) 调用。
3. **不持久化任何状态**:不写库、不维护任务表;任务状态持久化是 job-engine + db 的职责。providers 是无状态调用层。
4. **不做成本预估**:不做积分、不做定价表、不做成本计算(项目已明确砍掉成本预估)。
5. **不渲染 UI、不处理 HTTP 路由**:API 层负责传输;providers 不感知 HTTP 请求/响应对象。
6. **不做 prompt 优化**:收到什么 prompt 就发什么;prompt 预处理是 prompt 模块的职责。
7. **不自动重试/熔断/限流**:单次调用失败即返回失败结果;重试/限流策略由 job-engine 决定。adapter 内部只做单次调用的超时保护。

---

## 自检(提交前)

- **一句话存在意义**:providers 把多家异质图片厂商藏在一个可扩展的统一接口身后,让上层只面对"生成请求/结果",加一家厂商不动上层。
- **不该做什么**:不存图、不扇出、不写库、不算成本、不优化 prompt、不重试。
- **职责重叠风险**:与 job-engine 的边界——providers 只管单次调用,job-engine 管扇出与推进;与 storage 的边界——providers 只给临时 URL,storage 管持久化;与 prompt 的边界——providers 不改 prompt。无重叠。
