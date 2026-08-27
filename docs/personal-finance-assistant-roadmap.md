# 个人金融助手竞品调研与功能路线图

调研日期：2026-08-26

本文不是“照着某个项目抄页面”的清单，而是基于当前 DSA 已有能力、相似开源项目和个人投资者的真实工作流，整理可以借鉴的产品形态、数据源策略、展示页和报告体系。

## 目标定位

DSA 当前更像“自动化股票分析与通知系统”：擅长多市场股票分析、LLM 报告、通知、持仓、选股、决策信号和 Agent Chat。下一阶段目标应升级为“个人金融助手”：

- 个人资产与关注对象统一管理：自选、持仓、交易记录、目标仓位、风险偏好。
- 市场、行业、个股、资讯和财务在同一处解释：不是只生成一篇报告，而是有可验证的数据面板。
- 从发现机会到后验复盘形成闭环：选股、分析、加入自选、设置提醒、回测、复盘、调整策略。
- 数据源可诊断、可替换、可降级：用户能看懂当前数据从哪里来、是否新鲜、哪里失败。
- AI 负责解释、归纳、提醒和追问，不替代用户做不可验证的判断。

## 当前 DSA 的基础

### 已经具备的能力

- Web 主路由已有首页、Chat、持仓、决策信号、选股、回测、提醒、用量、设置：`apps/dsa-web/src/App.tsx`。
- 左侧导航有 Chat、Portfolio、Decision Signals、Backtest、Alerts、Settings 等入口，选股入口按开关展示：`apps/dsa-web/src/components/layout/SidebarNav.tsx`。
- 首页已聚合任务、历史报告、自选股和大盘复盘入口：`apps/dsa-web/src/pages/HomePage.tsx`。
- 自选股已支持增删、批量分析、今日是否分析、历史详情入口：`apps/dsa-web/src/components/watchlist/HomeStockWorkspace.tsx`。
- 选股服务已有策略 YAML、快照源 fallback、日 K 增强、热点、LLM 重排、运行历史和任务轮询：`src/services/screening/pipeline.py`、`api/v1/endpoints/screening.py`。
- Alerts 已有规则、触发记录、通知记录 API：`api/v1/endpoints/alerts.py`。
- Intelligence Sources 已有资讯源配置、测试、拉取和存储 API：`api/v1/endpoints/intelligence.py`。
- A 股市场结构和热点服务已有初版，能产出行业/概念 ranking 与数据质量标记，但更细的题材路线、核心股、成分股仍是待补证据：`src/services/market_structure_service.py`、`src/services/market_hotspot_service.py`。
- 报告体系已有 Markdown、历史详情、结构化大盘复盘 payload、分享图和多渠道通知：`src/core/market_review.py`、`src/notification.py`、`src/share_image.py`。
- 数据源层已经接入 AkShare、Efinance、Tencent、Tushare、TickFlow、Longbridge、Futu、Finnhub、AlphaVantage、YFinance 等，并有多源 fallback 文档：`docs/data-source-stability.md`。

### 当前主要短板

- 页面信息架构偏“任务控制台”，还不像一个每天打开就能看市场、看自选、看持仓、看风险的金融工作台。
- 大盘展示主要依赖报告入口，缺少实时/准实时的市场宽度、指数、行业/概念、异动事件流和市场温度。
- 自选股仍偏列表和分析状态，缺少分组表现、行情指标列、催化事件、风险标签、目标价/持仓联动。
- 选股能力有后端基础，但前端还不够像策略工作台：策略解释、参数、命中原因、回测、加入监控没有形成连续操作。
- 报告仍以长 Markdown 为主，缺少“结论卡 + 证据面板 + 图表 + 可追踪 action items”的阅读体验。
- 数据源虽多，但用户缺少“数据中心”看能力、覆盖率、新鲜度、失败原因和 repair 建议。

## 相似项目速览

| 项目 | 类型 | 做得好的地方 | 对 DSA 的启发 |
| --- | --- | --- | --- |
| tick-stock-panel | A 股量化工作台 | 看板、自选、策略、回测、挖掘、监控、个股、财务、概念、行业、连板、数据页组成完整闭环；基于 TickFlow + 插件化数据源 + 本地 Parquet | 页面组织和 A 股工作流最值得借鉴，但不应整体改成单市场量化终端 |
| Opptrix | 多市场 AI 投研工作台 | 多市场搜索、Chat Agent、170+ 工作流技能、新闻中心、行情动态、右侧投研面板、Electron 桌面端 | DSA 的 Agent Chat 可从“问答”升级到“带工具、页面和工作区的投研助手” |
| OpenTerminalUI | 专业交易终端 UI | 市场 dashboard、chart workspace、screening、backtesting、alerts、portfolio/risk、command palette、saved workspace | 展示层可学习“Mission Control + 工作区”结构，但个人版要克制复杂度 |
| Equilima | AI 股票分析平台 | Screener、深度研究、财务、评级、K 线、市场 dashboard、AI 结果附带 mini insight card | 报告不应只有文本，AI 结论旁边要放可验证卡片和图表 |
| trading-command-center / AgentFloor | AI 研究与持仓中心 | Watchlist 定时分析、实时 agent run、portfolio insight、outcome tracking、+7/+14/+30/+90 天后验 | 当前 DSA 的决策信号和回测可进一步产品化为“每条建议的后验追踪” |
| OpenBB | 数据平台/研究基础设施 | connect once, consume everywhere；数据源统一暴露给 Python、REST、Workspace、MCP/AI Agent | DSA 应补统一数据能力登记和可查询的数据目录 |
| TradingAgents | 多智能体投研框架 | 基本面、情绪、新闻、技术、交易、风控等角色分工和辩论 | DSA 可借鉴角色分工，但要以结构化证据和可复盘输出为主 |
| FinRobot | 金融 AI Agent 平台 | 金融专用 Agent、DataOps/LLMOps、多源模型/数据层 | 可借鉴“金融任务拆解 + 数据操作层”，不宜先追求复杂 Agent 架构 |
| Ghostfolio | 财富管理/组合看板 | 多账户、交易、绩效、图表、风险静态分析、导入导出、移动优先 | DSA 持仓页可继续向资产配置、收益归因、现金流和风险体检扩展 |
| Wealthfolio | 本地优先个人资产管理 | 投资、净值、支出、模拟，数据本地保存，可选券商只读同步 | DSA 桌面端适合强调本地优先和隐私；个人资产数据默认不应外泄 |
| Portfolio Performance | 组合绩效工具 | TWR/IRR、资产配置、再平衡、多币种、CSV/JSON 导出 | 持仓模块后续应补专业绩效指标和再平衡建议 |
| rotki | 本地优先资产/记账/税务 | 历史事件、盈亏报告、隐私、本地数据库 | 可借鉴“所有资产事件可追溯”，用于交易日记、分红、费用和税务口径 |

