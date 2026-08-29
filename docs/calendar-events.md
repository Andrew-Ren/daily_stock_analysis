# 日历事件 API

本文档说明 Issue #2285 的第一阶段：建立可被 Dashboard、股票详情和后续告警提醒共同消费的持久化事件域。当前阶段只提供手工事件和统一查询 API，不声称已有完整外部财经日历覆盖。

## 数据契约

`calendar_events` 使用以下核心字段：

| 字段 | 说明 |
| --- | --- |
| `event_type` | `earnings`、`dividend`、`lockup_unlock`、`macro`、`user` 或 `monitor` |
| `scope_type` | `market`、`symbol`、`portfolio`、`sector` 或 `custom` |
| `scope_value` | scope 的稳定标识；market/symbol 创建时由后端按 `market` / `symbol` 归一 |
| `market` / `symbol` | 可选的市场和股票过滤字段 |
| `event_date` | 事件日期；首阶段不伪造未知的具体发生时间 |
| `source` | 当前创建 API 固定为 `user` |
| `coverage_status` | 手工确认事件固定为 `confirmed`；为后续外部来源保留显式覆盖状态 |
| `metadata` | 结构化附加信息；不得写入密钥或账号敏感信息 |

## API

- `POST /api/v1/calendar/events`：创建手工事件。
- `GET /api/v1/calendar/events`：按日期范围、scope、market 或 symbol 查询事件。
- `DELETE /api/v1/calendar/events/{event_id}`：删除手工事件；外部来源事件不允许通过该入口删除。

这些接口继承现有 `/api/v1/*` 管理员会话认证：`ADMIN_AUTH_ENABLED=true` 时必须携带有效的管理员 Cookie，并可能返回 `401`；关闭认证时不强制 Cookie。本功能不新增独立认证方式。

列表查询的日期范围首尾均包含。未传日期时，默认返回从服务器当天开始的 7 个自然日（当天到 `today + 6 days`）；若起始日接近 `9999-12-31`，结束日钳制到 `date.max`，不会因默认窗口溢出而返回 500。`page` 范围为 1 到 1,000,000，超出范围在进入数据库前返回 4xx；repository 也拒绝超过数据库整数范围的 offset。Dashboard 可以不传 scope 获取混合事件；股票详情传 `symbol`，同一 API 会把省略的 `scope_type` 视为 `symbol`，并对同时出现的 `scope_value` 使用同一身份规则归一和校验，严格返回该股票事件，不在客户端重新拼装或猜测归属。写入与查询都会复用仓库统一股票身份规范化，例如裸五位港股 `00700`、`00700.HK` 与 `HK00700` 统一为 `HK00700`，`600519.SH` / `600519` 统一为 `600519`。symbol scope 的 market 由解析身份自动回填；显式 market 会作为裸数字身份的消歧义 hint，解析后若仍冲突或 symbol 无法解析则返回 400，自由文本标识应使用 custom scope。

`metadata` 必须是只包含有限 JSON 数值的对象；`NaN` / `Infinity` 等非有限值在写入前返回 400。历史脏数据若包含非有限 metadata，列表会降级为空对象，避免单条记录拖垮整个响应。`symbol` 只属于 `scope_type=symbol` 的可查询契约；portfolio、sector 和 custom 事件若携带 symbol 会返回 400，避免写入后无法通过股票详情查询。删除路径的 `event_id` 限制为数据库有符号 64 位正整数，越界请求在数据库查询前返回 422。

## 覆盖状态

每个列表响应都包含：

```json
{
  "coverage": {
    "status": "manual_only",
    "external_sources_configured": false,
    "message": "External calendar coverage is not configured; results include only persisted user events."
  }
}
```

空列表不等于“未来没有事件”。`manual_only` 明确表示当前没有完整外部 vendor 数据源，用户手工事件仍可独立使用。后续接入外部来源时必须扩展该覆盖契约，不能把抓取失败或未配置静默解释为无事件。

## 阶段边界与回滚

本阶段不包含 Dashboard / 股票详情组件、不实现 `days_before_event` 告警规则、不运行 LLM，也不接入 TickFlow 或其他 vendor。后续提醒必须复用现有 Alert Center 的调度和通知链路，不新增第二套 scheduler。

回滚时 revert 对应 PR 即可移除 API、service、repository、schema 和 ORM 定义。`Base.metadata.create_all()` 已创建的 `calendar_events` 表和数据不会自动删除；如需物理清理，必须先备份并由维护者显式确认。
