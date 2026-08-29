# Dashboard Overview API

本文档说明 Issue #2277 的后端契约阶段。首页看板必须通过单一只读端点消费持久化/缓存状态，不在浏览器用当前分页数组猜测全量指标，也不在刷新时启动分析或 LLM。

## 端点

`GET /api/v1/dashboard/overview`

响应分为 `market`、`personal`、`activity`、`system` 和第一等的 `what_changed`。每个块包含：

- `quality`：`fresh`、`partial` 或 `unavailable`。
- `sources`：该块实际读取的持久化/缓存来源。
- `stale`：只有来源能可靠判断时才给布尔值；无法证明时为 `null`，不伪造 freshness。
- `limitations`：稳定的降级 code，不返回原始异常或配置秘密。

## 指标语义

- `market.review_count` 使用 History API repository 返回的 `total`，不使用当前已加载页的数组长度。
- `personal.watchlist_count` 每次请求读取当前 runtime config；`active_monitor_count` 使用 Alert repository 的 `total`，不受 `page_size=100` 限制。
- `personal.cached_position_count` 只读取非零缓存仓位 identity，不触发实时估值或写 snapshot，因此块包含 `cached_positions_only`。
- `activity.recent_reports` 排除 market review，并按 history 分页继续读取直到获得最近 5 条非 market 报告或确认历史已耗尽；`task_stats` 只读当前 task queue 统计。
- `system.refresh_starts_analysis` 固定为 `false`。该 service 不依赖 analyzer、LLM client、market-review generation 或 task submission 方法。

## What Changed

首阶段的 `comparison_mode` 固定为 `previous_completed_snapshot`。服务从已经持久化的 market review history 中分页读取结构化 `context_snapshot.market_light_snapshots`，单次请求最多扫描最近 100 条复盘记录；若历史仍未耗尽，会返回 `market_review_history_scan_incomplete` 并将 market/what_changed 降级为 partial。扫描窗口内按 `trade_date` 排序并去重，对每个 region 比较最新日期与严格更早的基线，不把同日重跑或乱序写入直接当作 previous：

- score 变化输出 `market.<region>.score`，并给出 before/after 与 increased/decreased。
- red/yellow/green 状态变化输出 `market.<region>.status`。
- change item 的 quality 取 current/previous 两份快照中较差的一侧；任一侧 partial 会降低整个 what_changed 块，任一侧 unavailable 不生成可靠变化项。
- 没有第二份有效快照时，返回 `previous_completed_snapshot_unavailable`；部分 region 缺基线时整个块标记为 `partial`，并追加 `previous_completed_snapshot_unavailable:<region>`，避免把“缺少基线”误解为“没有变化”。不会临时拉行情或生成一份“当前”快照冒充基线。
- 历史详情读取失败、快照校验失败或扫描被截断等 market limitations 会同步进入 what_changed；剩余较旧快照不能在来源历史不完整时被标记为 fresh。

后续阶段可以在已有持久化契约上增加 watchlist score、portfolio exposure、ranking 和 thesis invalidation 变化；必须先有可靠的 current/previous snapshot identity，不能从页面当前分页或 target 文本猜测。

## 阶段边界与回滚

本阶段不修改 Home 默认选择逻辑、不新增 Web 卡片、不接线刷新按钮，因此旧 PR #2290 的“返回用户自动打开报告导致看板不可达”问题不被带入。后续 Web PR 需消费本 API，并补 loading/partial/empty/success、移动端布局和截图证据。

回滚时 revert 本 PR 即可移除 schema、service、endpoint、测试和文档。没有数据库迁移、配置写入或数据清理步骤。
