# prompt 模块 · goals-duty

> 模块路径: `src/lib/prompt/`
> 文档顺序: ① goals-duty(本文)

---

## 1. 模块定位

prompt 模块位于 `src/lib/prompt/`，与 providers、job-engine、storage、db 平级，同属 `src/lib/` 业务层。

在系统中的位置:

```
API 层
  → job-engine
      → prompt.process()    ← 本模块
      → providers.submit()
```

job-engine 在调用 providers 之前，先将用户输入的 prompt 交给 prompt 模块处理。providers 收到的永远是处理后的 prompt，不自行改写。

---

## 2. Design Goals（设计目标）

1. **为 prompt 预处理提供统一入口，MVP 透传**
   - 所有 prompt 经过 `process()` 函数，MVP 原样返回。
   - 衡量标准: 后续加翻译、优化、模板等功能时，只改 prompt 模块，不改 job-engine 和 providers。

2. **让 prompt 处理可配置、可关闭**
   - 用户可通过环境变量或配置关闭特定处理步骤。

---

## 3. Duties（职责）

1. **prompt 预处理**: 接收原始 prompt，返回处理后的 prompt。MVP 实现为透传（identity function）。

---

## 4. Non-Duties（非职责）

1. **不做 prompt 优化/增强（MVP）**: 调用 LLM 改写 prompt 是后续迭代职责。
2. **不做 prompt 翻译（MVP）**: 多语言翻译是后续迭代职责。
3. **不管理 prompt 历史**: 历史 prompt 存在 generations 表的 prompt 字段，不由 prompt 模块管理。
4. **不渲染 UI**: prompt 输入由前端/API 层负责。
5. **不调用 provider**: prompt 模块不发起任何图片生成请求。

---

## 5. MVP 实现

```
src/lib/prompt/
├── index.ts       # 导出 process()
└── process.ts     # MVP: return input as-is
```

```typescript
// MVP 实现
function process(prompt: string): string {
  return prompt;
}
```

---

## 6. 后续演进方向（不在 MVP 范围）

| 功能 | 说明 |
|------|------|
| 模板变量替换 | `{{style}}` 占位符替换 |
| 负向提示词自动补全 | 根据正向 prompt 生成默认 negative prompt |
| 多语言翻译 | 中文 prompt 翻译为英文后发送 |
| LLM 优化 | 调用文本 LLM 增强 prompt 质量 |

---

## 自检（提交前）

- **一句话存在意义**: prompt 模块是 prompt 预处理的统一入口，MVP 透传，后续可扩展。
- **不该做什么**: 不调 provider、不存历史、不做优化（MVP）。
- **位置**: `src/lib/prompt/`，由 job-engine 调用，providers 不依赖。
