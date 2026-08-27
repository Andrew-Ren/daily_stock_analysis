import type React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { historyApi } from '../../api/history';
import { stocksApi } from '../../api/stocks';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { UI_LANGUAGE_STORAGE_KEY } from '../../utils/uiLanguage';
import StockResearchPage from '../StockResearchPage';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ stockCode: '600519' }),
  };
});

vi.mock('recharts', () => ({
  ResponsiveContainer: () => <div data-testid="chart" />,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock('../../api/stocks', () => ({
  stocksApi: {
    getQuote: vi.fn(),
    getHistory: vi.fn(),
  },
}));

vi.mock('../../api/history', () => ({
  historyApi: {
    getList: vi.fn(),
    getDetail: vi.fn(),
    getNews: vi.fn(),
  },
}));

const latestReport = {
  meta: {
    id: 11,
    queryId: 'q-11',
    stockCode: '600519',
    stockName: '贵州茅台',
    reportType: 'detailed' as const,
    createdAt: '2026-03-19T08:00:00Z',
  },
  summary: {
    analysisSummary: '趋势维持强势',
    operationAdvice: '持有',
    actionLabel: '持有',
    trendPrediction: '震荡上行',
    sentimentScore: 82,
  },
  details: {
    analysisContextPackOverview: {
      packVersion: 'v1',
      subject: { code: '600519', stockName: '贵州茅台', market: 'cn' },
      blocks: [
        {
          key: 'daily_price',
          label: '日线行情',
          status: 'available' as const,
          source: 'tencent',
          warnings: [],
          missingReasons: [],
        },
      ],
      counts: {
        available: 1,
        missing: 0,
        notSupported: 0,
        fallback: 0,
        stale: 0,
        estimated: 0,
        partial: 0,
        fetchFailed: 0,
      },
      warnings: [],
      metadata: {},
    },
  },
};

describe('StockResearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh');
    vi.mocked(stocksApi.getQuote).mockResolvedValue({
      stockCode: '600519',
      stockName: '贵州茅台',
      currentPrice: 1688,
      changePercent: 1.23,
      high: 1700,
      low: 1660,
      amount: 1200000000,
      updateTime: '2026-03-19T10:00:00Z',
    });
    vi.mocked(stocksApi.getHistory).mockResolvedValue({
      stockCode: '600519',
      stockName: '贵州茅台',
      period: 'daily',
      data: [
        { date: '2026-03-18', open: 1600, high: 1660, low: 1590, close: 1650 },
        { date: '2026-03-19', open: 1650, high: 1700, low: 1640, close: 1688 },
      ],
    });
    vi.mocked(historyApi.getList).mockResolvedValue({
      total: 1,
      page: 1,
      limit: 8,
      items: [{
        id: 11,
        queryId: 'q-11',
        stockCode: '600519',
        stockName: '贵州茅台',
        reportType: 'detailed',
        analysisSummary: '趋势维持强势',
        sentimentScore: 82,
        operationAdvice: '持有',
        createdAt: '2026-03-19T08:00:00Z',
      }],
    });
    vi.mocked(historyApi.getDetail).mockResolvedValue(latestReport);
    vi.mocked(historyApi.getNews).mockResolvedValue({
      total: 1,
      items: [{ title: '公司公告', snippet: '业绩保持稳定', url: 'https://example.com/news' }],
    });
  });

  it('renders stock research workspace sections from existing APIs', async () => {
    render(
      <UiLanguageProvider>
        <StockResearchPage />
      </UiLanguageProvider>,
    );

    expect(await screen.findByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('行情快照')).toBeInTheDocument();
    expect(screen.getByText('K 线概览')).toBeInTheDocument();
    expect(screen.getByText('研究摘要')).toBeInTheDocument();
    expect(screen.getByText('证据质量')).toBeInTheDocument();
    expect(screen.getByText('事件')).toBeInTheDocument();
    expect(screen.getByText('报告')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '监控' })).toBeInTheDocument();
    expect(screen.getByText('研究助手')).toBeInTheDocument();
    expect(screen.getAllByText('趋势维持强势').length).toBeGreaterThan(0);
    expect(screen.getByText('日线行情')).toBeInTheDocument();
    expect(screen.getByText('公司公告')).toBeInTheDocument();
  });

  it('opens chat with stock and latest report context', async () => {
    render(
      <UiLanguageProvider>
        <StockResearchPage />
      </UiLanguageProvider>,
    );

    await screen.findAllByText('趋势维持强势');
    fireEvent.click(screen.getAllByRole('button', { name: '问 AI' })[0]);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/chat?stock=600519&name=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0&recordId=11');
    });
  });
});
