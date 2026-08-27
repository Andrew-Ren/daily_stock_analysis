import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertInvalidationRadar } from '../AlertInvalidationRadar';
import type { AlertRuleItem, AlertTriggerItem } from '../../../types/alerts';

const rules: AlertRuleItem[] = [
  {
    id: 1,
    name: '茅台跌破买入假设',
    targetScope: 'single_symbol',
    target: '600519',
    alertType: 'price_cross',
    parameters: { direction: 'below', price: 1650 },
    severity: 'warning',
    enabled: true,
    source: 'api',
  },
  {
    id: 2,
    name: '组合止损',
    targetScope: 'portfolio_account',
    target: 'all',
    alertType: 'portfolio_stop_loss',
    parameters: { mode: 'breach' },
    severity: 'critical',
    enabled: true,
    source: 'api',
  },
  {
    id: 3,
    name: 'MACD 观察',
    targetScope: 'single_symbol',
    target: '300750',
    alertType: 'macd_cross',
    parameters: { direction: 'bearish_cross', fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    severity: 'info',
    enabled: false,
    source: 'api',
  },
];

const triggers: AlertTriggerItem[] = [
  {
    id: 10,
    ruleId: 1,
    target: '600519',
    observedValue: 1648,
    threshold: 1650,
    reason: '价格跌破关键支撑',
    dataSource: 'realtime_quote',
    dataTimestamp: '2026-05-18T09:30:00',
    triggeredAt: '2026-05-18T09:30:01',
    status: 'triggered',
  },
  {
    id: 11,
    ruleId: 2,
    target: 'all',
    observedValue: null,
    threshold: null,
    reason: '组合价格降级',
    triggeredAt: '2026-05-18T09:31:01',
    status: 'degraded',
  },
];

describe('AlertInvalidationRadar', () => {
  it('summarizes guard coverage, problem triggers, and missing guard families', () => {
    render(<AlertInvalidationRadar rules={rules} triggers={triggers} />);

    expect(screen.getByText('假设失效雷达')).toBeInTheDocument();
    expect(screen.getByText('2/4')).toBeInTheDocument();
    expect(screen.getByText('2 条启用规则')).toBeInTheDocument();
    expect(screen.getByText('2 条失效线索')).toBeInTheDocument();
    expect(screen.getByText('价格失效')).toBeInTheDocument();
    expect(screen.getByText('组合失效')).toBeInTheDocument();
    expect(screen.getByText('技术失效')).toBeInTheDocument();
    expect(screen.getByText('大盘失效')).toBeInTheDocument();
    expect(screen.getAllByText('已覆盖')).toHaveLength(2);
    expect(screen.getAllByText('待补规则')).toHaveLength(2);
    expect(screen.getByText('价格跌破关键支撑')).toBeInTheDocument();
    expect(screen.getByText('组合价格降级')).toBeInTheDocument();
  });
});