参考链接：

- [tick-stock-panel](https://github.com/shy3130/tick-stock-panel)
- [tick-stock-panel features](https://github.com/shy3130/tick-stock-panel/blob/main/docs/features.md)
- [tick-stock-panel strategy](https://github.com/shy3130/tick-stock-panel/blob/main/docs/strategy.md)
- [tick-stock-panel mining](https://github.com/shy3130/tick-stock-panel/blob/main/docs/mining.md)
- [tick-stock-panel custom data source](https://github.com/shy3130/tick-stock-panel/blob/main/docs/custom-data-source.md)
- [tick-stock-panel plugin development](https://github.com/shy3130/tick-stock-panel/blob/main/docs/plugin-development.md)
- [Opptrix](https://github.com/Travisun/Opptrix)
- [OpenTerminalUI](https://github.com/Hitheshkaranth/OpenTerminalUI)
- [Equilima 介绍](https://medium.com/@kaveh.kamali/i-built-an-ai-powered-stock-analysis-platform-that-runs-entirely-on-open-source-4eddae5fd305)
- [trading-command-center](https://github.com/saketnayak/trading-command-center)
- [OpenBB](https://github.com/OpenBB-finance/OpenBB)
- [TradingAgents](https://github.com/tauricresearch/tradingagents)
- [FinRobot](https://github.com/AI4Finance-Foundation/FinRobot)
- [Ghostfolio](https://github.com/ghostfolio/ghostfolio)
- [Wealthfolio](https://github.com/wealthfolio/wealthfolio)
- [Portfolio Performance](https://github.com/portfolio-performance/portfolio)
- [rotki](https://github.com/rotki/rotki)

## tick-stock-panel 专项拆解

这类项目对 DSA 最有启发的地方，不是某一个页面，而是它把 A 股个人量化工作流组织成“先管数据，再看市场，再找机会，再验证，再监控，再复盘”的闭环。DSA 的定位更宽，覆盖 A/H/US、AI 报告、持仓和通知，因此应吸收它的产品组织方式，而不是整体复制成单市场量化终端。

### 页面体系

tick-stock-panel 当前主导航大致可以分成五组：

| 页面组 | 页面 | 对 DSA 的启发 |
| --- | --- | --- |
| 行情总览 | 看板、自选、指数 | 首页不应只是任务入口，要展示市场状态、自选异动、指数和数据健康 |
| 选股研究 | 策略、回测、挖掘 | 当前 Screening/Backtest 要连成“策略 -> 命中 -> 验证 -> 监控”的操作链 |
| 个股与板块 | 个股分析、财务分析、概念分析、行业分析、连板梯队、市场环境、异动监控 | DSA 需要把现有热点、市场结构、报告和个股上下文拆成可浏览页面 |
| 监控复盘 | 监控中心、复盘 | Alerts 应升级为 Monitor Center，报告应承担盘后/周/月复盘 |
| 数据扩展 | 数据、设置、扩展分析动态菜单 | 数据源和外部数据不应只藏在设置里，要有可诊断、可运行、可修复的数据中心 |

它的首次使用顺序也值得借鉴：设置凭据与能力检测 -> 跑盘后管道 -> 加自选 -> 跑策略 -> 回测验证 -> 配监控。DSA 可以把这个改造成“个人助手 onboarding”：配置数据源/LLM/通知 -> 导入自选/持仓 -> 生成第一份个人简报 -> 推荐第一批监控规则。

### 看板启发

tick-stock-panel 的 Dashboard 信息密度很高，包含核心指数、市场宽度、涨跌分布、情绪雷达、趋势强度、实用监控、概念/行业热度、涨跌/成交额/换手榜、涨停梯队、监控触发和数据同步状态。DSA 可做成更通用的一站式看板：

| 看板区域 | 内容 | 第一版数据来源 |
| --- | --- | --- |
| 顶部状态条 | 今日市场、数据源状态、实时行情状态、最近任务、通知状态 | run-flow、system config、数据源 health、task queue |
| 市场速览 | 主要指数、涨跌家数、市场宽度、成交额、市场温度 | market review payload、market light、index registry、DataFetcherManager |
| 自选/持仓健康 | 自选涨跌、未分析数量、持仓盈亏、仓位风险、触发提醒 | watchlist、portfolio、alerts、history |
| 机会雷达 | 选股策略命中、热点题材、行业/概念领涨、异动榜 | screening、market_hotspot_service、market_structure_service |
| 监控事件流 | 策略、价格、技术、市场、持仓风险触发记录 | alerts service |
| 报告与待办 | 最新单股报告、大盘复盘、待复盘信号、后验变化 | history、decision signals、backtest outcome |

视觉上不建议做“大屏驾驶舱”式装饰。更适合 DSA 的方向是高信息密度、浅层卡片、清晰表格、小图 sparkline、红绿市场语义色、数据质量徽标和可执行按钮。首页首屏只放每日高频信息，深度图表放到市场、自选、个股、数据等二级页面。

### 数据中心启发

tick-stock-panel 的 Data 页面把本地数据画像和运维动作放到同一页：日 K、Enriched、指数、ETF、分钟 K、复权因子、财务、维表、同步任务、历史扩展、修复、重算、分钟 K 配置、市场环境覆盖、实时行情配置和扩展数据。DSA 可以分阶段吸收：

- 数据画像：每个 dataset 展示行数/标的数/最早日期/最新日期/更新时间/质量状态。
- 能力检测：每个 provider 展示支持的 dataset、rpm、batch、权限、当前是否可用。
- 数据任务：同步、补历史、修复、重建指标、刷新缓存、查看最近任务。
- 数据质量：缺失交易日、数据陈旧、字段缺失、源失败、fallback/stale 标记。
- 扩展数据：把 Intelligence Sources 从“资讯源”扩展为“外部数据接入”，支持 CSV/Excel/HTTP/YAML 映射，最终给看板、个股页、监控和报告复用。

短期先做诊断，不急着上 DuckDB/Parquet 全量数据湖；但 API 需要从一开始按 dataset 设计，避免后续再拆。

### 数据源启发

tick-stock-panel 的数据设计有三点值得借鉴：

- 能力集与业务解耦：业务判断 `quote.batch`、`kline.daily.batch`、`financial` 等 capability，而不是直接判断用户填了哪个 Key。
- Provider 契约统一：不同源返回统一 schema，存储、指标、回测和前端不关心数据来自 TickFlow、插件还是自定义 HTTP。
- 自定义源可配置：YAML 把外部 HTTP 返回字段映射成内部字段，支持 daily、adj_factor、realtime、minute、financial 五类数据集；插件机制声明 runtime、entry、check、datasets、api key env 和 install hint。

DSA 已经有多数据源 fallback，但还缺“用户可见的能力面板”和“数据集级契约”。建议新增统一数据能力层：

| 能力 | 说明 | 当前可复用基础 |
| --- | --- | --- |
| `quote.realtime` | 单标的/批量实时行情 | `DataFetcherManager`、TickFlow/Tushare/Tencent/AkShare/Futu/Longbridge |
| `kline.daily` | 个股、指数、ETF 日 K | `stock_daily`、index registry、TickFlow/Tushare/AkShare/YFinance 等 |
| `market.overview` | 大盘宽度、指数、行业/概念 | `market_analyzer`、`market_hotspot_service`、market review payload |
| `financial.snapshot` | 财务摘要与关键指标 | fundamental adapters、Futu/Longbridge/YFinance/Tushare 等 |
| `news.events` | 新闻、公告、RSS、搜索结果 | Intelligence Sources、SearchService |
| `strategy.screening` | 全市场快照与策略命中 | screening service/source history |
| `alert.monitor` | 监控规则与触发记录 | Alerts service |
| `portfolio.account` | 账户、持仓、交易、现金 | Portfolio service |

第一阶段只要能展示“可用/不可用/降级/过期/失败原因”，就能明显提升用户信任感。

## 可借鉴能力梳理

### 1. 功能闭环

个人金融助手不应按“技术模块”堆功能，而应按用户一天的投资动作组织：

```text
开盘/盘中看市场
  -> 看自选/持仓是否异常
  -> 从策略或热点发现候选
  -> 打开个股详情验证
  -> 生成或更新 AI 分析
  -> 加入自选/持仓计划/提醒
  -> 盘后复盘与后验追踪
```

DSA 目前已经有其中大部分节点，但页面之间没有连成闭环。优先要补的是页面入口和跨页面动作：

- 选股结果一键加入自选、创建提醒、发起深度分析、进入策略回测。
- 自选/持仓个股一键查看行情详情、历史报告、事件流、风险标签。
- 报告里的建议自动生成 Decision Signal，并进入后验追踪。
- Alerts 命中后能跳转到对应个股、报告、策略或持仓影响。

### 2. 数据源与数据运维

tick-stock-panel 的最大启发不是只有 TickFlow，而是它把数据能力显性化：凭据检测、能力档位、盘后管道、本地数据画像、同步/修复入口。OpenBB 的启发是“接一次源，多处消费”。

DSA 可以按三层推进：

- 能力登记层：统一描述每个源支持哪些 dataset，例如 quote、daily、minute、index、financial、news、concept、industry、limit_up、fund_flow。
- 数据状态层：记录最近成功时间、失败原因、缓存年龄、覆盖股票数、当前 priority、是否 stale/fallback。
- 数据中心页面：把上述状态可视化，并提供测试连接、刷新缓存、重跑补全、查看 run-flow 的入口。

短期不需要把所有数据改成 Parquet/DuckDB，但需要先把“能力、来源、质量、失败原因”统一透出。后续如果要做策略回测、因子挖掘和全市场指标，才进入本地行情数据层。

### 3. 展示页信息架构

建议把 Web 从当前“功能列表”升级为“个人金融助手工作台”：

| 一级页 | 目的 | 核心内容 |
| --- | --- | --- |
| 首页 / 总览 | 每天打开第一眼 | 今日市场、任务、持仓风险、自选异动、最新报告、待处理提醒 |
| 市场 | 看大盘和环境 | 指数、市场宽度、涨跌分布、行业/概念、市场温度、异动事件 |
| 自选 | 跟踪候选 | 分组、行情指标、涨跌周期、事件、最近分析、提醒状态 |
| 持仓 | 管资产 | 账户、仓位、盈亏、暴露、现金、风险、再平衡、交易记录 |
| 个股 | 做验证 | K 线、技术指标、支撑压力、财务、新闻、历史报告、AI 问答 |
| 选股 | 找机会 | 策略卡片、参数、命中原因、评分、导出、加入自选/提醒 |
| 策略与回测 | 验证规则 | 策略回测、AI 建议回测、净值、回撤、胜率、交易明细 |
| 监控 | 盯变化 | 价格、指标、策略、异动、持仓风险、通知记录 |
| 报告 | 看结论和复盘 | 单股报告、大盘复盘、组合报告、周报/月报、后验对照 |
| 数据 | 管数据源 | 能力检测、同步状态、覆盖率、缓存、失败、修复建议 |
| 设置 | 管配置 | LLM、数据源、通知、安全、语言、导入导出 |

不是所有页面都要一次做完。关键是先确定 IA，后续每个页面只补对应能力，避免首页无限膨胀。

### 4. 大盘展示

当前大盘能力有市场复盘和 market review payload，但用户需要更轻量的日常展示：

- 指数卡：上证、深成指、创业板、恒生、纳指、标普等按市场展示。
- 市场宽度：上涨/下跌家数、涨停/跌停、成交额、北向/资金面可选。
- 行业/概念：领涨、领跌、轮动、连续性、主线标签。
- 情绪温度：强/中/弱、拥挤度、风险事件、数据质量。
- 异动事件流：大涨、大跌、放量、突破、跌破、连续涨停、财报/公告/新闻。
- 一键动作：生成大盘复盘、把市场摘要注入个股分析、设置市场提醒。

实现上可先复用 `src/market_analyzer.py`、`src/services/market_hotspot_service.py`、`src/services/market_light_service.py` 和已有指数注册表，不必第一版就实时化。

### 4.1 一站式首页看板

DSA 的首页应从“分析任务入口”升级为“今日金融助手”。建议采用三层布局：

| 层级 | 区域 | 说明 |
| --- | --- | --- |
| 顶部 command strip | 市场日期、交易状态、数据新鲜度、LLM/通知/任务状态、快速操作 | 类似 tick-stock-panel 侧边栏状态徽标，但放到页面顶部，减少侧边栏拥挤 |
| 主视图区 | 市场速览、自选/持仓健康、机会雷达、监控事件 | 每块控制在 1 屏可扫读，点击进入对应页面 |
| 右侧助手栏 | 今日摘要、待处理事项、最近报告、AI 追问入口 | 把 Agent Chat 变成“上下文助手”，而不是孤立聊天页 |

首屏建议保留以下卡片：

- 市场状态卡：主要指数、涨跌家数、市场温度、数据质量。
- 自选风险卡：涨跌前列、未分析、触发提醒、新闻/公告。
- 持仓健康卡：当日盈亏、集中度、行业暴露、止损/目标价接近。
- 机会卡：选股策略新命中、热点题材、行业轮动。
- 监控流：最近触发的策略/价格/市场/持仓事件。
- 报告卡：大盘复盘、单股报告、组合周报入口。

美观方向：少用大面积渐变和装饰背景，采用浅层分区、紧凑数字、迷你图、状态点、数据质量 badge 和清晰 hover 行为。个人金融助手的高级感来自“信息组织清楚且可操作”，而不是视觉噪声。

### 5. 自选股展示

自选股应该从“待分析列表”升级为“个人观察池”：

- 分组：长期关注、短线观察、持仓相关、财报观察、行业主题、风险名单。
- 表格列：现价、涨跌幅、成交额/换手、量比、RSI/MACD/均线状态、最近报告、建议、评分、提醒。
- 卡片模式：适合移动端，展示价格、近 5 日表现、AI 摘要、风险标签。
- 事件层：新闻、公告、财报日、突破/跌破、策略命中、提醒触发。
- 批量动作：分析未分析、刷新行情、加入监控、导出、生成自选日报。
- 与持仓联动：同一标的如果已持仓，显示仓位、盈亏、成本区间和风险提示。

tick-stock-panel 的 Watchlist 还提供表格/卡片/紧凑视图、虚拟滚动、分组栏、分组涨跌统计、列自定义、K 线/分时迷你图、OCR/批量导入和扩展字段列。DSA 第一阶段可先做“分组 + 行情列 + 最近报告 + 提醒状态”，第二阶段再做列自定义和扩展字段。

### 6. 个股详情

个人金融助手需要一个比 Markdown 报告更稳定的个股页：

- 顶部结论卡：趋势、操作倾向、风险等级、数据质量、最近更新时间。
- K 线区域：价格、成交量、均线、MACD/RSI/KDJ、区间收益。
- 关键价位：支撑/压力、前高前低、缺口、ATR 通道、整数关口、成交密集区。
- 基本面：估值、盈利、成长、现金流、分红、同行比较。
- 新闻/公告：按时间线展示，并标注来源与是否被报告采用。
- 历史报告：同一标的历次结论、评分和建议变化。
- 后验：过去报告的 7/14/30/90 天表现，对 AI 建议进行追踪。
- 操作区：加入自选、创建提醒、加入持仓计划、重新分析、问 AI。

这个页面可先做 A/H/US 通用骨架，再按市场逐步增强字段。

### 7. 报表与报告

报告目前“内容量够，但读起来像长文”。面向个人金融助手，应拆成四层：

- 决策摘要：一句话结论、建议动作、置信度、核心风险。
- 证据面板：价格、技术、基本面、新闻、市场环境、持仓影响。
- 追踪项：需要等待什么信号、触发什么提醒、下次复盘时间。
- 原始全文：保留 Markdown 作为可复制、可通知、可归档的完整报告。

建议新增三类报告：

- 每日个人简报：市场概览 + 自选异动 + 持仓风险 + 今日待办。
- 单股研究卡：个股详情页可复用，适合分享和移动端阅读。
- 组合周报/月报：收益、风险、行业暴露、现金、再平衡、后验表现。

报告结构上，AI 输出应更多落到结构化字段，再由 Web 渲染成卡片，而不是让前端直接解析长 Markdown。

### 8. 策略、回测和后验

当前 DSA 的回测更偏“历史 AI 建议后验”，这很有价值，但它和策略回测不是一回事。建议拆成两条线：

- 建议后验：针对 AI 报告/Decision Signal，追踪之后 N 天收益、最大回撤、是否触发止损/止盈。
- 策略回测：针对选股策略或技术信号，在历史日 K 上评估净值、回撤、胜率、换手、成本。

第一阶段应强化“建议后验”，因为它直接服务个人助手可信度；第二阶段再做策略回测，避免过早引入一套重型量化框架。

### 9. 监控与提醒

当前 Alerts 已有基础规则系统，可以借 tick-stock-panel 和 trading-command-center 做成 Monitor Center：

- 价格类：突破、跌破、涨跌幅、接近成本线/止损线。
- 技术类：均线、RSI、MACD、放量、缩量、缺口。
- 策略类：进入/退出某个筛选策略结果。
- 市场类：指数跌破、市场宽度恶化、行业轮动、涨停情绪变化。
- 持仓类：单股仓位过高、行业暴露过高、回撤超阈值、现金不足。
- 事件类：财报日、公告、新闻关键词、评级变化。

触发结果要能关联到“为什么触发”和“下一步能做什么”，否则提醒会变成噪音。

tick-stock-panel 的 Monitor 页面把左侧触发记录和右侧规则管理放在同一个工作区，过滤 strategy/signal/price/market/sector/abnormal，并展示规则数量、严重级别、行业/概念标签和未读徽标。DSA 可沿用这种结构，但规则类型要同时覆盖持仓风险和报告后验。

## 一站式金融助手功能矩阵

| 能力层 | 用户问题 | 关键页面 | 核心功能 |
| --- | --- | --- | --- |
| 市场层 | 今天市场怎么样？风险偏好强不强？ | 首页、市场、指数、行业/概念 | 指数、市场宽度、热点、情绪、异动、复盘 |
| 观察层 | 我关心的票发生了什么？ | 自选、个股、监控 | 分组、行情、新闻、提醒、最近报告、关键价位 |
| 资产层 | 我的仓位安全吗？ | 持仓、组合报告 | 盈亏、风险暴露、现金、再平衡、持仓事件 |
| 研究层 | 有哪些机会？证据够不够？ | 选股、个股、财务、报告 | 策略命中、AI 分析、财务、新闻、估值、技术 |
| 验证层 | 这个策略或建议靠谱吗？ | 回测、决策信号、后验 | 策略回测、AI 建议后验、胜率、回撤、归因 |
| 自动化层 | 什么变化需要提醒我？ | 监控、提醒、通知 | 价格、指标、策略、市场、持仓、事件提醒 |
| 数据层 | 数据可靠吗？从哪里来？ | 数据、设置 | 能力检测、数据画像、同步、修复、外部数据接入 |
| 助手层 | 帮我总结、解释、追问和形成待办 | 首页助手栏、Chat、报告 | 上下文问答、每日简报、任务建议、报告摘要 |

## 分阶段路线图

### P0：串起个人助手闭环

目标：先形成“发现 -> 查看 -> 分析 -> 监控 -> 变化 -> 后验”的最小闭环。

- 前置数据能力/质量契约：所有页面统一读取 provider capability、dataset quality、source/stale/warnings。
- 统一 EntityLink 与跨页面动作：股票、指数、行业、概念、策略、报告、信号、提醒、持仓都能互相跳转。
- 首页升级为一站式 Dashboard：市场、自选、持仓、监控、报告、What Changed 一屏可扫读。
- 报告升级为 ResearchArtifact：输出 thesis、evidence、invalidation_conditions、actions、outcome。
- 个股详情页 MVP：用 Evidence Quality 把 AI 判断建立在哪些数据上讲清楚。
- 自选 2.0：围绕 Change、State、Next Action，而不是堆技术指标。
- Monitor Center：从普通阈值提醒升级到 thesis_invalidation、strategy_hit、portfolio_risk。

### P1：补齐个人投资工作流

目标：让用户能完成“发现 -> 分析 -> 持有 -> 监控 -> 复盘”。

- 选股工作台增强：Why Selected、Why Now、命中变化、新入选/移出。
- Portfolio 2.0：账户总览、今日/累计盈亏、现金、集中度、行业暴露、风险旗标。
- Calendar：财报、分红、解禁、宏观、自定义事件和提醒。
- 市场详情页：指数、市场宽度、行业/概念、异动事件流。
- Decision Signal 后验：7/14/30/90 天结果、最大回撤、归因。

### P2：建立数据资产和长期复盘

目标：为策略回测、财务分析、投资日记和长期复盘提供稳定底座。

- 数据中心 `/data`：完整展示 capability/quality、源链路、数据画像、失败、run-flow 和配置建议。
- 本地数据资产层：daily、quote、index、financial、industry/concept、alerts/events。
- 自定义数据源：CSV/Excel/HTTP/YAML 映射，先进入数据中心和个股页，再进入策略和报告。
- 策略回测：与 AI 建议后验拆分，支持策略组合、成本、滑点、止损、持仓数。
- 投资日记：Action、Reason、Expectation，自动关联 report、price、outcome。
- 财务页 `/financials`：利润表、资产负债表、现金流、估值和 AI 解读。

### P3：研究型和高级助手能力

目标：只在基础闭环稳定后做高级研究能力。

- 因子/策略挖掘：必须在本地数据质量稳定后做，严格防未来函数。
- 市场 regime：A 股连板情绪周期，全球市场趋势/波动/风险偏好。
- 组合优化与再平衡：目标配置、行业暴露、风险预算、现金管理。
- 多 Agent 深度研究：不设硬 deadline；只有结构化证据、后验和监控闭环稳定后再推进。

## 下一步执行清单

下面是已经拆出的 issue 和建议 PR 顺序。每个 PR 应只关闭一个 issue；跨 issue 的公共 schema 必须先落在前置 PR。

### 1. 数据源能力层（Issue #2276）

目标：为 Dashboard、Data Center、Stock Detail、Screening、Monitor 统一打底。

| 能力 | 首版定义 |
| --- | --- |
| provider capability | provider 是否配置、是否启用、支持哪些 dataset |
| dataset quality | 每个 dataset 的 status/source/stale/last_success/last_error/fallback_from/coverage/warnings |
| priority view | 按场景展示当前 fallback 顺序 |
| redetect | 首版只做轻量检测，避免触发高成本全量抓取 |
| security | 所有 secret 只返回 masked/configured，不返回原值 |

首批 dataset：`quote.realtime`、`kline.daily`、`index.daily`、`market.overview`、`financial.snapshot`、`news.events`、`strategy.screening`、`alert.monitor`、`portfolio.account`。

响应结构：

```json
{
  "as_of": "2026-08-26T15:05:00+08:00",
  "providers": [
    {"name": "tickflow", "enabled": true, "configured": true, "datasets": ["quote.realtime", "kline.daily"], "status": "ok"}
  ],
  "datasets": [
    {
      "dataset": "quote.realtime",
      "status": "degraded",
      "source": "tencent",
      "fallback_from": ["tickflow"],
      "last_success": "2026-08-26T14:59:00+08:00",
      "stale": false,
      "coverage": null,
      "warnings": []
    }
  ],
  "priorities": [
    {"scenario": "cn.realtime", "providers": ["tickflow", "tushare", "tencent", "akshare_sina"]}
  ]
}
```

实现范围：

- 后端新增 capability/quality schema 和只读聚合服务。
- API 新增 `GET /api/v1/data/capabilities` 或 `GET /api/v1/data/overview`。
- 复用 `DataFetcherManager`、screening status/source history、run-flow 和 system config。
- 不做重型数据扫描，不新增 provider。

验收：零配置可用、不泄密、单源失败不拖垮整体、后续页面可直接消费同一契约。

### 2. EntityLink 与跨页面动作模型（Issue #2286）

目标：先统一对象引用和动作，避免 Dashboard、Watchlist、Stock Detail、Monitor 各自发明跳转。

| 对象 | 示例 |
| --- | --- |
| stock | `stock:CN:600519` |
| index | `index:CN:sh000001` |
| sector/concept | `sector:semiconductor`、`concept:ai` |
| report/signal/alert | `report:123`、`signal:456`、`alert:789` |
| strategy | `strategy:dual_low` |
| portfolio_position | `portfolio_position:account_id:symbol` |
| calendar_event | `calendar_event:123` |

统一动作：View、Analyze、Watch、Monitor、Ask AI、Compare、Track Outcome。

实现范围：

- 后端 schema/helper：生成稳定 `entity_type`、`entity_id`、`label`、`links`、`actions`。
- 前端 helper：根据 entity/action 渲染统一按钮和跳转。
- 先接 stock/report/signal/alert/strategy，其他实体可保留 pending。

验收：现有路由不破坏；Alert -> Stock/Report、Report -> Stock/Monitor、Screening -> Stock/Watch/Analyze 的跳转口径一致。

### 3. 大盘看板 MVP（Issue #2277）

目标：把首页从“分析任务入口”改成每天打开先看的市场总览。首版不触发 LLM，只聚合已有结构化数据。

| 模块 | 要做什么 |
| --- | --- |
| 后端入口 | 新增 `api/v1/endpoints/dashboard.py`，挂载 `GET /api/v1/dashboard/overview` |
| 服务层 | 新增 `src/services/dashboard_overview_service.py`，只编排现有服务，不新增独立行情源 |
| 前端入口 | 在 `HomePage.tsx` 顶部新增 `MarketOverviewPanel`，后续可拆到 `/market` |
| 复用模块 | `DataFetcherManager.get_main_indices()`、`get_market_stats()`、`get_sector_rankings()`、`get_concept_rankings()`、`MarketHotspotService`、`market_light_service`、`history`、`alerts`、`portfolio`、`watchlist` |
| 图表库 | 先用现有 `recharts` 做迷你趋势图、饼图/条形图；不新增图表依赖 |

首版响应结构：

```json
{
  "as_of": "2026-08-26T15:05:00+08:00",
  "market": {
    "scope": "cn",
    "trading_status": "closed",
    "indices": [],
    "breadth": {},
    "temperature": {},
    "themes": {}
  },
  "personal": {
    "watchlist": {"total": 24, "up": 14, "down": 8, "pending_analysis": 6, "alerts": 2},
    "portfolio": {"day_pnl": 1280.5, "day_pnl_pct": 0.36, "risk_flags": []}
  },
  "activity": {
    "what_changed": [],
    "alerts": [],
    "reports": [],
    "signals": []
  },
  "system": {
    "quality": {"status": "partial", "warnings": []},
    "tasks": []
  }
}
```

页面布局：

| 区域 | 展示 |
| --- | --- |
| 顶部状态条 | 日期、市场、交易状态、数据新鲜度、主要数据源、刷新、生成大盘复盘 |
| 指数行 | 上证、深成指、创业板、恒生、纳指、标普；每张卡含价格、涨跌幅、来源、迷你趋势 |
| 市场宽度 | 涨/平/跌条形图、上涨率、涨停/跌停、成交额；无涨停数据时明确显示“不支持/缺失” |
| 市场温度 | 复用 market light，展示分数、标签、风险提示，不重新发明情绪算法 |
| 主题热度 | 行业/概念领涨领跌，点击跳到后续行业/概念页；首版可只开详情抽屉 |
| What Changed | 上次查看以来评分、风险、行业排名、组合暴露、提醒、信号后验发生了什么变化 |
| 自选/持仓健康 | 自选涨跌分布、未分析数量、持仓当日盈亏、仓位风险 |
| 监控流 | 最近 10 条 alert trigger，标注类型、标的、触发条件、时间 |
| 报告入口 | 最新大盘复盘、最新单股报告、待后验信号 |

降级规则：

| 场景 | 行为 |
| --- | --- |
| 指数失败 | 保留其他模块，指数卡显示 `fetch_failed` 和来源错误 |
| 市场宽度失败 | 不阻塞首页，显示“暂无市场宽度”，继续展示指数/报告/自选 |
| 行业/概念失败 | 使用 `MarketHotspotService` 的 missing fields/warnings，页面展示数据质量 badge |
| 无 TickFlow | 走现有 AkShare/Tushare/Efinance/Tencent fallback，不在 UI 写死 TickFlow |
| 非 A 股 | 隐藏涨停/连板，保留指数、持仓、自选、报告 |

验收标准：

| 项 | 标准 |
| --- | --- |
| 性能 | 首屏接口目标 2 秒内返回；单个数据块超时不拖垮整体 |
| 稳定性 | 任意一个数据源失败，首页仍可渲染 |
| 可解释 | 每个行情/宽度/主题模块都显示 source、stale、quality |
| 操作 | 刷新不触发 LLM；“生成大盘复盘”才进入原有 market-review 任务 |
| 响应式 | 桌面 2-3 栏，移动单列；数字和按钮不溢出 |

测试：

| 层 | 用例 |
| --- | --- |
| 后端单测 | mock 指数成功、宽度失败、主题 partial、无持仓、无自选 |
| API 测试 | `/api/v1/dashboard/overview` 返回完整 schema 和 partial quality |
| 前端测试 | `MarketOverviewPanel` 覆盖 loading、partial、empty、success |
| 构建验证 | `python -m py_compile api/v1/endpoints/dashboard.py src/services/dashboard_overview_service.py`，`cd apps/dsa-web && npm run lint && npm run build` |

### 4. ResearchArtifact 与报告结构化（Issue #2278）

目标：改善“报表一般”的体感，但后端不输出 UI 语义的 `report_cards`，而是输出可复用研究对象。

| 模块 | 要做什么 |
| --- | --- |
| 后端 | 在 history detail 追加可选 `research_artifact`，不删除原 Markdown |
| Schema | 新增 `ResearchArtifact`：decision、thesis、evidence、risks、catalysts、invalidation_conditions、actions、data_quality、outcome |
| 前端 | `ReportMarkdownDrawer` 顶部新增 `ResearchArtifactSummary`，展示为卡片/表格/时间线 |
| 兼容 | 老记录没有结构化字段时，从现有 summary/meta/details 降级生成 artifact |

核心字段：

| 字段 | 说明 |
| --- | --- |
| thesis | 当前核心判断，例如“偏多但需确认成交额延续” |
| evidence | 技术、基本面、财务、消息、市场环境证据及质量 |
| invalidation_conditions | 判断失效条件，例如跌破关键价位、行业强度跌出 Top 10、财务指标低于阈值 |
| actions | 可执行动作：创建提醒、复盘日期、继续观察、加入自选 |
| outcome | 已有后验结果：N 日收益、最大回撤、止盈/止损命中 |

验收：Markdown 原样保留；分享图和通知不受影响；invalidation_conditions 可被 Monitor PR 复用；Web UI 不把不可控长 Markdown 当作唯一结构源。

测试：老记录、新 artifact 记录、大盘复盘记录、英文/韩文报告固定文案边界、invalidation serialization。

### 5. 个股详情页 MVP（Issue #2279）

目标：用户点任何股票后进入稳定研究工作区，而不是只能打开报告抽屉。

| 模块 | 要做什么 |
| --- | --- |
| 路由 | 新增 `/stocks/:code` |
| 后端聚合 | 新增 `GET /api/v1/stocks/{code}/profile`，聚合 quote、history、latest research_artifact、intelligence、portfolio、monitor |
| 前端组件 | `StockDetailPage`、`StockHeaderCard`、`MarketSnapshot`、`StockMiniChart`、`ResearchSummary`、`EvidenceQualityPanel`、`StockEventList`、`StockReportTimeline` |
| 图表 | 首版用 Recharts 画收盘价/成交量，后续再评估 K 线专用库 |

页面区域：

| 区域 | 内容 |
| --- | --- |
| Header | 名称、代码、市场、现价、涨跌幅、数据源、更新时间 |
| MarketSnapshot | 当前价格状态、区间收益、成交量、市场/行业背景 |
| Chart | 近 1/3/6 月价格曲线、成交量 |
| ResearchSummary | 最新 thesis、评分、操作倾向、风险、失效条件 |
| Evidence | 行情、财务、新闻、市场环境、资金流的 fresh/partial/unavailable |
| Events | 新闻、公告、财报、提醒触发 |
| Reports | 历次报告、评分变化、建议变化 |
| Monitors | 已有监控规则和可创建的 invalidation monitor |
| Copilot | 重新分析、加入自选、创建提醒、问 AI、比较 |

验收：从首页、自选、选股、报告都能跳转；行情失败仍能看历史报告；非 A 股隐藏 A 股专属字段；Evidence 明确展示数据质量。

测试：路由、profile API partial、图表空数据、操作按钮跳转。

### 6. 自选 2.0（Issue #2280）

目标：把自选从“待分析列表”升级为观察池。

| 模块 | 要做什么 |
| --- | --- |
| 兼容层 | 继续读取/写入现有 `STOCK_LIST`，新增分组结构不能破坏定时分析 |
| 后端 API | 新增 `GET/POST/PATCH/DELETE /api/v1/stocks/watchlist/groups`；新增 `GET /api/v1/stocks/watchlist/enriched` |
| 前端 | 可先在首页自选区升级，再拆独立 `/watchlist` 页 |
| 数据 | 每行聚合 quote、最近报告、今日是否分析、alert 状态、portfolio 状态 |

表格列：

| 列 | 说明 |
| --- | --- |
| 标的 | 代码、名称、市场、是否持仓 |
| 今日 | 现价、涨跌幅、成交额/换手，缺失时显示 source error |
| AI 状态 | 最近 thesis、操作倾向、评分、风险 |
| 变化 | 评分/风险/建议/行业排名相对上次报告或上次查看的变化 |
| 下一观察 | invalidation condition、关键价位、财报/公告、复盘日期 |
| 操作 | View、Analyze、Monitor、Ask AI、移动分组、删除 |

验收标准：旧 `STOCK_LIST` 用户无感升级；批量分析仍按原股票列表工作；移动端可用卡片视图；单行操作不导致整表刷新抖动。

测试：watchlist 兼容读写、分组 CRUD、enriched 聚合 partial、前端行渲染和批量动作。

### 7. 监控中心增强（Issue #2281）

目标：Alerts 从规则列表升级为真正的 Monitor Center。

| 模块 | 要做什么 |
| --- | --- |
| 页面 | 保留 `/alerts`，标题和结构升级为“监控中心” |
| 布局 | 左侧触发记录，右侧规则管理；移动端上下堆叠 |
| 新规则 | strategy_hit、market_breadth、portfolio_risk、report_action_item、thesis_invalidation |
| 联动 | 从选股结果、个股详情、ResearchArtifact invalidation 直接创建规则 |

触发记录展示：类型、标的、触发条件、当前值、阈值、严重级别、来源、时间、通知状态、impact、affected_entities、跳转入口。

验收标准：旧 alert rule 继续可用；新规则没有数据时不静默通过；每条触发记录都能解释原因。

测试：规则兼容、触发记录过滤、新类型校验、通知失败不阻塞触发落库。

### 8. 选股工作台增强（Issue #2282）

目标：把 Screening 页面从“跑策略”变成“策略发现入口”。

| 模块 | 要做什么 |
| --- | --- |
| 策略卡 | 展示策略分类、适用市场、核心过滤、风险说明、建议分析 skill |
| 结果表 | 展示分数、命中因子、数据源、降级、热点/行业、最近报告、Why Selected、Why Now |
| 操作 | 加自选、创建策略监控、发起深度分析、导出、进入回测 |
| 历史 | 展示最近运行、命中变化、新入选/移出 |

验收标准：`SCREENING_ENABLED=false` 时入口继续隐藏；启用后策略和结果都能解释数据来源；LLM 重排失败时保留本地排序和错误说明。

测试：策略列表、任务轮询恢复、结果操作、source-history 展示。

### 9. 数据中心 MVP（Issue #2283）

目标：让用户知道“当前有什么数据、来自哪里、是否新鲜、为什么失败”。数据中心消费 Issue #2276 的统一契约，不重新发明检测逻辑。

| 模块 | 要做什么 |
| --- | --- |
| 后端入口 | 复用 `GET /api/v1/data/overview`；如 Issue #2276 已提供则不新增第二套 API |
| 前端页面 | 新增 `apps/dsa-web/src/pages/DataPage.tsx`，路由 `/data`，侧边栏加“数据” |
| 首版范围 | 只读诊断，不做清库、重建、补历史这类危险动作 |

页面卡片：

| 卡片 | 字段 |
| --- | --- |
| Provider 能力 | provider、enabled、configured、datasets、priority、last_error、cooldown |
| Dataset 画像 | quote、daily、index、financial、news、screening、alerts、portfolio 的最新时间和覆盖状态 |
| 数据源链路 | A 股、港股、美股、指数、选股快照、新闻的当前优先级 |
| 最近失败 | 来源、操作、错误分类、时间、是否 fallback |
| Run-flow | 最近分析任务的数据源节点状态，链接到现有 run-flow 抽屉 |
| 配置建议 | 例如配置了 TickFlow 但 `REALTIME_SOURCE_PRIORITY` 未包含 tickflow 时提示 |

验收：零配置可用、不泄密、不阻塞、可跳转到设置页对应配置段。

### 10. Portfolio 2.0（Issue #2284）

目标：让持仓成为个人金融助手的一等公民，并给 Dashboard/Monitor 提供个人上下文。

首版页面/数据：

| 区域 | 字段 |
| --- | --- |
| 账户总览 | 总资产、现金、持仓市值、今日盈亏、累计盈亏 |
| 持仓 | 标的、数量、成本、现价、市值、盈亏、仓位、最近报告 |
| 暴露 | 行业/概念/市场/币种暴露，缺失时显示 partial |
| 风险旗标 | 单股集中度、行业集中度、回撤、波动、现金压力、数据陈旧 |
| 操作 | View、Analyze、Ask AI、Create Monitor、Track Outcome |

暂不做：TWR/IRR、复杂归因、税务。

验收：旧持仓数据继续可读；风险旗标可解释阈值；行情/行业数据失败时标记 partial；Dashboard 能展示组合健康摘要。

### 11. Calendar 与事件提醒（Issue #2285）

目标：补上个人助手的前瞻能力，让用户知道未来 7 天需要关注什么。

首版事件：

| 类型 | 范围 |
| --- | --- |
| earnings | 财报/业绩发布时间 |
| dividend | 分红/除权除息 |
| unlock | 解禁/限售股 |
| macro | 宏观数据/议息/重要日程 |
| custom | 用户自定义事件 |
| monitor_reminder | 由 Monitor 或 ResearchArtifact action 生成的提醒 |

页面入口：

- Dashboard：未来 7 天事件。
- Stock Detail：个股相关 Upcoming Events。
- Monitor：事件前 N 天提醒。
- Portfolio：持仓相关事件聚合。

验收：用户自定义事件不依赖外部数据源；外部事件缺失要明确标注；提醒不触发 LLM；Dashboard/Stock Detail 读取同一事件 API。

## 暂不做

- 不立刻重写成 Polars/DuckDB/vectorbt 全量量化架构。
- 不做 AI 生成任意 Python 策略；先用受控 YAML/DSL 或 UI 条件构建器。
- 不默认接入合规风险高或稳定性差的抓取插件。
- 不把首页做成所有功能堆叠页；首页只保留高频摘要和清晰跳转。
- 不给 Multi-Agent 设硬 deadline；先做 What Changed、Thesis、Invalidation、Evidence Quality、Outcome、Personal Context。
