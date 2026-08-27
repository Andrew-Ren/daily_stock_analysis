import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Database, FileWarning, RefreshCw, ServerCog } from 'lucide-react';
import { AppPage, Badge, Button, Card, EmptyState, InlineAlert, Loading, PageHeader, StatusDot } from '../components/common';
import { screeningApi, type ScreeningSourceHistory, type ScreeningStatus } from '../api/screening';
import { systemConfigApi } from '../api/systemConfig';
import type { SystemConfigItem, SystemConfigResponse } from '../types/systemConfig';
import { formatDateTime } from '../utils/format';

const DATA_SOURCE_KEY_PATTERN = /(SOURCE|TUSHARE|TICKFLOW|AKSHARE|YFINANCE|LONG.?BRIDGE|FUTU|PYTDX|BAOSTOCK|EFINANCE|TENCENT|SINA)/i;

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface HealthRow {
  provider: string;
  dataset: string;
  status: string;
  message: string;
}

function isDataSourceItem(item: SystemConfigItem): boolean {
  return item.schema?.category === 'data_source' || DATA_SOURCE_KEY_PATTERN.test(item.key);
}

function isConfigured(item: SystemConfigItem): boolean {
  return item.rawValueExists || Boolean(item.value && item.value !== '******');
}

function formatConfigValue(item: SystemConfigItem): string {
  if (item.isMasked) return item.rawValueExists ? '已保存' : '未配置';
  if (!item.value) return item.rawValueExists ? '已配置' : '未配置';
  return item.value.length > 42 ? `${item.value.slice(0, 39)}...` : item.value;
}

function flattenSourceHealth(status: ScreeningStatus | null): HealthRow[] {
  const rows: HealthRow[] = [];
  const health = status?.sourceHealth || {};
  Object.entries(health).forEach(([provider, datasets]) => {
    Object.entries(datasets || {}).forEach(([dataset, rawInfo]) => {
      const info = rawInfo || {};
      const statusValue = info.status || info.qualityStatus || info.health || info.state || 'unknown';
      const messageValue = info.message || info.reason || info.error || info.updatedAt || '';
      rows.push({
        provider,
        dataset,
        status: String(statusValue),
        message: String(messageValue || '--'),
      });
    });
  });
  return rows.sort((a, b) => `${a.provider}.${a.dataset}`.localeCompare(`${b.provider}.${b.dataset}`));
}

function sourceStatusTone(errorCount: number): 'success' | 'warning' | 'danger' {
  if (errorCount === 0) return 'success';
  if (errorCount <= 2) return 'warning';
  return 'danger';
}

function healthTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const normalized = status.toLowerCase();
  if (normalized.includes('ok') || normalized.includes('available') || normalized.includes('healthy')) return 'success';
  if (normalized.includes('partial') || normalized.includes('stale') || normalized.includes('degraded')) return 'warning';
  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('unavailable')) return 'danger';
  return 'neutral';
}

const StatTile: React.FC<{ label: string; value: string; note: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' }> = ({
  label,
  value,
  note,
  tone = 'neutral',
}) => (
  <div className="rounded-xl border border-border/75 bg-card/85 px-4 py-3">
    <div className="flex min-w-0 items-center gap-2 text-xs text-secondary-text">
      <StatusDot tone={tone} className="h-2 w-2" />
      <span className="truncate">{label}</span>
    </div>
    <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
    <div className="mt-1 truncate text-xs text-muted-text">{note}</div>
  </div>
);

