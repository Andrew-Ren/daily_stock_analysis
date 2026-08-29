# 选股解释契约

选股候选同时返回 `why_selected`、`why_now` 和 `explanation_quality`。解释由后端在候选归一化和 DSA 数据补充完成后生成，Web 只展示契约，不再根据 `change_pct`、`amount` 或 LLM 字段自行猜测。

## 字段

每条 explanation item 包含：

- `code`：稳定原因代码，例如 `selection_reason`、`top_factors`、`news`、`quote_change_pct`、`awaiting_evidence`。
- `text`：用户可见说明。
- `source`：`screening`、`realtime_quote`、新闻来源、事件来源或 `llm`。
- `quality`：`observed`、`inferred` 或 `unknown`。
- `value`：可选数值；真实 `0` 必须原样保留。

`explanation_quality.why_selected/why_now` 汇总为 `ok`、`partial` 或 `unknown`。

## Why Selected

确定性本地解释优先使用 screening reason 和最高的本地因子分数。即使 LLM 未配置、超时或返回无效结构，候选仍至少返回确定性排序/入选说明；LLM 不是本地解释的前置条件。

## Why Now

时点解释只使用带来源的证据：DSA 新闻、事件，以及 `dsa_context.quote` 中明确存在的实时行情字段。事件还必须带可解析的 `published_date`，且发布时间在最近 30 天内；缺日期或过期事件不标记为 observed。候选顶层的 `change_pct=0` 或 `amount=0` 不能单独证明数据真实存在，因为旧数据源可能用 0 表示缺失；没有 quote provenance 时返回 `awaiting_evidence`，不会写成“当前涨跌幅 0%”。

当 `dsa_context.quote.change_pct` 明确存在且为 `0` 时，它是合法平盘数据，返回 `value=0` 和 `quality=observed`。LLM catalyst 可作为 `inferred` 补充，但不能冒充观测事实。

## 当前阶段边界

本阶段只完成 API explanation 和 Web 展示。Issue #2282 中的策略 metadata 扩充、结果行 action、run history diff、export/backtest 等仍是后续范围。

## 回滚

移除 explanation 生成、Web 字段/卡片和对应测试即可回滚；原候选字段与 screening 排序流程保持兼容。
