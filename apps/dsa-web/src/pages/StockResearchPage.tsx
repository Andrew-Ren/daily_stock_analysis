import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bot,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  FileText,
  LineChart,
  Loader2,
  MessageSquareQuote,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useNavigate, useParams } from 'react-router-dom';
import { historyApi } from '../api/history';
import { stocksApi, type StockHistoryResponse, type StockQuote } from '../api/stocks';
import { ApiErrorAlert, AppPage, Badge, Button, InlineAlert } from '../components/common';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import type {
  AnalysisContextPackOverviewBlock,
  AnalysisReport,
  HistoryItem,
  NewsIntelItem,
} from '../types/analysis';
import { getSentimentColor } from '../types/analysis';
import { formatDateTime } from '../utils/format';
import { normalizeStockCode } from '../utils/stockCode';
import { truncateStockName } from '../utils/stockName';

type LoadState = {
  loading: boolean;
  error: ParsedApiError | null;
};

const formatNumber = (value?: number | null, digits = 2): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

const formatOptionalPercent = (value?: number | null): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const formatAmount = (value?: number | null): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)} 万`;
  return formatNumber(value, 2);
};

const toneForChange = (value?: number | null): string => {
  if (typeof value !== 'number' || Number.isNaN(value) || value === 0) return 'text-secondary-text';
  return value > 0 ? 'text-[var(--home-price-up)]' : 'text-[var(--home-price-down)]';
};

const statusVariant = (status?: string): 'success' | 'warning' | 'danger' | 'default' => {
  if (status === 'available') return 'success';
  if (status === 'fallback' || status === 'estimated') return 'warning';
  if (status === 'missing' || status === 'fetch_failed') return 'danger';
  return 'default';
};

const compactText = (value?: string | null, fallback = '-'): string => {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
};

const normalizeRouteCode = (value?: string): string => normalizeStockCode(value ?? '').toUpperCase();

const StockResearchPage: React.FC = () => {
  const navigate = useNavigate();
  const { stockCode: stockCodeParam = '' } = useParams();
  const stockCode = normalizeRouteCode(decodeURIComponent(stockCodeParam));
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [history, setHistory] = useState<StockHistoryResponse | null>(null);
  const [reports, setReports] = useState<HistoryItem[]>([]);
  const [selectedReport, setSelectedReport] = useState<AnalysisReport | null>(null);
  const [news, setNews] = useState<NewsIntelItem[]>([]);
  const [state, setState] = useState<LoadState>({ loading: true, error: null });

  const displayName = quote?.stockName || selectedReport?.meta.stockName || reports[0]?.stockName || stockCode;
  const evidenceBlocks = selectedReport?.details?.analysisContextPackOverview?.blocks ?? [];
  const chartData = useMemo(
    () => (history?.data ?? []).map((item) => ({
      ...item,
      shortDate: item.date.slice(5),
    })),
    [history?.data],
  );

  const loadReportDetail = useCallback(async (recordId: number) => {
    const report = await historyApi.getDetail(recordId);
    setSelectedReport(report);
    try {
      const newsResponse = await historyApi.getNews(recordId, 6);
      setNews(newsResponse.items);
    } catch {
      setNews([]);
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!stockCode) {
      setState({
        loading: false,
        error: getParsedApiError(new Error('股票代码不能为空')),
      });
      return;
    }

    setState({ loading: true, error: null });
    try {
      const [quoteResult, historyResult, reportsResult] = await Promise.allSettled([
        stocksApi.getQuote(stockCode),
        stocksApi.getHistory(stockCode, { period: 'daily', days: 120 }),
        historyApi.getList({ stockCode, limit: 8 }),
      ]);

      setQuote(quoteResult.status === 'fulfilled' ? quoteResult.value : null);
      setHistory(historyResult.status === 'fulfilled' ? historyResult.value : null);
      const nextReports = reportsResult.status === 'fulfilled' ? reportsResult.value.items : [];
      setReports(nextReports);

      if (nextReports[0]?.id !== undefined) {
        await loadReportDetail(nextReports[0].id);
      } else {
        setSelectedReport(null);
        setNews([]);
      }

      const failed = [quoteResult, historyResult, reportsResult].filter((result) => result.status === 'rejected');
      setState({
        loading: false,
        error: failed.length === 3 ? getParsedApiError((failed[0] as PromiseRejectedResult).reason) : null,
      });
    } catch (error: unknown) {
      setState({ loading: false, error: getParsedApiError(error) });
    }
  }, [loadReportDetail, stockCode]);

  useEffect(() => {
    document.title = `${stockCode || 'Stock'} - DSA`;
  }, [stockCode]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadWorkspace();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkspace]);

  const handleAnalyze = () => {
    navigate('/', {
      state: {
        stockCode,
        stockName: displayName,
        autoAnalyze: true,
        selectionSource: 'manual',
      },
    });
  };

  const handleAskAi = () => {
    const params = new URLSearchParams({ stock: stockCode, name: displayName });
    if (selectedReport?.meta.id !== undefined) {
      params.set('recordId', String(selectedReport.meta.id));
    }
    navigate(`/chat?${params.toString()}`);
  };

  const handleMonitor = () => {
    navigate('/alerts', { state: { stockCode, stockName: displayName } });
  };

  return (
    <AppPage className="max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          返回首页
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => void loadWorkspace()} disabled={state.loading}>
          <RefreshCw className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          刷新
        </Button>
      </div>

      {state.error ? <ApiErrorAlert error={state.error} className="mb-4" /> : null}

      <section className="dashboard-card mb-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="label-uppercase home-title-accent">Stock Research</p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <h1 className="min-w-0 text-2xl font-semibold text-foreground sm:text-3xl">
                {truncateStockName(displayName)}
              </h1>
              <span className="pb-1 font-mono text-sm text-secondary-text">{stockCode || stockCodeParam}</span>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">
              {selectedReport
                ? compactText(selectedReport.summary.analysisSummary, '暂无最新研究摘要')
                : '暂无最新研究摘要，可先发起一次分析。'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="home-action-ai" size="sm" onClick={handleAnalyze}>
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              重新分析
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleMonitor}>
              <Bell className="h-4 w-4" aria-hidden="true" />
              监控
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleAskAi}>
              <MessageSquareQuote className="h-4 w-4" aria-hidden="true" />
              问 AI
            </Button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.55fr)]">
        <div className="min-w-0 space-y-4">
          <section className="dashboard-card p-4 sm:p-5">
            <SectionTitle icon={<LineChart className="h-4 w-4" />} eyebrow="MarketSnapshot" title="行情快照" />
            {state.loading && !quote ? (
              <LoadingBlock />
            ) : quote ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric label="最新价" value={formatNumber(quote.currentPrice)} valueClassName={toneForChange(quote.changePercent)} />
                <Metric label="涨跌幅" value={formatOptionalPercent(quote.changePercent)} valueClassName={toneForChange(quote.changePercent)} />
                <Metric label="最高 / 最低" value={`${formatNumber(quote.high)} / ${formatNumber(quote.low)}`} />
                <Metric label="成交额" value={formatAmount(quote.amount)} />
                <Metric label="今开" value={formatNumber(quote.open)} />
                <Metric label="昨收" value={formatNumber(quote.prevClose)} />
                <Metric label="成交量" value={formatAmount(quote.volume)} />
                <Metric label="更新时间" value={formatDateTime(quote.updateTime)} />
              </div>
            ) : (
              <InlineAlert variant="warning" title="行情暂不可用" message="实时行情源未返回数据，研究区仍可查看历史报告。" />
            )}
          </section>

          <section className="dashboard-card p-4 sm:p-5">
            <SectionTitle icon={<BarChart3 className="h-4 w-4" />} eyebrow="Chart" title="K 线概览" />
            {chartData.length > 0 ? (
              <div className="h-72 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="stockCloseGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.32} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.45)" />
                    <XAxis dataKey="shortDate" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} domain={['dataMin', 'dataMax']} width={56} />
                    <Tooltip />
                    <Area type="monotone" dataKey="close" stroke="hsl(var(--primary))" fill="url(#stockCloseGradient)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <InlineAlert variant="warning" title="K 线暂不可用" message="历史行情源未返回数据。" />
            )}
          </section>

          <section className="dashboard-card p-4 sm:p-5">
            <SectionTitle icon={<ClipboardList className="h-4 w-4" />} eyebrow="ResearchSummary" title="研究摘要" />
            {selectedReport ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="home-subpanel p-3 md:col-span-2">
                  <p className="text-sm leading-6 text-foreground">{compactText(selectedReport.summary.analysisSummary)}</p>
                  <p className="mt-2 text-xs leading-5 text-secondary-text">{compactText(selectedReport.summary.trendPrediction)}</p>
                </div>
                <div className="home-subpanel p-3">
                  <p className="text-xs text-muted-text">操作建议</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">{selectedReport.summary.actionLabel || selectedReport.summary.operationAdvice || '-'}</p>
                  <Badge
                    className="mt-3"
                    style={{
                      color: getSentimentColor(selectedReport.summary.sentimentScore ?? 50),
                      borderColor: `${getSentimentColor(selectedReport.summary.sentimentScore ?? 50)}33`,
                      backgroundColor: `${getSentimentColor(selectedReport.summary.sentimentScore ?? 50)}12`,
                    }}
                  >
                    情绪分 {selectedReport.summary.sentimentScore ?? '-'}
                  </Badge>
                </div>
              </div>
            ) : (
              <InlineAlert variant="warning" title="暂无研究摘要" message="该标的还没有历史分析报告。" />
            )}
          </section>

          <section className="dashboard-card p-4 sm:p-5">
            <SectionTitle icon={<Database className="h-4 w-4" />} eyebrow="Evidence" title="证据质量" />
            {evidenceBlocks.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {evidenceBlocks.map((block) => <EvidenceBlock key={block.key} block={block} />)}
              </div>
            ) : (
              <InlineAlert variant="warning" title="暂无证据摘要" message="旧报告可能没有 AnalysisContextPack 质量摘要。" />
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="dashboard-card p-4 sm:p-5">
            <SectionTitle icon={<CalendarClock className="h-4 w-4" />} eyebrow="Events" title="事件" />
            {news.length > 0 ? (
              <div className="space-y-2">
                {news.map((item) => (
                  <a
                    key={`${item.url}-${item.title}`}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="home-subpanel block p-3"
                  >
                    <span className="line-clamp-2 text-sm font-medium text-foreground">{item.title}</span>
                    <span className="mt-1 line-clamp-2 text-xs leading-5 text-secondary-text">{item.snippet}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted-text">暂无关联新闻或事件。</p>
            )}
          </section>

          <section className="dashboard-card p-4 sm:p-5">
            <SectionTitle icon={<FileText className="h-4 w-4" />} eyebrow="Reports" title="报告" />
            {reports.length > 0 ? (
              <div className="space-y-2">
                {reports.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="home-subpanel grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 p-3 text-left"
                    onClick={() => void loadReportDetail(item.id)}
                  >
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm font-medium text-foreground">{compactText(item.analysisSummary, item.operationAdvice || '历史报告')}</span>
                      <span className="mt-1 block text-xs text-muted-text">{formatDateTime(item.createdAt)}</span>
                    </span>
                    <Badge size="sm">{item.sentimentScore ?? '-'}</Badge>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted-text">暂无历史报告。</p>
            )}
          </section>

          <section className="dashboard-card p-4 sm:p-5">
            <SectionTitle icon={<ShieldAlert className="h-4 w-4" />} eyebrow="Monitors" title="监控" />
            <div className="home-subpanel p-3">
              <div className="flex items-start gap-2">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <p className="text-sm leading-6 text-secondary-text">
                  进入告警中心，为价格、报告失效条件或自选状态设置提醒。
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" className="mt-3 w-full" onClick={handleMonitor}>
                打开告警中心
              </Button>
            </div>
          </section>

          <section className="dashboard-card p-4 sm:p-5">
            <SectionTitle icon={<Bot className="h-4 w-4" />} eyebrow="Copilot" title="研究助手" />
            <div className="home-subpanel p-3">
              <p className="text-sm leading-6 text-secondary-text">
                基于当前标的和最新报告继续追问，适合复核 thesis、证据质量和下一步动作。
              </p>
              <Button type="button" variant="home-action-ai" size="sm" className="mt-3 w-full" onClick={handleAskAi}>
                问 AI
              </Button>
            </div>
          </section>
        </aside>
      </div>
    </AppPage>
  );
};

const SectionTitle: React.FC<{ icon: React.ReactNode; eyebrow: string; title: string }> = ({ icon, eyebrow, title }) => (
  <div className="mb-4 flex items-center gap-2">
    <span className="text-primary">{icon}</span>
    <span className="label-uppercase text-muted-text">{eyebrow}</span>
    <h2 className="text-base font-semibold text-foreground">{title}</h2>
  </div>
);

const Metric: React.FC<{ label: string; value: string; valueClassName?: string }> = ({ label, value, valueClassName = '' }) => (
  <div className="home-subpanel px-3 py-3">
    <span className="block text-xs text-muted-text">{label}</span>
    <span className={`mt-1 block truncate text-base font-semibold ${valueClassName || 'text-foreground'}`}>{value}</span>
  </div>
);

const LoadingBlock: React.FC = () => (
  <div className="flex h-32 items-center justify-center text-secondary-text">
    <Loader2 className="h-5 w-5 animate-spin" aria-label="加载中" />
  </div>
);

const EvidenceBlock: React.FC<{ block: AnalysisContextPackOverviewBlock }> = ({ block }) => (
  <div className="home-subpanel p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{block.label}</p>
        <p className="mt-1 truncate text-xs text-muted-text">{block.source || 'unknown source'}</p>
      </div>
      <Badge variant={statusVariant(block.status)} size="sm" className="shrink-0 text-[11px]">
        {block.status}
      </Badge>
    </div>
    {block.warnings.length > 0 || block.missingReasons.length > 0 ? (
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-secondary-text">
        {[...block.warnings, ...block.missingReasons].join(' / ')}
      </p>
    ) : (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        可用于本次研究
      </div>
    )}
  </div>
);

export default StockResearchPage;
