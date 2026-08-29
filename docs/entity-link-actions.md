# EntityLink 与跨页面动作模型

本专题定义页面、报告、告警、决策信号、组合持仓和日历事件之间共享的实体引用与动作契约。首版只提供公共 schema、后端 helper、Web 类型和 Web helper；它不新增页面路由，也不把尚未消费实体上下文的普通页面入口标记为可用。

## 范围

已覆盖实体：`stock`、`index`、`sector`、`concept`、`strategy`、`report`、`signal`、`alert`、`portfolio_position`、`calendar_event`。

已覆盖动作：`view`、`analyze`、`watch`、`monitor`、`ask_ai`、`compare`、`track_outcome`。

## 数据结构

`EntityLink` 表示一个可跨页面传递的业务实体。后端字段使用 snake_case，Web 字段使用 camelCase。

```json
{
  "entity_type": "report",
  "entity_id": "123",
  "ref": "report:123",
  "label": "AAPL report",
  "links": {
    "track_outcome": "/decision-signals?sourceReportId=123"
  },
  "actions": [
    {
      "action": "track_outcome",
      "label": "Track Outcome",
      "href": "/decision-signals?sourceReportId=123",
      "available": true,
      "disabled_reason": null,
      "params": {
        "entity_type": "report",
        "entity_id": "123"
      }
    }
  ],
  "metadata": {}
}
```

`metadata` 与 `params` 是不透明扩展字段，不得写入密钥、Cookie、Token、未脱敏账号信息或其他敏感数据。

## 稳定引用

`ref` 格式固定为 `<entity_type>:<entity_id>`。股票实体 ID 格式为 `<MARKET>:<canonical_code>`，例如：

- A 股：`stock:CN:600519`
- 港股：`stock:HK:HK00700`
- 美股：`stock:US:AAPL`

后端统一使用 `make_entity_ref()` / `parse_entity_ref()`，Web 统一使用 `makeEntityRef()` / `parseEntityRef()`。
股票代码带有明确市场身份时（例如 `HK00700`、`AAPL.US`、`2330.TW`），后端从代码推导 market；显式传入 market 时，该 market 同时作为旧裸代码的消歧提示，例如 `8035 + jp` 与 `8035.T` 收敛为同一 ref。显式 market 与代码身份冲突时会 fail closed，避免同一股票生成两个 ref。

## 可用性与 fail-closed 规则

动作出现在 `actions` 中只表示契约认识这个动作，不代表目标页面已能处理它。只有目标页已消费足以定位实体的参数时，动作才可设置 `available=true` 并进入 `links`。

当前唯一可用动作：

| 实体 | 动作 | 路由 | 上下文约束 |
| --- | --- | --- | --- |
| report | track_outcome | `/decision-signals?sourceReportId={entity_id}` | `entity_id` 必须是 JavaScript 可精确表示的 ASCII 正整数（`[1-9][0-9]*` 且不大于 `Number.MAX_SAFE_INTEGER`）；目标页按 `sourceReportId` 过滤 |

其余动作均保持 `available=false`，不会出现在 `links` 中：

- 尚无目标路由时使用具体原因，例如 `stock_detail_route_pending`、`compare_route_pending`、`calendar_route_pending`。
- 目标页存在但尚未消费实体上下文时使用 `entity_action_context_pending`。
- 动作所需上下文格式无效时使用 `invalid_entity_context`。
- 未定义的实体/动作组合使用 `unsupported_action`。

禁用动作可以保留未来目标的 `href` 和结构化 `params`，但调用方不得据此导航。调用方只能把 `available=true` 且存在 `href` 的动作渲染为可执行入口。

## 页面接入边界

Dashboard、个股研究、自选股、监控中心、筛选工作台、组合和日历页面未来接入时，应从公共 `actions` 读取动作语义，并在目标页面完成参数消费和集成测试后再开放相应动作。仅仅存在 `/alerts`、`/chat`、`/portfolio` 或 `/screening` 路由，不足以证明该路由会处理当前实体。

开放一个 pending 动作至少需要：

1. 明确传递的实体参数和编码规则。
2. 目标页面读取并校验该参数。
3. 目标页面据此预选、过滤或执行正确的实体操作。
4. 后端与 Web helper 保持相同的 href、available 和 disabled reason 语义。
5. 添加覆盖“从 EntityLink 生成链接到目标页实际消费参数”的回归测试。

## 实现入口

后端：

- Schema：`api/v1/schemas/entity_link.py`
- Helper：`src/services/entity_link_service.py`
- 测试：`tests/test_entity_link_service.py`

Web：

- 类型：`apps/dsa-web/src/types/entityLink.ts`
- Helper：`apps/dsa-web/src/utils/entityLink.ts`
- 测试：`apps/dsa-web/src/utils/__tests__/entityLink.test.ts`
- 已接入的目标页测试：`apps/dsa-web/src/pages/__tests__/DecisionSignalsPage.test.tsx`

## 兼容与回滚

首版是新增契约，不修改现有 API 响应或页面调用方。回滚时可移除 schema/helper/type 及其测试和文档；在真实业务响应开始携带 `EntityLink` 后，应按对应响应契约另行评估兼容迁移。
