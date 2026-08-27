import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DataCenterPage from '../DataCenterPage';

const {
  getConfig,
  getScreeningStatus,
  getSourceHistory,
} = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getScreeningStatus: vi.fn(),
  getSourceHistory: vi.fn(),
}));

vi.mock('../../api/systemConfig', () => ({
  systemConfigApi: {
    getConfig: (...args: unknown[]) => getConfig(...args),
  },
}));

vi.mock('../../api/screening', () => ({
  screeningApi: {
    getStatus: () => getScreeningStatus(),
    getSourceHistory: (limit: number) => getSourceHistory(limit),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  getConfig.mockResolvedValue({
    configVersion: 'v1',
    maskToken: '******',
    items: [
      {
        key: 'TICKFLOW_API_KEY',
        value: '******',
        rawValueExists: true,
        isMasked: true,
        schema: {
          key: 'TICKFLOW_API_KEY',
          title: 'TickFlow API Key',
          category: 'data_source',
          dataType: 'string',
          uiControl: 'password',
          isSensitive: true,
          isRequired: false,
          isEditable: true,
          options: [],
          validation: {},
          displayOrder: 1,
        },
      },
      {
        key: 'REALTIME_SOURCE_PRIORITY',
        value: 'tencent,akshare',
        rawValueExists: true,
        isMasked: false,
        schema: {
          key: 'REALTIME_SOURCE_PRIORITY',
          title: '实时数据源优先级',
          category: 'data_source',
          dataType: 'string',
          uiControl: 'text',
          isSensitive: false,
          isRequired: false,
          isEditable: true,
          options: [],
          validation: {},
          displayOrder: 2,
        },
      },
      {
        key: 'MODEL_NAME',
        value: 'gpt-test',
        rawValueExists: true,
        isMasked: false,
        schema: {
          key: 'MODEL_NAME',
          title: '模型',
          category: 'ai_model',
          dataType: 'string',
          uiControl: 'text',
          isSensitive: false,
          isRequired: false,
          isEditable: true,
          options: [],
          validation: {},
          displayOrder: 3,
        },
      },
    ],
  });
  getScreeningStatus.mockResolvedValue({
    enabled: true,
    available: true,
    sourceHealth: {
      akshare: {
        snapshot: { status: 'degraded', message: 'timeout fallback' },
      },
      tickflow: {
        daily: { status: 'available', updatedAt: '2026-05-18T09:30:00' },
      },
    },
    diagnostics: {
      screening_snapshot: 'akshare degraded, fallback used',
    },
  });
  getSourceHistory.mockResolvedValue({
    enabled: true,
    runsAnalyzed: 8,
    fallbackRuns: 2,
    sources: {
      akshare: {
        selectedRuns: 5,
        errorCount: 1,
        lastSeenAt: '2026-05-18T09:30:00',
        errorSamples: ['timeout'],
      },
      tickflow: {
        selectedRuns: 3,
        errorCount: 0,
        lastSeenAt: '2026-05-18T09:00:00',
        errorSamples: [],
      },
    },
  });
});

describe('DataCenterPage', () => {
  it('loads data source config, source history, health snapshot, and diagnostics', async () => {
    render(<DataCenterPage />);

    expect(await screen.findByRole('heading', { name: '数据中心' })).toBeInTheDocument();
    await waitFor(() => expect(getConfig).toHaveBeenCalledWith(true));
    expect(getSourceHistory).toHaveBeenCalledWith(100);
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByText('TickFlow API Key')).toBeInTheDocument();
    expect(screen.getByText('tencent,akshare')).toBeInTheDocument();
    expect(screen.queryByText('gpt-test')).not.toBeInTheDocument();
    expect(screen.getAllByText('akshare').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('tickflow').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('timeout')).toBeInTheDocument();
    expect(screen.getByText('timeout fallback')).toBeInTheDocument();
    expect(screen.getByText('screening_snapshot')).toBeInTheDocument();
    expect(screen.getByText('akshare degraded, fallback used')).toBeInTheDocument();
  });
});
