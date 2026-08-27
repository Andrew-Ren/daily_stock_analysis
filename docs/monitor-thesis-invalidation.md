# 监控中心假设失效雷达

Web 告警中心新增“假设失效雷达”，用于把已有告警规则和触发历史组织成投资假设守卫视角。

## 展示结构

| 区域 | 内容 | 数据来源 |
| --- | --- | --- |
| 守卫覆盖 | 已覆盖的守卫类别数量、启用规则数 | 告警规则列表 |
| 近期触发 | `triggered` 状态的触发数量 | 告警触发历史 |
| 数据缺口 | `degraded` / `failed` 状态数量 | 告警触发历史 |
| 高优先级 | `critical` 且启用的规则数量 | 告警规则列表 |
| 守卫矩阵 | 价格、技术、组合、大盘四类规则覆盖情况 | 告警规则类型 |
| 近期失效线索 | 最近触发、降级或失败的目标、观察值、阈值、原因 | 告警触发历史 |

## 守卫分类

| 分类 | 告警类型 |
| --- | --- |
| 价格失效 | `price_cross`、`price_change_percent`、`volume_spike` |
| 技术失效 | `ma_price_cross`、`rsi_threshold`、`macd_cross`、`kdj_cross`、`cci_threshold` |
| 组合失效 | `portfolio_stop_loss`、`portfolio_concentration`、`portfolio_drawdown`、`portfolio_price_stale` |
| 大盘失效 | `market_light_status`、`market_light_score_drop` |

## 边界

- 本次只做前端聚合展示，不新增后端规则类型。
- 规则创建、启停、测试、删除和触发历史表格保持原有交互。
- `degraded` 和 `failed` 归为数据缺口，提醒用户先复核数据与规则可用性。

## 后续扩展

- ResearchArtifact 接入后，可把 `invalidation_conditions` 直接生成或关联为告警规则。
- 单股研究页接入后，可从“假设失效雷达”跳到对应股票工作台。
- 组合页接入后，可把失效线索按账户、行业、货币暴露拆分。
