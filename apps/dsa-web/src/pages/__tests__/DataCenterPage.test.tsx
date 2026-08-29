import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DataCenterPage from '../DataCenterPage';

const { getOverview } = vi.hoisted(() => ({ getOverview: vi.fn() }));

vi.mock('../../api/dataCapability', () => ({
  dataCapabilityApi: { getOverview: () => getOverview() },
}));

const overview = {
  asOf: '2026-08-29T09:30:00+08:00',
  providers: [
    {
      name: 'akshare',
      label: 'AkShare',
      enabled: true,
      configured: true,
      status: 'partial',
      priority: 0,
      markets: ['CN'],
      datasets: ['quote.snapshot', 'financial.snapshot'],
      datasetMarkets: {
        'quote.snapshot': ['CN'],
        'financial.snapshot': ['CN'],
      },
      warnings: ['runtime_probe_unknown'],
      lastError: null,
      cooldown: false,
    },
  ],
  datasets: [
    {
      dataset: 'screening.snapshot',
      status: 'unknown',
      source: 'em_datacenter',
      stale: null,
      lastSuccess: null,
      lastError: null,
      fallbackFrom: [],
      coverage: null,
      warnings: ['screening_health_unknown'],
    },
    {
      dataset: 'quote.snapshot',
      status: 'ok',
      source: 'akshare',
      stale: false,
      lastSuccess: '2026-08-29T09:29:00+08:00',
      lastError: null,
      fallbackFrom: [],
      coverage: null,
      warnings: [],
    },
  ],
  priorities: [
    { scenario: 'cn.quote', providers: ['tencent', 'akshare'], source: 'runtime', warnings: [] },
  ],
  warnings: ['screening_health_unknown'],
};

beforeEach(() => {
  vi.clearAllMocks();
  getOverview.mockResolvedValue(overview);
});

describe('DataCenterPage', () => {
  it('renders the canonical overview without requesting or exposing configuration values', async () => {
    render(<MemoryRouter><DataCenterPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '数据中心' })).toBeInTheDocument();
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(screen.getByText('AkShare')).toBeInTheDocument();
    expect(screen.getByText('screening.snapshot')).toBeInTheDocument();
    expect(screen.getAllByText('screening_health_unknown', { exact: false })).toHaveLength(2);
    expect(screen.getByText('tencent → akshare')).toBeInTheDocument();
    expect(screen.queryByText(/API[_ ]?KEY/i)).not.toBeInTheDocument();
  });

  it('keeps cold-start quality unknown instead of presenting it as healthy', async () => {
    render(<MemoryRouter><DataCenterPage /></MemoryRouter>);

    const row = (await screen.findByText('screening.snapshot')).closest('tr');
    expect(row).toHaveTextContent('unknown');
    expect(row).not.toHaveTextContent('ok');
  });

  it('shows empty and error states and can retry the endpoint', async () => {
    getOverview.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      asOf: '2026-08-29T09:30:00+08:00',
      providers: [],
      datasets: [],
      priorities: [],
      warnings: [],
    });

    render(<MemoryRouter><DataCenterPage /></MemoryRouter>);

    expect(await screen.findByText('数据概览加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('暂无能力数据')).toBeInTheDocument();
    await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(2));
  });
});
