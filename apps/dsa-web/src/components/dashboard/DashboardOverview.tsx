import type React from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  LineChart,
  ListChecks,
  RefreshCw,
} from 'lucide-react';
import { Badge, Button } from '../common';
import { DashboardPanelHeader } from './DashboardPanelHeader';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { HistoryItem, StockBarItem, TaskInfo } from '../../types/analysis';
import { getSentimentColor } from '../../types/analysis';
import type { HomeWatchlistRow, HomeWorkspaceTab } from '../watchlist/HomeStockWorkspace';
import { formatDateTime } from '../../utils/format';
import { truncateStockName } from '../../utils/stockName';

interface DashboardOverviewProps {
  latestMarketReview?: HistoryItem;
  previousMarketReview?: HistoryItem;
  marketReviewCount: number;
  marketReviewLoading: boolean;
  stockBarItems: StockBarItem[];
  stockBarLoading: boolean;
  stockBarRefreshFailed: boolean;
  watchlistRows: HomeWatchlistRow[];
  watchlistLoading: boolean;
  todayAnalysisItems: StockBarItem[];
  todayLoadError: boolean;
  activeTasks: TaskInfo[];
  isSubmittingMarketReview: boolean;
  onRunMarketReview: () => void;
  onOpenMarketReview: (recordId: number) => void;
  onOpenStockReport: (recordId: number) => void;
  onOpenWorkspaceTab: (tab: HomeWorkspaceTab) => void;
  onOpenTasks: () => void;
  onRefresh: () => void;
}

type ChangeItem = {
  key: string;
  label: string;
  tone: 'info' | 'success' | 'warning' | 'default';
};

const ACTIVE_TASK_STATUSES = new Set<TaskInfo['status']>(['pending', 'processing', 'cancel_requested']);

const compactText = (value?: string | null, fallback = ''): string => {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 84 ? `${normalized.slice(0, 84)}...` : normalized;
};

const formatScore = (value?: number): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return String(Math.round(value));
};

const getMarketReviewTitle = (item: HistoryItem | undefined, fallback: string): string => (
  compactText(item?.analysisSummary, compactText(item?.trendPrediction, compactText(item?.operationAdvice, fallback)))
);

