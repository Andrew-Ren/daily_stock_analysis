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
    expect(link.links.monitor).toBe('/alerts');
    expect(link.links.view).toBeUndefined();
    expect(link.metadata.stock_code).toBe('600519');

    const actions = Object.fromEntries(link.actions.map((item) => [item.action, item]));
    expect(actions.view.href).toBe('/stocks/600519');
    expect(actions.view.available).toBe(false);
    expect(actions.view.disabledReason).toBe('stock_detail_route_pending');
    expect(actions.monitor.params.target_entity_ref).toBe('stock:CN:600519');
  });

  it('routes report outcome tracking through decision signals', () => {
    const link = buildEntityLink('report', '123', { label: 'AAPL report' });
    const actions = Object.fromEntries(link.actions.map((item) => [item.action, item]));

    expect(link.ref).toBe('report:123');
    expect(actions.track_outcome.href).toBe('/decision-signals');
    expect(actions.track_outcome.available).toBe(true);
    expect(actions.view.available).toBe(false);
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
