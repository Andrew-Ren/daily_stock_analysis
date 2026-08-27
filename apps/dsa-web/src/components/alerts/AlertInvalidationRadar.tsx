import type React from 'react';
import { Activity, CircleAlert, Radar, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Badge, Card, Loading, StatusDot } from '../common';
import type { AlertRuleItem, AlertTriggerItem, AlertType } from '../../types/alerts';
import { cn } from '../../utils/cn';
import { formatDateTime } from '../../utils/format';

type GuardFamilyKey = 'price' | 'technical' | 'portfolio' | 'market';

interface GuardFamily {
  key: GuardFamilyKey;
  title: string;
  description: string;
  alertTypes: AlertType[];
}

interface FamilySummary extends GuardFamily {
  enabledCount: number;
  totalCount: number;
  latestTriggeredAt?: string | null;
}

const GUARD_FAMILIES: GuardFamily[] = [
  {
    key: 'price',
    title: '价格失效',
    description: '关键价位、涨跌幅',
    alertTypes: ['price_cross', 'price_change_percent', 'volume_spike'],
  },
  {
    key: 'technical',
    title: '技术失效',
    description: '均线、RSI、MACD、KDJ、CCI',
    alertTypes: ['ma_price_cross', 'rsi_threshold', 'macd_cross', 'kdj_cross', 'cci_threshold'],
  },
  {
    key: 'portfolio',
    title: '组合失效',
    description: '止损、集中度、回撤、价格新鲜度',
    alertTypes: ['portfolio_stop_loss', 'portfolio_concentration', 'portfolio_drawdown', 'portfolio_price_stale'],
  },
  {
    key: 'market',
    title: '大盘失效',
    description: '红绿灯状态、市场评分下行',
    alertTypes: ['market_light_status', 'market_light_score_drop'],
  },
];

const FAMILY_BY_TYPE = GUARD_FAMILIES.reduce((mapping, family) => {
  family.alertTypes.forEach((alertType) => {
    mapping[alertType] = family.key;
  });
  return mapping;
}, {} as Record<AlertType, GuardFamilyKey>);

function familyForRule(rule: AlertRuleItem): GuardFamilyKey {
  return FAMILY_BY_TYPE[rule.alertType] ?? 'price';
}

function isTriggerProblem(status: string): boolean {
  return status === 'triggered' || status === 'degraded' || status === 'failed';
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--';
  return Number.isFinite(value) ? String(value) : '--';
}

function buildFamilySummaries(rules: AlertRuleItem[], triggers: AlertTriggerItem[]): FamilySummary[] {
  return GUARD_FAMILIES.map((family) => {
    const familyRules = rules.filter((rule) => familyForRule(rule) === family.key);
    const familyTargets = new Set(familyRules.map((rule) => rule.target));
    const latestTriggeredAt = triggers
      .filter((trigger) => familyTargets.has(trigger.target) && isTriggerProblem(trigger.status))
      .map((trigger) => trigger.triggeredAt ?? trigger.dataTimestamp ?? null)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return {
      ...family,
      totalCount: familyRules.length,
      enabledCount: familyRules.filter((rule) => rule.enabled).length,
      latestTriggeredAt,
    };
  });
}

const StatTile: React.FC<{
  label: string;
  value: string;
  note: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}> = ({ label, value, note, tone = 'neutral' }) => (
  <div className="min-w-0 rounded-lg border border-subtle bg-base/35 px-3 py-2.5">
    <div className="flex items-center gap-2 text-xs text-muted-text">
      <StatusDot tone={tone} className="h-2 w-2" />
      <span className="truncate">{label}</span>
    </div>
    <div className="mt-2 truncate text-xl font-semibold text-foreground">{value}</div>
    <div className="mt-1 truncate text-xs text-secondary-text">{note}</div>
  </div>
);

const FamilyRow: React.FC<{ family: FamilySummary }> = ({ family }) => {
  const covered = family.enabledCount > 0;
  return (
    <div className="grid gap-2 rounded-lg border border-subtle bg-base/25 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot tone={covered ? 'success' : 'warning'} className="h-2 w-2" />
          <span className="truncate text-sm font-medium text-foreground">{family.title}</span>
        </div>
        <div className="mt-1 truncate text-xs text-muted-text">{family.description}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Badge variant={covered ? 'success' : 'warning'}>{covered ? '已覆盖' : '待补规则'}</Badge>
        <span className="text-xs text-secondary-text">{family.enabledCount}/{family.totalCount}</span>
        <span className="text-xs text-muted-text">{formatDateTime(family.latestTriggeredAt)}</span>
      </div>
    </div>
  );
};

