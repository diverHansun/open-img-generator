**Status:** Superseded by module docs under `docs/mvp/` (2026-07-15).
**Canonical docs for Codex implementation:**
- `docs/mvp/job-engine/*` (fan-out)
- `docs/mvp/providers/*` (public aspectRatio)
- `docs/mvp/web-ui/*` (workbench)
- `docs/mvp/api/constraints.md`

This file remains as the product brainstorm snapshot; do not implement from it if it conflicts with `docs/mvp/`.

**Implementation note (2026-07-16):** The current `mvp` branch has since added the first provider batch (SiliconFlow + Zhipu) behind the same capabilities/registry contract. The non-goal below describes the original brainstorm slice; it does not remove those providers from the current implementation. Kling remains a separate future adapter and must not reuse DashScope.

---

# Fan-out + Frontend Workbench Design

---

## 1. Goal

Enable the Generate workbench to:

1. Select **one or more** enabled provider/models
2. Submit **one prompt** that fans out to N parallel generation jobs
3. Drive all parameter controls from **selected models’ capabilities** (no fake params)
4. Show results **grouped by model**, matching the open-img-generator visual IA

Non-goals for this slice:

- Auth / multi-user
- Cost estimation
- Cancel API (adapter cancel may exist; no public endpoint yet)
- Persisting width/height/count/seed/providerOptions (unchanged: runtime only)
- New providers beyond fal + ZenMux MVP models

---

## 2. Product Decisions (Locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Fan-out persistence | **Plan B:** 1 `generations` row + N `generation_jobs` |
| 2 | Shared size input | Public **`aspectRatio`** on the request; each adapter maps to vendor size |
| 3 | Parameter UI source | **Capabilities of currently selected models only** |
| 4 | Unsupported params | If capabilities do not declare Guidance / Steps / Quality / Safety → **do not render** |
| 5 | Session | Snapshot decision: optional；**已被 `docs/mvp/` 取代，当前实现为必填** |

### 2.1 Capabilities → UI rules

**Single model selected**

- Aspect ratio options = that provider+model’s `supportedAspectRatios` (after public-ratio normalization; see §4)
- Seed control shown iff `supportsSeed`
- Count max = that model’s `maxCount` (ZenMux sync still enforced as `count=1` in MVP if product rule remains)
- Guidance / Steps / Quality / Safety: **hidden** until capabilities gain corresponding fields

**Multiple models selected**

- Shared controls (aspect ratio): show the **intersection** of selected models’ public aspect ratios. If intersection is empty → block Generate with a clear error (“所选模型没有共同宽高比”).
- Seed: show if **any** selected model supports seed; value is sent only on targets that support it; others omit.
- Count: per-target (each model row / target can have its own count up to that model’s `maxCount`), or a single shared count clamped per target — **MVP choice: shared count UI, clamp/validate per target** (simpler). ZenMux target with `count>1` fails validation with existing MVP rule if kept.
- Params not in any selected model’s capabilities → not shown.

**No model selected**

- Parameter panel shows empty / disabled state; Generate disabled.

---

## 3. API Contract

### 3.1 Breaking change to `POST /api/generations`

Replace single `provider` + `model` with `targets[]`. Shared runtime params stay at top level.

```json
{
  "prompt": "a red balloon over a quiet lake",
  "sessionId": "required-existing-session-uuid",
  "aspectRatio": "1:1",
  "width": null,
  "height": null,
  "count": 1,
  "seed": null,
  "negativePrompt": null,
  "targets": [
    { "provider": "fal", "model": "fal-ai/flux/schnell" },
    { "provider": "zenmux", "model": "openai/gpt-image-2" }
  ]
}
```

**Rules**

- `targets`: required, non-empty, unique `(provider, model)` pairs
- Each target must resolve via registry + capabilities
- Top-level `aspectRatio` / width+height / count / seed / negativePrompt apply as shared inputs; validator + per-adapter mapping enforce support
- Response: existing `GenerationView` shape, now with **multiple jobs** and images keyed by job/model

### 3.2 `GET /api/generations/:id` / session views

Unchanged route shape. Advancement: continue **lazy poll** — on read, advance **all** non-terminal jobs for that generation (parallel per job, same as today’s single-job advance).

### 3.3 `GET /api/providers`

Unchanged: returns enabled providers + capabilities. Frontend uses this as the single source for model list and control options.

---

## 4. Aspect Ratio Normalization

Public UI / API use **canonical ratios** (strings like `1:1`, `3:2`, `2:3`, `4:3`, `16:9`, …).

Each adapter owns a **mapping table**:

