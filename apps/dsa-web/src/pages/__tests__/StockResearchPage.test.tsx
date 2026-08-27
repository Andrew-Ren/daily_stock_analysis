import type React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { historyApi } from '../../api/history';
import { stocksApi } from '../../api/stocks';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { UI_LANGUAGE_STORAGE_KEY } from '../../utils/uiLanguage';
import StockResearchPage from '../StockResearchPage';

const navigate = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({ stockCode: '600519' }));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ stockCode: routeParams.stockCode }),
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

const secondReport = {
  meta: {
    id: 22,
    queryId: 'q-22',
    stockCode: '600519',
    stockName: '贵州茅台',
    reportType: 'detailed' as const,
    createdAt: '2026-03-18T08:00:00Z',
  },
  summary: {
    analysisSummary: '短线先观察',
    operationAdvice: '观望',
    actionLabel: '观望',
    trendPrediction: '量能不足',
    sentimentScore: 41,
  },
  details: {
    analysisContextPackOverview: {
      packVersion: 'v1',
      subject: { code: '600519', stockName: '贵州茅台', market: 'cn' },
      blocks: [],
      counts: {
        available: 0,
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

const thirdReport = {
  meta: {
    id: 33,
    queryId: 'q-33',
    stockCode: '600519',
    stockName: '贵州茅台',
    reportType: 'detailed' as const,
    createdAt: '2026-03-20T08:00:00Z',
  },
  summary: {
    analysisSummary: '继续上修目标价',
    operationAdvice: '加仓',
    actionLabel: '加仓',
    trendPrediction: '机构资金持续流入',
    sentimentScore: 91,
  },
  details: {
    analysisContextPackOverview: {
      packVersion: 'v1',
      subject: { code: '600519', stockName: '贵州茅台', market: 'cn' },
      blocks: [],
      counts: {
        available: 0,
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
    routeParams.stockCode = '600519';
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

  it('ignores stale workspace responses after the route stock changes', async () => {
    const firstQuote = createDeferred<Awaited<ReturnType<typeof stocksApi.getQuote>>>();
    const firstHistory = createDeferred<Awaited<ReturnType<typeof stocksApi.getHistory>>>();
    const firstReports = createDeferred<Awaited<ReturnType<typeof historyApi.getList>>>();
    const firstDetail = createDeferred<Awaited<ReturnType<typeof historyApi.getDetail>>>();
    const firstNews = createDeferred<Awaited<ReturnType<typeof historyApi.getNews>>>();

    vi.mocked(stocksApi.getQuote).mockImplementation((stockCode) => (
      stockCode === '600519'
        ? firstQuote.promise
        : Promise.resolve({
          stockCode: 'AAPL',
          stockName: 'Apple Inc.',
          currentPrice: 245.12,
          changePercent: 0.81,
          high: 246,
          low: 243.5,
          amount: 850000000,
          updateTime: '2026-03-19T10:05:00Z',
        })
    ));
    vi.mocked(stocksApi.getHistory).mockImplementation((stockCode) => (
      stockCode === '600519'
        ? firstHistory.promise
        : Promise.resolve({
          stockCode: 'AAPL',
          stockName: 'Apple Inc.',
          period: 'daily',
          data: [
            { date: '2026-03-18', open: 241, high: 244, low: 240, close: 243.8 },
            { date: '2026-03-19', open: 244, high: 246, low: 243.5, close: 245.12 },
          ],
        })
    ));
    vi.mocked(historyApi.getList).mockImplementation((params = {}) => (
      params.stockCode === '600519'
        ? firstReports.promise
        : Promise.resolve({
          total: 1,
          page: 1,
          limit: 8,
          items: [{
            id: 21,
            queryId: 'q-21',
            stockCode: 'AAPL',
            stockName: 'Apple Inc.',
            reportType: 'detailed',
            analysisSummary: '苹果新高后仍有延续',
            sentimentScore: 74,
            operationAdvice: '持有',
            createdAt: '2026-03-19T09:00:00Z',
          }],
        })
    ));
    vi.mocked(historyApi.getDetail).mockImplementation((recordId) => (
      recordId === 11
        ? firstDetail.promise
        : Promise.resolve({
          ...latestReport,
          meta: {
            ...latestReport.meta,
            id: 21,
            queryId: 'q-21',
            stockCode: 'AAPL',
            stockName: 'Apple Inc.',
          },
          summary: {
            ...latestReport.summary,
            analysisSummary: '苹果新高后仍有延续',
            trendPrediction: '美股趋势保持强势',
          },
          details: {
            ...latestReport.details,
            analysisContextPackOverview: {
              ...latestReport.details.analysisContextPackOverview,
              subject: { code: 'AAPL', stockName: 'Apple Inc.', market: 'us' },
            },
          },
        })
    ));
    vi.mocked(historyApi.getNews).mockImplementation((recordId) => (
      recordId === 11
        ? firstNews.promise
        : Promise.resolve({
          total: 1,
          items: [{ title: 'Apple earnings', snippet: 'Services revenue remains strong', url: 'https://example.com/aapl' }],
        })
    ));

    const view = render(
      <UiLanguageProvider>
        <StockResearchPage />
      </UiLanguageProvider>,
    );

    await waitFor(() => {
      expect(stocksApi.getQuote).toHaveBeenCalledWith('600519');
    });

    routeParams.stockCode = 'AAPL';
    view.rerender(
      <UiLanguageProvider>
        <StockResearchPage />
      </UiLanguageProvider>,
    );

    expect(await screen.findByText('Apple Inc.')).toBeInTheDocument();
    expect(await screen.findByText('美股趋势保持强势')).toBeInTheDocument();
    expect(await screen.findByText('Apple earnings')).toBeInTheDocument();

    firstQuote.resolve({
      stockCode: '600519',
      stockName: '贵州茅台',
      currentPrice: 1688,
      changePercent: 1.23,
      high: 1700,
      low: 1660,
      amount: 1200000000,
      updateTime: '2026-03-19T10:00:00Z',
    });
    firstHistory.resolve({
      stockCode: '600519',
      stockName: '贵州茅台',
      period: 'daily',
      data: [
        { date: '2026-03-18', open: 1600, high: 1660, low: 1590, close: 1650 },
        { date: '2026-03-19', open: 1650, high: 1700, low: 1640, close: 1688 },
      ],
    });
    firstReports.resolve({
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
    firstDetail.resolve(latestReport);
    firstNews.resolve({
      total: 1,
      items: [{ title: '公司公告', snippet: '业绩保持稳定', url: 'https://example.com/news' }],
    });

    await waitFor(() => {
      expect(screen.getByText('Apple Inc.')).toBeInTheDocument();
      expect(screen.getByText('美股趋势保持强势')).toBeInTheDocument();
      expect(screen.getByText('Apple earnings')).toBeInTheDocument();
      expect(screen.queryByText('贵州茅台')).not.toBeInTheDocument();
    });
  });

  it('ignores stale report detail responses from the previous stock after route changes', async () => {
    const firstDetail = createDeferred<Awaited<ReturnType<typeof historyApi.getDetail>>>();
    const firstNews = createDeferred<Awaited<ReturnType<typeof historyApi.getNews>>>();

    vi.mocked(historyApi.getList).mockImplementation((params = {}) => (
      params.stockCode === '600519'
        ? Promise.resolve({
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
        })
        : Promise.resolve({
          total: 1,
          page: 1,
          limit: 8,
          items: [{
            id: 21,
            queryId: 'q-21',
            stockCode: 'AAPL',
            stockName: 'Apple Inc.',
            reportType: 'detailed',
            analysisSummary: '苹果新高后仍有延续',
            sentimentScore: 74,
            operationAdvice: '持有',
            createdAt: '2026-03-19T09:00:00Z',
          }],
        })
    ));
    vi.mocked(historyApi.getDetail).mockImplementation((recordId) => {
      if (recordId === 11) {
        return firstDetail.promise;
      }
      if (recordId === 21) {
        return Promise.resolve({
          ...latestReport,
          meta: {
            ...latestReport.meta,
            id: 21,
            queryId: 'q-21',
            stockCode: 'AAPL',
            stockName: 'Apple Inc.',
          },
          summary: {
            ...latestReport.summary,
            analysisSummary: '苹果新高后仍有延续',
            trendPrediction: '美股趋势保持强势',
          },
          details: {
            ...latestReport.details,
            analysisContextPackOverview: {
              ...latestReport.details.analysisContextPackOverview,
              subject: { code: 'AAPL', stockName: 'Apple Inc.', market: 'us' },
            },
          },
        });
      }
      return Promise.reject(new Error(`unexpected recordId ${recordId}`));
    });
    vi.mocked(historyApi.getNews).mockImplementation((recordId) => {
      if (recordId === 11) {
        return firstNews.promise;
      }
      if (recordId === 21) {
        return Promise.resolve({
          total: 1,
          items: [{ title: 'Apple earnings', snippet: 'Services revenue remains strong', url: 'https://example.com/aapl' }],
        });
      }
      return Promise.reject(new Error(`unexpected recordId ${recordId}`));
    });
    vi.mocked(stocksApi.getQuote).mockImplementation((stockCode) => Promise.resolve(
      stockCode === '600519'
        ? {
          stockCode: '600519',
          stockName: '贵州茅台',
          currentPrice: 1688,
          changePercent: 1.23,
          high: 1700,
          low: 1660,
          amount: 1200000000,
          updateTime: '2026-03-19T10:00:00Z',
        }
        : {
          stockCode: 'AAPL',
          stockName: 'Apple Inc.',
          currentPrice: 245.12,
          changePercent: 0.81,
          high: 246,
          low: 243.5,
          amount: 850000000,
          updateTime: '2026-03-19T10:05:00Z',
        },
    ));
    vi.mocked(stocksApi.getHistory).mockImplementation((stockCode) => Promise.resolve(
      stockCode === '600519'
        ? {
          stockCode: '600519',
          stockName: '贵州茅台',
          period: 'daily',
          data: [
            { date: '2026-03-18', open: 1600, high: 1660, low: 1590, close: 1650 },
            { date: '2026-03-19', open: 1650, high: 1700, low: 1640, close: 1688 },
          ],
        }
        : {
          stockCode: 'AAPL',
          stockName: 'Apple Inc.',
          period: 'daily',
          data: [
            { date: '2026-03-18', open: 241, high: 244, low: 240, close: 243.8 },
            { date: '2026-03-19', open: 244, high: 246, low: 243.5, close: 245.12 },
          ],
        },
    ));

    const view = render(
      <UiLanguageProvider>
        <StockResearchPage />
      </UiLanguageProvider>,
    );

    await waitFor(() => {
      expect(historyApi.getDetail).toHaveBeenCalledWith(11);
    });

    routeParams.stockCode = 'AAPL';
    view.rerender(
      <UiLanguageProvider>
        <StockResearchPage />
      </UiLanguageProvider>,
    );

    expect(await screen.findByText('Apple Inc.')).toBeInTheDocument();
    expect(await screen.findByText('美股趋势保持强势')).toBeInTheDocument();
    expect(await screen.findByText('Apple earnings')).toBeInTheDocument();

    firstDetail.resolve(latestReport);
    firstNews.resolve({
      total: 1,
      items: [{ title: '旧信号', snippet: '不应覆盖新标的', url: 'https://example.com/old' }],
    });

    await waitFor(() => {
      expect(screen.getByText('Apple Inc.')).toBeInTheDocument();
      expect(screen.getByText('美股趋势保持强势')).toBeInTheDocument();
      expect(screen.getByText('Apple earnings')).toBeInTheDocument();
      expect(screen.queryByText('贵州茅台')).not.toBeInTheDocument();
      expect(screen.queryByText('震荡上行')).not.toBeInTheDocument();
      expect(screen.queryByText('旧信号')).not.toBeInTheDocument();
    });
  });

  it('keeps the latest clicked report details when earlier requests finish later', async () => {
    const slowDetail = createDeferred<Awaited<ReturnType<typeof historyApi.getDetail>>>();
    const slowNews = createDeferred<Awaited<ReturnType<typeof historyApi.getNews>>>();
    const fastDetail = createDeferred<Awaited<ReturnType<typeof historyApi.getDetail>>>();
    const fastNews = createDeferred<Awaited<ReturnType<typeof historyApi.getNews>>>();

    vi.mocked(historyApi.getList).mockResolvedValue({
      total: 3,
      page: 1,
      limit: 8,
      items: [
        {
          id: 33,
          queryId: 'q-33',
          stockCode: '600519',
          stockName: '贵州茅台',
          reportType: 'detailed',
          analysisSummary: '继续上修目标价',
          sentimentScore: 91,
          operationAdvice: '加仓',
          createdAt: '2026-03-20T08:00:00Z',
        },
        {
          id: 11,
          queryId: 'q-11',
          stockCode: '600519',
          stockName: '贵州茅台',
          reportType: 'detailed',
          analysisSummary: '趋势维持强势',
          sentimentScore: 82,
          operationAdvice: '持有',
          createdAt: '2026-03-19T08:00:00Z',
        },
        {
          id: 22,
          queryId: 'q-22',
          stockCode: '600519',
          stockName: '贵州茅台',
          reportType: 'detailed',
          analysisSummary: '短线先观察',
          sentimentScore: 41,
          operationAdvice: '观望',
          createdAt: '2026-03-18T08:00:00Z',
        },
      ],
    });
    vi.mocked(historyApi.getDetail)
      .mockImplementation((recordId) => {
        if (recordId === 33) {
          return Promise.resolve(thirdReport);
        }
        if (recordId === 11) {
          return slowDetail.promise;
        }
        if (recordId === 22) {
          return fastDetail.promise;
        }
        return Promise.reject(new Error(`unexpected recordId ${recordId}`));
      });
    vi.mocked(historyApi.getNews)
      .mockImplementation((recordId) => {
        if (recordId === 33) {
          return Promise.resolve({
            total: 1,
            items: [{ title: '提价预期', snippet: '渠道反馈稳定', url: 'https://example.com/third' }],
          });
        }
        if (recordId === 11) {
          return slowNews.promise;
        }
        if (recordId === 22) {
          return fastNews.promise;
        }
        return Promise.reject(new Error(`unexpected recordId ${recordId}`));
      });

    render(
      <UiLanguageProvider>
        <StockResearchPage />
      </UiLanguageProvider>,
    );

    expect(await screen.findByText('机构资金持续流入')).toBeInTheDocument();
    expect(await screen.findByText('提价预期')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /趋势维持强势/ }));
    fireEvent.click(screen.getByRole('button', { name: /短线先观察/ }));

    fastDetail.resolve(secondReport);
    fastNews.resolve({
      total: 1,
      items: [{ title: '观望信号', snippet: '资金面转弱', url: 'https://example.com/second' }],
    });

    expect(await screen.findByText('量能不足')).toBeInTheDocument();
    expect(await screen.findByText('观望信号')).toBeInTheDocument();

    slowDetail.resolve(latestReport);
    slowNews.resolve({
      total: 1,
      items: [{ title: '旧信号', snippet: '不应覆盖最新选择', url: 'https://example.com/first' }],
    });

    await waitFor(() => {
      expect(screen.getByText('量能不足')).toBeInTheDocument();
      expect(screen.getByText('观望信号')).toBeInTheDocument();
      expect(screen.queryByText('震荡上行')).not.toBeInTheDocument();
      expect(screen.queryByText('旧信号')).not.toBeInTheDocument();
    });
  });
});