const TriggerRow: React.FC<{ trigger: AlertTriggerItem }> = ({ trigger }) => (
  <div className="grid gap-2 rounded-lg border border-subtle bg-base/25 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot
          tone={trigger.status === 'triggered' ? 'danger' : 'warning'}
          className="h-2 w-2"
        />
        <span className="truncate font-mono text-sm font-medium text-foreground">{trigger.target}</span>
        <Badge variant={trigger.status === 'triggered' ? 'danger' : 'warning'}>{trigger.status}</Badge>
      </div>
      <div className="mt-1 line-clamp-2 text-xs text-secondary-text">
        {trigger.reason || trigger.diagnostics || '暂无原因'}
      </div>
    </div>
    <div className="text-xs text-muted-text sm:text-right">
      <div>{formatNumber(trigger.observedValue)} / {formatNumber(trigger.threshold)}</div>
      <div className="mt-1">{formatDateTime(trigger.triggeredAt ?? trigger.dataTimestamp)}</div>
    </div>
  </div>
);

interface AlertInvalidationRadarProps {
  rules: AlertRuleItem[];
  triggers: AlertTriggerItem[];
  rulesLoading?: boolean;
  triggersLoading?: boolean;
  className?: string;
}

export const AlertInvalidationRadar: React.FC<AlertInvalidationRadarProps> = ({
  rules,
  triggers,
  rulesLoading = false,
  triggersLoading = false,
  className,
}) => {
  const enabledRules = rules.filter((rule) => rule.enabled);
  const criticalRules = enabledRules.filter((rule) => rule.severity === 'critical');
  const problemTriggers = triggers.filter((trigger) => isTriggerProblem(trigger.status));
  const triggeredGuards = problemTriggers.filter((trigger) => trigger.status === 'triggered');
  const dataGapTriggers = problemTriggers.filter((trigger) => trigger.status === 'degraded' || trigger.status === 'failed');
  const familySummaries = buildFamilySummaries(rules, triggers);
  const coveredFamilies = familySummaries.filter((family) => family.enabledCount > 0);
  const recentProblemTriggers = problemTriggers.slice(0, 4);

  return (
    <Card
      title="假设失效雷达"
      subtitle="规则守卫"
      variant="bordered"
      padding="md"
      className={cn('space-y-4', className)}
    >
      {rulesLoading || triggersLoading ? <Loading label="正在加载失效雷达" /> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile
          label="守卫覆盖"
          value={`${coveredFamilies.length}/${GUARD_FAMILIES.length}`}
          note={`${enabledRules.length} 条启用规则`}
          tone={coveredFamilies.length === GUARD_FAMILIES.length ? 'success' : 'warning'}
        />
        <StatTile
          label="近期触发"
          value={String(triggeredGuards.length)}
          note={`${problemTriggers.length} 条失效线索`}
          tone={triggeredGuards.length > 0 ? 'danger' : 'success'}
        />
        <StatTile
          label="数据缺口"
          value={String(dataGapTriggers.length)}
          note="degraded / failed"
          tone={dataGapTriggers.length > 0 ? 'warning' : 'success'}
        />
        <StatTile
          label="高优先级"
          value={String(criticalRules.length)}
          note="critical rules"
          tone={criticalRules.length > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
            守卫矩阵
          </div>
          <div className="grid gap-2">
            {familySummaries.map((family) => (
              <FamilyRow key={family.key} family={family} />
            ))}
          </div>
        </section>

        <section className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            {recentProblemTriggers.length > 0 ? (
              <TriangleAlert className="h-4 w-4 text-warning" aria-hidden="true" />
            ) : (
              <Radar className="h-4 w-4 text-primary" aria-hidden="true" />
            )}
            近期失效线索
          </div>
          {recentProblemTriggers.length === 0 ? (
            <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-subtle bg-base/20 px-4 py-6 text-center">
              <div>
                <CircleAlert className="mx-auto h-5 w-5 text-muted-text" aria-hidden="true" />
                <div className="mt-2 text-sm font-medium text-foreground">暂无失效线索</div>
                <div className="mt-1 text-xs text-muted-text">最近触发记录没有 triggered、degraded 或 failed。</div>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              {recentProblemTriggers.map((trigger) => (
                <TriggerRow key={trigger.id} trigger={trigger} />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-text">
        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
        <span>规则覆盖负责事前约束，触发历史负责事后复盘，通知记录负责送达诊断。</span>
      </div>
    </Card>
  );
};
