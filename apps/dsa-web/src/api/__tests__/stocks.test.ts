import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stocksApi } from '../stocks';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());

vi.mock('../index', () => ({
  default: {
    get,
    post,
  },
}));

describe('stocksApi market data helpers', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('loads and camelizes realtime quote payloads', async () => {
    get.mockResolvedValue({
      data: {
        stock_code: '600519',
        stock_name: '贵州茅台',
        current_price: 1688,
        change_percent: 1.23,
        update_time: '2026-03-19T10:00:00',
      },
    });

    const quote = await stocksApi.getQuote('600519.SH');

    expect(get).toHaveBeenCalledWith('/api/v1/stocks/600519.SH/quote');
    expect(quote.stockCode).toBe('600519');
    expect(quote.changePercent).toBe(1.23);
    expect(quote.updateTime).toBe('2026-03-19T10:00:00');
  });

  it('loads K-line history with default daily params', async () => {
    get.mockResolvedValue({
      data: {
        stock_code: '600519',
        period: 'daily',
        data: [{ date: '2026-03-19', change_percent: 1.2, close: 1688 }],
      },
    });

    const history = await stocksApi.getHistory('600519');

    expect(get).toHaveBeenCalledWith('/api/v1/stocks/600519/history', {
      params: { period: 'daily', days: 90 },
    });
    expect(history.data[0].changePercent).toBe(1.2);
  });
});
