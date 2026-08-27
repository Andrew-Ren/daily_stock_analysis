import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../../contexts/UiLanguageContext';
import type { HistoryItem, StockBarItem } from '../../../types/analysis';
import { UI_LANGUAGE_STORAGE_KEY } from '../../../utils/uiLanguage';
import { DashboardOverview } from '../DashboardOverview';

const latestMarketReview: HistoryItem = {
  id: 10,
  queryId: 'market-latest',
  stockCode: 'MARKET',
  stockName: '大盘复盘',
  reportType: 'market_review',
  region: 'cn,hk',
  analysisSummary: '风险偏好回升，科技成长领涨',
  operationAdvice: '关注结构机会',
  sentimentScore: 68,
  createdAt: '2026-03-19T08:00:00Z',
};

const previousMarketReview: HistoryItem = {
  id: 9,
  queryId: 'market-previous',
  stockCode: 'MARKET',
  stockName: '大盘复盘',
  reportType: 'market_review',
  region: 'cn',
  analysisSummary: '市场维持震荡，量能不足',
  operationAdvice: '控制仓位',
  sentimentScore: 52,
  createdAt: '2026-03-18T08:00:00Z',
};

const todayItems: StockBarItem[] = [{
  id: 30,
  stockCode: '600519',
  stockName: '贵州茅台',
  reportType: 'detailed',
  sentimentScore: 82,
  operationAdvice: '关注',
  analysisCount: 1,
  lastAnalysisTime: '2026-03-19T09:00:00+08:00',
}];

const baseProps = {
  latestMarketReview,
  previousMarketReview,
  marketReviewCount: 2,
  marketReviewLoading: false,
  stockBarItems: todayItems,
  stockBarLoading: false,
  stockBarRefreshFailed: false,
  watchlistRows: [{
    code: '600519',
    analyzedToday: true,
    latestItem: todayItems[0],
  }],
  watchlistLoading: false,
  todayAnalysisItems: todayItems,
  todayLoadError: false,
  activeTasks: [],
  isSubmittingMarketReview: false,
  onRunMarketReview: vi.fn(),
  onOpenMarketReview: vi.fn(),
  onOpenStockReport: vi.fn(),
  onOpenWorkspaceTab: vi.fn(),
  onOpenTasks: vi.fn(),
  onRefresh: vi.fn(),
};

const renderOverview = (props: Partial<typeof baseProps> = {}) => render(
  <UiLanguageProvider>
    <DashboardOverview {...baseProps} {...props} />
  </UiLanguageProvider>,
);

describe('DashboardOverview', () => {
  beforeEach(() => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh');
  });

  it('summarizes market changes and personal progress', () => {
    renderOverview();

    expect(screen.getByTestId('dashboard-overview')).toBeInTheDocument();
    expect(screen.getByText('风险偏好回升，科技成长领涨')).toBeInTheDocument();
    expect(screen.getByText('情绪分 +16 至 68')).toBeInTheDocument();
    expect(screen.getByText('今日覆盖')).toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('契约待接入')).toBeInTheDocument();
  });

  it('wires overview actions to existing workspace callbacks', () => {
    const onOpenMarketReview = vi.fn();
    const onOpenWorkspaceTab = vi.fn();
    renderOverview({ onOpenMarketReview, onOpenWorkspaceTab });

    fireEvent.click(screen.getByRole('button', { name: /打开复盘/ }));
    expect(onOpenMarketReview).toHaveBeenCalledWith(10);

    fireEvent.click(screen.getByRole('button', { name: /查看自选/ }));
    expect(onOpenWorkspaceTab).toHaveBeenCalledWith('watchlist');
  });
});