const buildWhatChanged = (
  latest: HistoryItem | undefined,
  previous: HistoryItem | undefined,
  t: ReturnType<typeof useUiLanguage>['t'],
): ChangeItem[] => {
  if (!latest) {
    return [{
      key: 'no-review',
      label: t('home.dashboardNoMarketReviewDescription'),
      tone: 'default',
    }];
  }
  if (!previous) {
    return [{
      key: 'waiting-comparison',
      label: t('home.dashboardSecondReviewPending'),
      tone: 'info',
    }];
  }

  const changes: ChangeItem[] = [];
  if (latest.createdAt !== previous.createdAt) {
    changes.push({
      key: 'time',
      label: t('home.dashboardReviewTimeChanged', {
        previous: formatDateTime(previous.createdAt),
        latest: formatDateTime(latest.createdAt),
      }),
      tone: 'info',
    });
  }

  if (
    typeof latest.sentimentScore === 'number'
    && typeof previous.sentimentScore === 'number'
    && latest.sentimentScore !== previous.sentimentScore
  ) {
    const delta = Math.round(latest.sentimentScore - previous.sentimentScore);
    changes.push({
      key: 'score',
      label: t('home.dashboardScoreChanged', {
        direction: delta > 0 ? '+' : '',
        delta,
        score: Math.round(latest.sentimentScore),
      }),
      tone: delta >= 0 ? 'success' : 'warning',
    });
  }

  const latestAdvice = compactText(latest.actionLabel || latest.operationAdvice);
  const previousAdvice = compactText(previous.actionLabel || previous.operationAdvice);
  if (latestAdvice && previousAdvice && latestAdvice !== previousAdvice) {
    changes.push({
      key: 'advice',
      label: t('home.dashboardAdviceChanged', {
        previous: previousAdvice,
        latest: latestAdvice,
      }),
      tone: 'warning',
    });
  }

  if (latest.region && previous.region && latest.region !== previous.region) {
    changes.push({
      key: 'region',
      label: t('home.dashboardRegionChanged', {
        previous: previous.region,
        latest: latest.region,
      }),
      tone: 'info',
    });
  }

  const latestSummary = compactText(latest.analysisSummary);
  const previousSummary = compactText(previous.analysisSummary);
  if (latestSummary && latestSummary !== previousSummary) {
    changes.push({
      key: 'summary',
      label: t('home.dashboardSummaryRefreshed', { summary: latestSummary }),
      tone: 'info',
    });
  }

  if (changes.length === 0) {
    changes.push({
      key: 'stable',
      label: t('home.dashboardNoMaterialChange'),
      tone: 'default',
    });
  }

  return changes.slice(0, 4);
};

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  latestMarketReview,
  previousMarketReview,
  marketReviewCount,
  marketReviewLoading,
  stockBarItems,
  stockBarLoading,
  stockBarRefreshFailed,
  watchlistRows,
  watchlistLoading,
  todayAnalysisItems,
  todayLoadError,
  activeTasks,
  isSubmittingMarketReview,
  onRunMarketReview,
  onOpenMarketReview,
  onOpenStockReport,
  onOpenWorkspaceTab,
  onOpenTasks,
  onRefresh,
}) => {
  const { t } = useUiLanguage();
  const activeTaskItems = activeTasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  const watchlistTotal = watchlistRows.length;
  const analyzedToday = watchlistRows.filter((row) => row.analyzedToday).length;
  const pendingWatchlist = watchlistRows.filter(
    (row) => !row.analyzedToday && !row.isTodayStatusLoading && !row.isTodayStatusUnknown,
  ).length;
  const stockItems = stockBarItems.filter((item) => item.stockCode !== 'MARKET');
  const topTodayItems = todayAnalysisItems.slice(0, 3);
  const whatChanged = buildWhatChanged(latestMarketReview, previousMarketReview, t);
  const marketToneColor = getSentimentColor(latestMarketReview?.sentimentScore ?? 50);
  const systemStatus = stockBarRefreshFailed
    ? t('home.dashboardSystemRefreshFailed')
    : stockBarLoading || marketReviewLoading || watchlistLoading
      ? t('home.dashboardSystemRefreshing')
      : t('home.dashboardSystemRefreshOk');
  const systemStatusVariant = stockBarRefreshFailed ? 'danger' : stockBarLoading || marketReviewLoading || watchlistLoading ? 'warning' : 'success';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8" data-testid="dashboard-overview">
      <div className="dashboard-card p-4 sm:p-5">
        <DashboardPanelHeader
          eyebrow={t('home.dashboardOverviewEyebrow')}
          title={t('home.dashboardTitle')}
          accentEyebrow
          leading={<LineChart className="h-4 w-4 text-primary" aria-hidden="true" />}
          actions={(
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              disabled={stockBarLoading || marketReviewLoading || watchlistLoading}
            >
              <RefreshCw className={`h-4 w-4 ${stockBarLoading || marketReviewLoading || watchlistLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('home.dashboardRefresh')}
            </Button>
          )}
          className="mb-3"
        />
        <p className="max-w-3xl text-sm leading-6 text-secondary-text">
          {t('home.dashboardSubtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <section className="dashboard-card min-w-0 p-4 sm:p-5">
          <DashboardPanelHeader
            eyebrow={t('home.dashboardMarketEyebrow')}
            title={t('home.dashboardMarketTitle')}
            leading={<BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />}
            actions={latestMarketReview ? (
              <Button
                type="button"
                variant="home-action-ai"
                size="sm"
                onClick={() => onOpenMarketReview(latestMarketReview.id)}
              >
                {t('home.dashboardOpenLatestReview')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="home-action-ai"
                size="sm"
                isLoading={isSubmittingMarketReview}
                loadingText={t('home.submitMarketReview')}
                onClick={onRunMarketReview}
              >
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                {t('home.dashboardRunReview')}
              </Button>
            )}
          />

          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="home-subpanel min-w-0 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="label-uppercase text-muted-text">{t('home.dashboardLatestReview')}</p>
                  <h3 className="mt-2 line-clamp-3 text-lg font-semibold leading-7 text-foreground">
                    {getMarketReviewTitle(latestMarketReview, t('home.dashboardNoMarketReview'))}
                  </h3>
                </div>
                <Badge
                  variant="default"
                  size="sm"
                  className="shrink-0 text-[11px]"
                  style={{
                    color: marketToneColor,
                    borderColor: `${marketToneColor}33`,
                    backgroundColor: `${marketToneColor}12`,
                  }}
                >
                  {formatScore(latestMarketReview?.sentimentScore)}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-subtle bg-surface/55 px-3 py-2">
                  <span className="block text-muted-text">{t('home.dashboardMarketTime')}</span>
                  <span className="mt-1 block truncate font-medium text-foreground">{formatDateTime(latestMarketReview?.createdAt)}</span>
                </div>
                <div className="rounded-lg border border-subtle bg-surface/55 px-3 py-2">
                  <span className="block text-muted-text">{t('home.dashboardMarketHistoryCount')}</span>
                  <span className="mt-1 block font-medium text-foreground">{marketReviewCount}</span>
                </div>
              </div>
            </div>

            <div className="home-subpanel min-w-0 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">{t('home.dashboardWhatChanged')}</h3>
              </div>
              <div className="space-y-2">
                {whatChanged.map((item) => (
                  <div key={item.key} className="flex min-w-0 items-start gap-2 rounded-lg border border-subtle bg-surface/50 px-3 py-2">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      item.tone === 'success'
                        ? 'bg-success'
                        : item.tone === 'warning'
                          ? 'bg-warning'
                          : item.tone === 'info'
                            ? 'bg-primary'
                            : 'bg-muted-text'
                    }`} />
                    <span className="min-w-0 text-xs leading-5 text-secondary-text">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="dashboard-card min-w-0 p-4 sm:p-5">
          <DashboardPanelHeader
            eyebrow={t('home.dashboardQuickEyebrow')}
            title={t('home.startAnalysisTitle')}
            leading={<ListChecks className="h-4 w-4 text-primary" aria-hidden="true" />}
          />
          <p className="text-sm leading-6 text-secondary-text">{t('home.startAnalysisDescription')}</p>
          <p className="mt-2 text-xs leading-5 text-muted-text">{t('home.dashboardQuickStartAction')}</p>
          <div className="mt-4 grid gap-2">
            <Button type="button" variant="home-action-ai" size="sm" onClick={onRunMarketReview} isLoading={isSubmittingMarketReview}>
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              {t('home.dashboardRunReview')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenWorkspaceTab('watchlist')}>
              {t('home.dashboardOpenWatchlist')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="dashboard-card min-w-0 p-4 sm:p-5">
          <DashboardPanelHeader
            eyebrow={t('home.dashboardPersonalEyebrow')}
            title={t('home.dashboardPersonalTitle')}
            leading={<CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
            actions={(
              <Button type="button" variant="secondary" size="sm" onClick={() => onOpenWorkspaceTab('today')}>
                {t('home.dashboardOpenToday')}
              </Button>
            )}
          />
          <div className="grid grid-cols-3 gap-2">
            <MetricTile label={t('home.dashboardWatchlistCount')} value={watchlistTotal} />
            <MetricTile label={t('home.dashboardWatchlistDone')} value={`${analyzedToday}/${Math.max(watchlistTotal, 0)}`} />
            <MetricTile label={t('home.dashboardWatchlistPending')} value={pendingWatchlist} />
          </div>
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-secondary-text">{t('home.dashboardTodayLeaders')}</p>
            {todayLoadError ? (
              <p className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
                {t('home.dashboardTodayLoadFailed')}
              </p>
            ) : topTodayItems.length > 0 ? (
              <div className="space-y-2">
                {topTodayItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={t('home.dashboardOpenStockReportAria', { id: item.id })}
                    className="home-subpanel grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2 text-left"
                    onClick={() => onOpenStockReport(item.id)}
                  >
                    <span className="min-w-0 truncate text-xs font-medium text-foreground">
                      {truncateStockName(item.stockName || item.stockCode)}
                    </span>
                    <Badge size="sm" variant="success" className="text-[11px]">{formatScore(item.sentimentScore)}</Badge>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-subtle bg-surface/55 px-3 py-2 text-xs text-muted-text">
                {t('home.dashboardNoTodayLeaders')}
              </p>
            )}
          </div>
        </section>

        <section className="dashboard-card min-w-0 p-4 sm:p-5">
          <DashboardPanelHeader
            eyebrow={t('home.dashboardActivityEyebrow')}
            title={t('home.dashboardActivityTitle')}
            leading={<Clock3 className="h-4 w-4 text-warning" aria-hidden="true" />}
            actions={(
              <Button type="button" variant="secondary" size="sm" onClick={onOpenTasks}>
                {t('home.dashboardOpenTasks')}
              </Button>
            )}
          />
          <div className="home-subpanel px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">
                {activeTaskItems.length > 0
                  ? t('home.dashboardTaskActive', { count: activeTaskItems.length })
                  : t('home.dashboardTaskIdle')}
              </span>
              <Badge variant={activeTaskItems.length > 0 ? 'warning' : 'success'} size="sm">
                {activeTaskItems.length}
              </Badge>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {activeTaskItems.slice(0, 3).map((task) => (
              <div key={task.taskId} className="rounded-lg border border-subtle bg-surface/50 px-3 py-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-foreground">
                    {task.stockName || task.stockCode || task.taskId}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-text">{task.progress}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(task.progress, 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-card min-w-0 p-4 sm:p-5">
          <DashboardPanelHeader
            eyebrow={t('home.dashboardSystemEyebrow')}
            title={t('home.dashboardSystemTitle')}
            leading={<Database className="h-4 w-4 text-primary" aria-hidden="true" />}
          />
          <div className="space-y-2">
            <div className="home-subpanel flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-xs text-secondary-text">{t('home.dashboardSystemRefreshLabel')}</span>
              <Badge variant={systemStatusVariant} size="sm" className="text-[11px]">
                {systemStatus}
              </Badge>
            </div>
            <div className="home-subpanel flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-xs text-secondary-text">{t('home.dashboardStockHistoryCount')}</span>
              <span className="text-sm font-semibold text-foreground">{stockItems.length}</span>
            </div>
            <div className="home-subpanel flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-xs text-secondary-text">{t('home.dashboardDataContractLabel')}</span>
              <Badge variant="warning" size="sm" className="text-[11px]">
                {t('home.dashboardDataContractPending')}
              </Badge>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

const MetricTile: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-lg border border-subtle bg-surface/55 px-3 py-2">
    <span className="block truncate text-[11px] text-muted-text">{label}</span>
    <span className="mt-1 block truncate text-base font-semibold text-foreground">{value}</span>
  </div>
);
