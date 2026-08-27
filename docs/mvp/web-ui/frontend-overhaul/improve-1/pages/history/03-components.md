# History · 组件

| 组件 | 职责 |
|---|---|
| `HistoryPage` | URL page、聚合请求、自动重新验证与 Detail 弹层状态 |
| `HistorySummary` | totals |
| `SessionHistoryGroup` | Session header、展开、组内 cursor |
| `GenerationHistoryTable` | desktop/mobile collection |
| `GenerationHistoryRow` | batch thumbnail strip 与 Detail 弹层触发 |
| `SessionLoadMore` | 独立组加载状态 |
| `Pagination` | shared 外层页码 |

`SessionHistoryGroup` 持有自己追加 items/cursor，不持有 API detail。行复用 `GenerationStatus` 与 `ThumbnailStrip`，但不复用 Gallery tile；`GenerationDetailDialog` 只在用户打开后 mount。
