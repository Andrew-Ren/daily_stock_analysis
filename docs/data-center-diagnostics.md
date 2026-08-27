# 数据中心诊断页

Web 新增 `/data-center` 数据中心页，用于集中查看当前数据源配置和运行诊断。

## 当前数据来源

| 区块 | API | 内容 |
| --- | --- | --- |
| 数据源配置 | `/api/v1/system/config?include_schema=true` | `data_source` 分类和数据源相关 key 的配置状态 |
| 选股源历史 | `/api/v1/screening/source-history` | 已分析运行数、fallback 次数、源选用次数、错误次数和样例 |
| 健康快照 | `/api/v1/screening/status` | `sourceHealth` 中 provider / dataset / status / message |
| 运行诊断 | `/api/v1/screening/status` | `diagnostics` 键值 |

## 展示结构

- 顶部指标：配置项、选股源运行、源错误、健康快照。
- 配置表：配置 key、配置状态、当前值、数据类型。
- 数据源历史表：数据源、选用次数、错误次数、最近使用、错误样例。
- 健康快照：按 provider 和 dataset 展示最新健康状态。
- 运行诊断：展示后端返回的诊断键值。

## 边界

- 本次不新增后端数据中心 API，避免与数据能力契约 PR 互相阻塞。
- 敏感配置只显示是否已保存，不展示真实密钥。
- 任一诊断接口失败时，页面保留可读取部分并提示未完整加载。

## 后续扩展

- 数据能力契约合入后，优先切换到统一的 `/api/v1/data/overview`。
- 增加行情、日线、财务、新闻、事件等 dataset 级别健康矩阵。
- 记录每次分析的 provider 尝试链、耗时、失败原因和 fallback 命中。
