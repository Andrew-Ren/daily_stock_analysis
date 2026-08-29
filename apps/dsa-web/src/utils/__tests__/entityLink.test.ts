import { describe, expect, it } from 'vitest';
import { buildEntityAction, buildEntityLink, makeEntityRef, parseEntityRef } from '../entityLink';

describe('entityLink helpers', () => {
  it('builds stable stock actions and marks pending routes unavailable', () => {
    const link = buildEntityLink('stock', 'CN:600519', {
      label: '贵州茅台',
      metadata: { stock_code: '600519' },
    });

    expect(link.ref).toBe('stock:CN:600519');
    expect(link.entityType).toBe('stock');
    expect(link.links.monitor).toBeUndefined();
    expect(link.links.view).toBeUndefined();
    expect(link.metadata.stock_code).toBe('600519');

    const actions = Object.fromEntries(link.actions.map((item) => [item.action, item]));
    expect(actions.view.href).toBe('/stocks/600519');
    expect(actions.view.available).toBe(false);
    expect(actions.view.disabledReason).toBe('stock_detail_route_pending');
    expect(actions.analyze.available).toBe(false);
    expect(actions.watch.available).toBe(false);
    expect(actions.monitor.available).toBe(false);
    expect(actions.ask_ai.available).toBe(false);
    expect(actions.analyze.disabledReason).toBe('stock_action_context_pending');
    expect(actions.watch.disabledReason).toBe('stock_action_context_pending');
    expect(actions.monitor.disabledReason).toBe('stock_action_context_pending');
    expect(actions.ask_ai.disabledReason).toBe('stock_action_context_pending');
    expect(actions.monitor.params.target_entity_ref).toBe('stock:CN:600519');
  });

  it('routes report outcome tracking through decision signals', () => {
    const link = buildEntityLink('report', '123', { label: 'AAPL report' });
    const actions = Object.fromEntries(link.actions.map((item) => [item.action, item]));

    expect(link.ref).toBe('report:123');
    expect(actions.track_outcome.href).toBe('/decision-signals?sourceReportId=123');
    expect(actions.track_outcome.available).toBe(true);
    expect(actions.view.available).toBe(false);
  });

  it.each([
    ['strategy', 'value:quality'],
    ['signal', '42'],
    ['alert', '900'],
    ['portfolio_position', 'default:AAPL'],
    ['calendar_event', 'earnings:AAPL:2026-09-01'],
  ] as const)('fails closed when %s target pages do not consume entity context', (entityType, entityId) => {
    const link = buildEntityLink(entityType, entityId);

    expect(link.links).toEqual({});
    expect(link.actions.every((action) => !action.available)).toBe(true);
    expect(link.actions.every((action) => Boolean(action.disabledReason))).toBe(true);
  });

  it('requires a positive numeric report id for decision-signal filtering', () => {
    const link = buildEntityLink('report', 'report/123');
    const action = link.actions.find((item) => item.action === 'track_outcome');

    expect(link.links).toEqual({});
    expect(action?.available).toBe(false);
    expect(action?.disabledReason).toBe('invalid_entity_context');
  });

  it('validates refs and builds unavailable unsupported actions', () => {
    expect(makeEntityRef('signal', '42')).toBe('signal:42');
    expect(parseEntityRef('alert:900')).toEqual(['alert', '900']);
    expect(() => makeEntityRef('stock', '')).toThrow('entityId is required');
    expect(() => parseEntityRef('missing_separator')).toThrow("entity ref must contain ':'");

    const action = buildEntityAction('index', 'CN:000300', 'compare');
    expect(action.available).toBe(false);
    expect(action.disabledReason).toBe('unsupported_action');
    expect(action.href).toBeNull();
  });
});
