import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertMonitorSummary } from '../AlertMonitorSummary';

const summary = {
  asOf: '2026-08-29T10:00:00',
  rulesTotal: 25,
  enabledRulesTotal: 20,
  triggersTotal: 41,
  unattributedTriggerCount: 1,
  orphanedTriggerCount: 2,
  ruleTypes: [
    { alertType: 'price_cross', ruleCount: 15, enabledCount: 12 },
    { alertType: 'portfolio_drawdown', ruleCount: 10, enabledCount: 8 },
  ],
  triggerStatuses: [
    { status: 'triggered', triggerCount: 39 },
    { status: 'degraded', triggerCount: 2 },
  ],
  rules: [
    {
      ruleId: 7,
      name: '组合回撤',
      alertType: 'portfolio_drawdown',
      severity: 'critical',
      enabled: true,
      triggerCount: 9,
      lastTriggeredAt: '2026-08-29T09:59:00',
    },
  ],
};

describe('AlertMonitorSummary', () => {
  it('renders server-side global counts and rule-id attribution warnings', () => {
    render(<AlertMonitorSummary summary={summary} />);

    expect(screen.getByText('监控概览')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('无 rule_id：1；规则已删除：2')).toBeInTheDocument();
    expect(screen.getByText('#7 组合回撤')).toBeInTheDocument();
    expect(screen.getByText('9 次')).toBeInTheDocument();
    expect(screen.getByText(/只按 rule_id 关联/)).toBeInTheDocument();
  });
});