const DataCenterPage: React.FC = () => {
  const [state, setState] = useState<LoadState>('idle');
  const [config, setConfig] = useState<SystemConfigResponse | null>(null);
  const [screeningStatus, setScreeningStatus] = useState<ScreeningStatus | null>(null);
  const [sourceHistory, setSourceHistory] = useState<ScreeningSourceHistory | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = '数据中心 - DSA';
  }, []);

  const loadData = useCallback(async () => {
    setState('loading');
    setError('');
    const [configResult, statusResult, historyResult] = await Promise.allSettled([
      systemConfigApi.getConfig(true),
      screeningApi.getStatus(),
      screeningApi.getSourceHistory(100),
    ]);

    if (configResult.status === 'fulfilled') {
      setConfig(configResult.value);
    }
    if (statusResult.status === 'fulfilled') {
      setScreeningStatus(statusResult.value);
    }
    if (historyResult.status === 'fulfilled') {
      setSourceHistory(historyResult.value);
    }

    const failed = [configResult, statusResult, historyResult].filter((result) => result.status === 'rejected').length;
    setState(failed === 3 ? 'error' : 'ready');
    if (failed > 0) {
      setError(`有 ${failed} 个诊断接口暂时不可用，页面已展示可读取部分。`);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const dataSourceItems = useMemo(
    () => (config?.items || []).filter(isDataSourceItem).sort((a, b) => a.key.localeCompare(b.key)),
    [config],
  );
  const configuredItems = dataSourceItems.filter(isConfigured);
  const sourceRows = Object.entries(sourceHistory?.sources || {})
    .map(([source, value]) => ({ source, ...value }))
    .sort((a, b) => b.selectedRuns - a.selectedRuns || b.errorCount - a.errorCount);
  const healthRows = flattenSourceHealth(screeningStatus);
  const diagnosticRows = Object.entries(screeningStatus?.diagnostics || {}).sort(([a], [b]) => a.localeCompare(b));
  const totalSourceErrors = sourceRows.reduce((sum, row) => sum + row.errorCount, 0);
  const isLoading = state === 'loading' || state === 'idle';

  return (
    <AppPage className="space-y-5">
      <PageHeader
        eyebrow="Data Center"
        title="数据中心"
        description="集中查看数据源配置、选股源历史、运行健康快照和降级诊断。"
      />

      {error ? <InlineAlert variant={state === 'error' ? 'danger' : 'warning'} title="诊断未完整加载" message={error} /> : null}

      <div className="flex justify-end">
        <Button size="sm" variant="secondary" isLoading={isLoading} loadingText="刷新中..." onClick={() => void loadData()}>
          <RefreshCw className="h-4 w-4" />
          刷新诊断
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile
          label="配置项"
          value={`${configuredItems.length}/${dataSourceItems.length}`}
          note="数据源相关配置"
          tone={configuredItems.length > 0 ? 'success' : 'warning'}
        />
        <StatTile
          label="选股源运行"
          value={String(sourceHistory?.runsAnalyzed ?? 0)}
          note={`fallback ${sourceHistory?.fallbackRuns ?? 0}`}
          tone={(sourceHistory?.fallbackRuns ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatTile
          label="源错误"
          value={String(totalSourceErrors)}
          note={`${sourceRows.length} 个历史源`}
          tone={totalSourceErrors > 0 ? 'warning' : 'success'}
        />
        <StatTile
          label="健康快照"
          value={String(healthRows.length)}
          note={screeningStatus?.available ? 'screening available' : 'screening unavailable'}
          tone={screeningStatus?.available ? 'success' : 'warning'}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="数据源配置" subtitle="Config" variant="bordered" padding="md">
          {isLoading && !config ? <Loading label="正在加载数据源配置" /> : null}
          {!isLoading && dataSourceItems.length === 0 ? (
            <EmptyState
              icon={<Database className="h-6 w-6" />}
              title="暂无数据源配置项"
              description="当前配置响应没有返回 data_source 分类或数据源相关 key。"
            />
          ) : null}
          {dataSourceItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-border/60 text-xs uppercase text-muted-text">
                  <tr>
                    <th className="px-3 py-2 font-medium">配置</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">当前值</th>
                    <th className="px-3 py-2 font-medium">类型</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {dataSourceItems.map((item) => (
                    <tr key={item.key} className="align-top">
                      <td className="px-3 py-3">
                        <div className="font-mono text-xs font-semibold text-foreground">{item.key}</div>
                        <div className="mt-1 text-xs text-secondary-text">{item.schema?.title ?? '--'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={isConfigured(item) ? 'success' : 'warning'}>
                          {isConfigured(item) ? '已配置' : '未配置'}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-secondary-text">{formatConfigValue(item)}</td>
                      <td className="px-3 py-3 text-secondary-text">{item.schema?.dataType ?? '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>

        <Card title="运行诊断" subtitle="Diagnostics" variant="bordered" padding="md">
          {isLoading && !screeningStatus ? <Loading label="正在加载运行诊断" /> : null}
          {diagnosticRows.length === 0 ? (
            <EmptyState
              icon={<FileWarning className="h-6 w-6" />}
              title="暂无诊断项"
              description="当前未返回 screening diagnostics。"
            />
          ) : (
            <div className="space-y-2">
              {diagnosticRows.map(([key, value]) => (
                <div key={key} className="rounded-lg border border-border/70 bg-surface/65 px-3 py-2">
                  <div className="font-mono text-xs font-semibold text-foreground">{key}</div>
                  <div className="mt-1 text-xs leading-5 text-secondary-text">{value}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="选股数据源历史" subtitle="Screening Sources" variant="bordered" padding="md">
        {isLoading && !sourceHistory ? <Loading label="正在加载数据源历史" /> : null}
        {!isLoading && sourceRows.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="暂无数据源历史"
            description="选股运行后会记录数据源选用、错误和 fallback 情况。"
          />
        ) : null}
        {sourceRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border/60 text-xs uppercase text-muted-text">
                <tr>
                  <th className="px-3 py-2 font-medium">数据源</th>
                  <th className="px-3 py-2 font-medium">选用次数</th>
                  <th className="px-3 py-2 font-medium">错误次数</th>
                  <th className="px-3 py-2 font-medium">最近使用</th>
                  <th className="px-3 py-2 font-medium">样例</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {sourceRows.map((row) => (
                  <tr key={row.source} className="align-top">
                    <td className="px-3 py-3 font-mono text-foreground">{row.source}</td>
                    <td className="px-3 py-3 text-secondary-text">{row.selectedRuns}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <StatusDot tone={sourceStatusTone(row.errorCount)} className="h-2 w-2" />
                        <span className="text-secondary-text">{row.errorCount}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-secondary-text">{formatDateTime(row.lastSeenAt)}</td>
                    <td className="px-3 py-3 text-secondary-text">
                      {(row.errorSamples || []).slice(0, 2).join('；') || '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card title="健康快照" subtitle="Source Health" variant="bordered" padding="md">
        {isLoading && healthRows.length === 0 ? <Loading label="正在加载健康快照" /> : null}
        {!isLoading && healthRows.length === 0 ? (
          <EmptyState
            icon={<ServerCog className="h-6 w-6" />}
            title="暂无健康快照"
            description="当前 screening status 未返回 sourceHealth。"
          />
        ) : null}
        {healthRows.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {healthRows.map((row) => (
              <div key={`${row.provider}-${row.dataset}`} className="rounded-xl border border-border/70 bg-surface/60 px-3 py-2.5">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-semibold text-foreground">{row.provider}</div>
                    <div className="mt-1 truncate text-xs text-muted-text">{row.dataset}</div>
                  </div>
                  <Badge variant={healthTone(row.status) === 'danger' ? 'danger' : healthTone(row.status) === 'warning' ? 'warning' : 'success'}>
                    {row.status}
                  </Badge>
                </div>
                <div className="mt-2 line-clamp-2 text-xs leading-5 text-secondary-text">{row.message}</div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </AppPage>
  );
};

export default DataCenterPage;
