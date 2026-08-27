# 个股研究工作台

个股研究工作台是 Web 路由 `/stocks/:stockCode`，用于把单个标的的行情、历史、报告、证据和后续动作放到一个页面。

## 首版范围

页面首版复用现有 API，不新增后端数据源：

- `GET /api/v1/stocks/{code}/quote`：行情快照。
- `GET /api/v1/stocks/{code}/history`：K 线概览。
- `GET /api/v1/history?stock_code={code}`：历史报告列表。
- `GET /api/v1/history/{id}`：最新报告详情。
- `GET /api/v1/history/{id}/news`：关联新闻。

## 页面区域

- `Header`：股票名称、代码、最新摘要和快捷动作。
- `MarketSnapshot`：最新价、涨跌幅、最高/最低、成交额、开盘、昨收、成交量、更新时间。
- `Chart`：最近 K 线收盘价趋势。
- `ResearchSummary`：最新报告摘要、趋势判断、操作建议和情绪分。
- `Evidence`：`AnalysisContextPack` 数据块的新鲜度、质量状态、来源和告警。
- `Events`：报告关联新闻。
- `Reports`：该标的最近历史报告，可在页面内切换。
- `Monitors`：跳转告警中心，为价格或 thesis 失效条件配置提醒。
- `Copilot`：带股票和最新报告上下文进入问股。

## 行为边界

- 页面允许部分数据失败：行情、K 线、历史报告互不阻断。
- 只有全部主数据请求失败时，页面展示顶层错误。
- 监控入口只跳转告警中心，不在本页面直接创建规则。
- Copilot 使用当前股票代码、名称和最新报告 id 作为上下文。

## 后续增强

1. 接入 `ResearchArtifact.structured_report` 后，ResearchSummary 和 Evidence 优先消费结构化字段。
2. EntityLink 可用后，报告、信号、告警和持仓入口统一使用 action model。
3. 监控中心支持 thesis invalidation 后，把报告失效条件转成可编辑规则。
4. 大盘看板与自选股列表可直接跳转到 `/stocks/:stockCode`。
