import { describe, expect, it } from 'vitest';
import {
  buildEntityAction,
  buildEntityLink,
  buildStockEntityLink,
  makeEntityRef,
  parseEntityRef,
} from '../entityLink';

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

  it.each([
    ['cn:600519', 'stock:CN:600519'],
    ['600519.SH', 'stock:CN:600519'],
    ['hk:700', 'stock:HK:HK00700'],
    ['aapl', 'stock:US:AAPL'],
    ['8035.T', 'stock:JP:8035.T'],
    ['005930.KS', 'stock:KR:005930.KS'],
    ['2330.TW', 'stock:TW:2330.TW'],
  ])('canonicalizes stock entity id %s before building refs', (entityId, expectedRef) => {
    const link = buildEntityLink('stock', entityId);

    expect(link.ref).toBe(expectedRef);
    expect(link.actions.find((item) => item.action === 'monitor')?.params.target_entity_ref).toBe(expectedRef);
  });

  it('rejects ambiguous or conflicting stock entity ids', () => {
    expect(() => buildEntityLink('stock', '600519')).toThrow('explicit market');
    expect(() => buildEntityLink('stock', '005930')).toThrow('explicit market');
    expect(() => buildEntityLink('stock', 'KR:035900')).toThrow('unsupported stock entityId');
    expect(() => buildEntityLink('stock', 'CN:HK00700')).toThrow('market conflicts');
  });

  it('builds a canonical numeric stock ref when the caller supplies market context', () => {
    const link = buildStockEntityLink('600519', 'cn', { label: '贵州茅台' });

    expect(link.entityId).toBe('CN:600519');
    expect(link.ref).toBe('stock:CN:600519');
  });

  it('accepts longer canonical US symbols from the checked-in stock index', () => {
    const link = buildStockEntityLink('AAICPRC', 'us');

    expect(link.entityId).toBe('US:AAICPRC');
    expect(link.ref).toBe('stock:US:AAICPRC');
  });

  it('accepts indexed US preferred-share symbols with multi-letter suffixes', () => {
    const link = buildStockEntityLink('PEB.PG', 'us');

    expect(link.entityId).toBe('US:PEB.PG');
    expect(link.ref).toBe('stock:US:PEB.PG');
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

  it.each(['9007199254740992', '9007199254740993'])(
    'rejects report id %s outside JavaScript safe integer range',
    (reportId) => {
      const link = buildEntityLink('report', reportId);
      const action = link.actions.find((item) => item.action === 'track_outcome');

      expect(link.links).toEqual({});
      expect(action?.available).toBe(false);
      expect(action?.disabledReason).toBe('invalid_entity_context');
    },
  );

  it('validates refs and builds unavailable unsupported actions', () => {
    expect(makeEntityRef('signal', '42')).toBe('signal:42');
    expect(makeEntityRef('stock', 'cn:600519')).toBe('stock:CN:600519');
    expect(() => makeEntityRef('stock', '600519')).toThrow('explicit market');
    expect(parseEntityRef('alert:900')).toEqual(['alert', '900']);
    expect(() => makeEntityRef('stock', '')).toThrow('entityId is required');
    expect(() => parseEntityRef('missing_separator')).toThrow("entity ref must contain ':'");

    const action = buildEntityAction('index', 'CN:000300', 'compare');
    expect(action.available).toBe(false);
    expect(action.disabledReason).toBe('unsupported_action');
    expect(action.href).toBeNull();
  });
});
