import type React from 'react';
import { Activity, Link2Off } from 'lucide-react';
import type { AlertMonitorSummary as AlertMonitorSummaryData } from '../../types/alerts';
import { formatDateTime } from '../../utils/format';
import { Badge, Card, EmptyState, InlineAlert, Loading } from '../common';

type Props = {
  summary: AlertMonitorSummaryData | null;
  loading?: boolean;
};

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded-lg border border-subtle bg-base/35 px-3 py-2.5">
      <div className="text-xs text-muted-text">{label}</div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-xs text-secondary-text">{note}</div>
    </div>
  );
}

export const AlertMonitorSummary: React.FC<Props> = ({ summary, loading = false }) => (
  <Card title="监控概览" subtitle="全局聚合" variant="bordered" padding="md">
    {loading && !summary ? <Loading label="正在加载监控概览" /> : null}
    {!loading && !summary ? (
      <EmptyState icon={<Activity className="h-6 w-6" />} title="暂无监控概览" description="规则列表仍可独立使用。" />
    ) : null}
    {summary ? (
      <div className="space-y-4">
        {(summary.unattributedTriggerCount > 0 || summary.orphanedTriggerCount > 0) ? (
          <InlineAlert
            variant="warning"
            title="存在无法完整归因的触发记录"
            message={`无 rule_id：${summary.unattributedTriggerCount}；规则已删除：${summary.orphanedTriggerCount}`}
          />
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="规则" value={summary.rulesTotal} note={`${summary.enabledRulesTotal} 条启用`} />
          <Stat label="触发记录" value={summary.triggersTotal} note="独立于当前分页" />
          <Stat label="规则类型" value={summary.ruleTypes.length} note={formatDateTime(summary.asOf)} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <section>
            <h4 className="text-sm font-semibold text-foreground">规则类型覆盖</h4>
            <div className="mt-2 grid gap-2">
              {summary.ruleTypes.map((item) => (
                <div key={item.alertType} className="flex items-center justify-between rounded-lg border border-subtle bg-base/25 px-3 py-2 text-sm">
                  <span className="font-mono text-foreground">{item.alertType}</span>
                  <span className="text-secondary-text">{item.enabledCount}/{item.ruleCount} 启用</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h4 className="text-sm font-semibold text-foreground">触发状态</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {summary.triggerStatuses.map((item) => (
                <Badge key={item.status} variant={item.status === 'triggered' ? 'danger' : 'warning'}>
                  {item.status} · {item.triggerCount}
                </Badge>
              ))}
              {summary.triggerStatuses.length === 0 ? <span className="text-sm text-secondary-text">暂无触发记录</span> : null}
            </div>
            <h4 className="mt-4 text-sm font-semibold text-foreground">按规则归因</h4>
            <div className="mt-2 grid gap-2">
              {summary.rules.slice(0, 8).map((item) => (
                <div key={item.ruleId} className="flex items-center justify-between gap-3 rounded-lg border border-subtle bg-base/25 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-foreground">#{item.ruleId} {item.name}</div>
                    <div className="mt-1 font-mono text-xs text-muted-text">{item.alertType}</div>
                  </div>
                  <Badge variant={item.triggerCount > 0 ? 'warning' : 'default'}>{item.triggerCount} 次</Badge>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-text">
          <Link2Off className="h-3.5 w-3.5" />触发归因只按 rule_id 关联，不按股票 target 猜测规则。
        </div>
      </div>
    ) : null}
  </Card>
);
