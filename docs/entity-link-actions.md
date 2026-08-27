# EntityLink 与跨页面动作模型

本专题定义页面、报告、告警、决策信号、组合持仓和后续日历之间共享的实体引用与动作契约。目标是先收敛一套稳定的“实体是谁、能跳去哪、哪些能力还没落地”的公共语义，避免 Dashboard、个股研究页、自选股、监控中心和日历分别维护不同的跳转规则。

## 范围

首版只提供公共 schema、后端 helper、Web 类型和 Web helper，不新增页面路由，不伪造尚未完成的功能。

已覆盖实体：

- `stock`
- `index`
- `sector`
- `concept`
- `strategy`
- `report`
- `signal`
- `alert`
- `portfolio_position`
- `calendar_event`

已覆盖动作：

- `view`
- `analyze`
- `watch`
- `monitor`
- `ask_ai`
- `compare`
- `track_outcome`

## 数据结构

`EntityLink` 表示一个可跨页面传递的业务实体。

```json
{
  "entity_type": "stock",
  "entity_id": "CN:600519",
  "ref": "stock:CN:600519",
  "label": "贵州茅台",
  "links": {
    "monitor": "/alerts",
    "ask_ai": "/chat"
  },
  "actions": [
    {
      "action": "monitor",
      "label": "Monitor",
      "href": "/alerts",
      "available": true,
      "disabled_reason": null,
      "params": {
        "entity_type": "stock",
        "entity_id": "CN:600519",
        "target_entity_ref": "stock:CN:600519"
      }
    }
  ],
  "metadata": {
    "stock_code": "600519"
  }
}
```

Web 侧同构为 camelCase 字段：

- `entityType`
- `entityId`
- `disabledReason`

`metadata` 与 `params` 是不透明扩展字段。调用方可以携带展示所需的轻量上下文，但不得写入密钥、cookie、token 或未脱敏账号信息。

## 稳定引用

`ref` 格式固定为：

```text
<entity_type>:<entity_id>
```

股票实体 id 格式为：

```text
<MARKET>:<canonical_code>
```

示例：

- A 股：`stock:CN:600519`
- 港股：`stock:HK:HK00700`
- 美股：`stock:US:AAPL`

后端统一使用 `src.services.entity_link_service.make_entity_ref()` 和 `parse_entity_ref()`；Web 统一使用 `src/utils/entityLink.ts` 中的 `makeEntityRef()` 和 `parseEntityRef()`。

## 路由状态

首版明确区分“动作存在”和“目标页面是否已经可用”。尚未实现的目标页必须保留在 `actions` 中，但设置：

```json
{
  "available": false,
  "disabled_reason": "stock_detail_route_pending"
}
```

这样 Dashboard、报告卡片和告警列表可以先渲染统一按钮状态，后续目标页落地后只需要更新公共路由表。

当前可用动作：

| 实体 | 动作 | 路由 |
| --- | --- | --- |
| stock | analyze | `/` |
| stock | watch | `/` |
| stock | monitor | `/alerts` |
| stock | ask_ai | `/chat` |
| strategy | view | `/screening` |
| strategy | monitor | `/alerts` |
| report | monitor | `/alerts` |
| report | track_outcome | `/decision-signals` |
| signal | view | `/decision-signals` |
| signal | track_outcome | `/decision-signals` |
| alert | view | `/alerts` |
| alert | monitor | `/alerts` |
| portfolio_position | view | `/portfolio` |
| portfolio_position | analyze | `/` |
| portfolio_position | monitor | `/alerts` |
| portfolio_position | ask_ai | `/chat` |
| calendar_event | monitor | `/alerts` |

当前 pending 动作：

| 实体 | 动作 | 目标 | 原因 |
| --- | --- | --- | --- |
| stock | view | `/stocks/{code}` | `stock_detail_route_pending` |
| stock | compare | `/stocks/compare` | `compare_route_pending` |
| index | view | `/market` | `market_detail_route_pending` |
| sector | view | `/market` | `market_detail_route_pending` |
| concept | view | `/market` | `market_detail_route_pending` |
| report | view | `/` | `report_detail_route_pending` |
| calendar_event | view | `/calendar` | `calendar_route_pending` |

## 页面复用方式

Dashboard：

- 大盘模块给指数、板块、概念生成 `EntityLink`。
- What Changed 条目挂 `report`、`signal` 或 `alert` 链接。
- 用户动作统一读取 `actions`，只展示 `available=true` 的主按钮，pending 动作可灰显或放入菜单。

个股研究页：

- 页头股票实体使用 `stock` link。
- Evidence、Events、Reports、Monitors 各条记录挂自己的 `report`、`signal`、`alert` link。
- Copilot 输入可直接传 `ref`，避免再次解析股票名或代码。

自选股：

- 每个标的使用 `stock` link。
- Change / State / Next Action 中的动作按钮来自 `actions`。
- 监控按钮使用 `target_entity_ref` 创建或预填告警规则。

监控中心：

- 每条规则保存或展示 `target_entity_ref`。
- 告警触发结果返回 `alert` link，同时保留关联的 `stock`、`signal` 或 `portfolio_position` link。

筛选工作台：

- 策略卡片使用 `strategy` link。
- 候选股票使用 `stock` link。
- Why Selected / Why Now 中的证据条目可以挂 `report` 或 `signal` link。

组合与日历：

- 持仓行使用 `portfolio_position` link。
- 财报、分红、限售、再平衡等事项使用 `calendar_event` link。
- 日历页面落地前，`calendar_event.view` 保持 pending，监控入口先可用。

## 实现入口

后端：

- Schema：`api/v1/schemas/entity_link.py`
- Helper：`src/services/entity_link_service.py`
- 测试：`tests/test_entity_link_service.py`

Web：

- 类型：`apps/dsa-web/src/types/entityLink.ts`
- Helper：`apps/dsa-web/src/utils/entityLink.ts`
- 测试：`apps/dsa-web/src/utils/__tests__/entityLink.test.ts`

## 后续扩展

新增页面时优先改公共路由表，不在页面内硬编码同义动作。

推荐顺序：

1. 个股研究页落地后，把 `stock.view` 改为 `available=true`。
2. 股票对比页落地后，把 `stock.compare` 改为 `available=true`。
3. 大盘详情页落地后，把 `index.view`、`sector.view`、`concept.view` 改为 `available=true`。
4. 报告详情页落地后，把 `report.view` 指向稳定详情路由。
5. 日历页落地后，把 `calendar_event.view` 改为 `available=true`。