| Public ratio | fal (FLUX Schnell) | ZenMux (gpt-image-2) |
|--------------|--------------------|----------------------|
| `1:1` | `square_hd` (or `square`) | `1024x1024` |
| `3:2` / landscape | `landscape_4_3` or closest | `1536x1024` |
| `2:3` / portrait | `portrait_4_3` or closest | `1024x1536` |
| `16:9` | `landscape_16_9` | — (omit from ZenMux capabilities) |
| `9:16` | `portrait_16_9` | — |

**Capability fix (required for fan-out UI)**

- fal capabilities today expose vendor `supportedSizes` and empty `supportedAspectRatios`. Update fal capabilities to expose **public** `supportedAspectRatios` (e.g. `1:1`, `4:3`, `3:4`, `16:9`, `9:16`) that the adapter can map.
- ZenMux already lists public ratios; keep mapping in adapter (already partially done).

If client sends `width`+`height` instead of ratio, existing validator rules apply; adapters map or reject.

---

## 5. Backend Behavior

### 5.1 Create path

1. Validate prompt + targets + shared params against each target’s capabilities
2. Create one `generations` row (prompt, sessionId, status derived from jobs)
3. Create N `generation_jobs` (one per target), each with provider/model
4. Dispatch all jobs (async submit / sync complete) — failure on one job does not roll back others after create; job-level error status
5. Return `GenerationView` with all jobs + any completed images

### 5.2 Status aggregation

Generation status from jobs (MVP):

- all succeeded → `succeeded`
- any failed and none running/pending → `failed` if all failed; else `partial` **or** keep `succeeded`/`failed`/`running` only if schema lacks `partial` — **use existing status enum**; if no `partial`, prefer: any running/pending → `running`; else if any succeeded → `succeeded` (with failed jobs visible); else `failed`

Document exact mapping against current `generations.status` / job status enums in implementation plan.

### 5.3 Concurrent advance

Fix optimistic lock so concurrent `GET` advances do not double-apply the same job transition (known gap from review).

---

## 6. Frontend Architecture

### 6.1 Stack

- Next.js App Router pages under existing project (same repo)
- Client components for workbench interactivity
- Fetch `/api/providers`, `/api/sessions`, `/api/generations`

### 6.2 Layout (preserve prototype IA)

```
┌─────────┬──────────────────────────────┬─────────────────┐
│ Nav     │ Compose (prompt + Generate)  │ Models checklist│
│         │ Results by model             │ Params (caps)   │
│         │                              │ Provider status │
└─────────┴──────────────────────────────┴─────────────────┘
```

### 6.3 Key UI behaviors

- Model list from `GET /api/providers` (enabled only)
- Multi-select models → builds `targets[]`
- Params panel recomputes options whenever selection changes (§2.1)
- After Generate: poll `GET /api/generations/:id` until all jobs terminal (or session refresh)
- Results: one section/row per target model; show job status + images
- Do **not** show Guidance / Steps / Quality / Safety placeholders

### 6.4 Visual

Align tokens/spacing with open-img-generator mock; distinctive but not purple-template defaults. Prefer existing prototype structure over inventing a new IA.

---

## 7. Testing

**Backend**

- Unit: request validation for `targets[]`, intersection not required server-side (client may send any ratio supported per target — server validates **each** target can accept the shared ratio)
- Unit: aspectRatio → fal/zenmux mapping tables
- Contract: `POST /api/generations` with 2 targets creates 2 jobs
- Contract: advance advances all jobs
- Integration: mocked HTTP dual-provider fan-out

**Frontend**

- Capabilities-driven visibility (seed hidden for ZenMux-only selection; shown when fal selected)
- Aspect options change with selection; multi-select uses intersection
- Empty selection disables Generate

**Note on server validation:** Server validates that **each** target supports the submitted `aspectRatio` (not that the client computed intersection). Intersection is a **UI** rule to avoid unusable shared values.

---

## 8. Implementation Order

1. Spec approval (this doc)
2. Implementation plan (`docs/superpowers/plans/...`)
3. Backend: capabilities public ratios + mapping + fan-out API + advance-all + lock fix
4. Frontend: workbench page + wire APIs + capabilities-driven params
5. Visual polish vs mock
6. Optional: real-key E2E smoke

---

## 9. Open Points (minor; default if no comment)

1. **Shared vs per-target count:** default shared count, validate per target (ZenMux `count=1` MVP).
2. **Generation status with mixed job outcomes:** default “any success → generation `succeeded`, failed jobs still visible in view”.
3. **fal default public ratios:** map the six fal size enums to the closest public set listed in §4.

---

## 10. Approval

Please confirm this design (especially §2.1 multi-select intersection for aspect ratio, and §3 `targets[]` API). After approval, the next step is a bite-sized implementation plan, then coding.
