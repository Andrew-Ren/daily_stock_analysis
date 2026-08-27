# Dashboard Overview 看板

Dashboard Overview 是 Web 首页的默认工作台视图，用于在没有打开具体报告时集中展示今日需要关注的市场、个人、自选、任务与数据刷新状态。

## 页面结构

首版采用四区布局：

- `Market`：最近一次大盘复盘、复盘时间、复盘次数和 What Changed。
- `Personal`：自选股数量、今日已分析覆盖率、待分析数量和今日高分股票。
- `Activity`：当前 pending / processing / cancel_requested 任务数量与进度。
- `System`：数据刷新状态、个股记录数量和数据质量契约接入状态。

## What Changed

`What Changed` 基于最近两条大盘复盘历史记录推导，不额外触发分析任务。

当前推导字段：

- 复盘时间变化
- 情绪分变化
- 操作建议变化
- 市场 region 变化
- 摘要变化

如果只有一条大盘复盘记录，页面提示再完成一次后展示变化；如果没有复盘记录，页面提供运行大盘复盘入口。

## 数据来源

首版复用现有前端状态，不新增后端接口：

- `marketReviewHistoryItems`：大盘复盘历史。
- `stockBarItems`：个股历史聚合栏。
- `watchlistRows`：自选股今日状态。
- `todayAnalysisItems`：今日分析结果排行。
- `activeTasks`：当前运行任务。

这使看板可以独立合入，不依赖新的数据质量聚合接口。

## 操作入口

看板只连接已有页面和动作：

- 运行大盘复盘。
- 打开最近大盘复盘。
- 查看自选股。
- 查看今日分析。
- 查看任务面板。
- 刷新看板数据。

未新增个股详情页、日历页或数据中心路由。

## 后续接入

后续 PR 可在不改页面结构的前提下继续增强：

1. 接入 `/api/v1/data/overview` 后，把 `System` 区的数据质量契约状态替换为真实 provider/dataset 状态。
2. 个股研究页落地后，把今日高分股票和自选股条目跳转到 `stock.view`。
3. 大盘详情页落地后，把 Market 区的指数、板块、概念摘要接入 EntityLink。
4. Calendar 落地后，把财报、分红和宏观事件加入 `Personal` 或 `System` 区的 Next Action。
