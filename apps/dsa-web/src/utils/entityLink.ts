import type { EntityAction, EntityActionType, EntityLink, EntityType } from '../types/entityLink';
import { normalizeStockCode } from './stockCode';

type RouteTemplate = {
  href: string | null;
  available?: boolean;
  disabledReason?: string | null;
};

const ACTION_LABELS: Record<EntityActionType, string> = {
  view: 'View',
  analyze: 'Analyze',
  watch: 'Watch',
  monitor: 'Monitor',
  ask_ai: 'Ask AI',
  compare: 'Compare',
  track_outcome: 'Track Outcome',
};

const ACTION_ROUTES: Partial<Record<`${EntityType}:${EntityActionType}`, RouteTemplate>> = {
  'stock:view': { href: '/stocks/{code}', available: false, disabledReason: 'stock_detail_route_pending' },
  'stock:analyze': { href: '/', available: false, disabledReason: 'stock_action_context_pending' },
  'stock:watch': { href: '/', available: false, disabledReason: 'stock_action_context_pending' },
  'stock:monitor': { href: '/alerts', available: false, disabledReason: 'stock_action_context_pending' },
  'stock:ask_ai': { href: '/chat', available: false, disabledReason: 'stock_action_context_pending' },
  'stock:compare': { href: '/stocks/compare', available: false, disabledReason: 'compare_route_pending' },
  'index:view': { href: '/market', available: false, disabledReason: 'market_detail_route_pending' },
  'sector:view': { href: '/market', available: false, disabledReason: 'market_detail_route_pending' },
  'concept:view': { href: '/market', available: false, disabledReason: 'market_detail_route_pending' },
  'strategy:view': { href: '/screening', available: false, disabledReason: 'entity_action_context_pending' },
  'strategy:monitor': { href: '/alerts', available: false, disabledReason: 'entity_action_context_pending' },
  'report:view': { href: '/', available: false, disabledReason: 'report_detail_route_pending' },
  'report:monitor': { href: '/alerts', available: false, disabledReason: 'entity_action_context_pending' },
  'report:track_outcome': { href: '/decision-signals?sourceReportId={entity_id}' },
  'signal:view': { href: '/decision-signals', available: false, disabledReason: 'entity_action_context_pending' },
  'signal:track_outcome': { href: '/decision-signals', available: false, disabledReason: 'entity_action_context_pending' },
  'alert:view': { href: '/alerts', available: false, disabledReason: 'entity_action_context_pending' },
  'alert:monitor': { href: '/alerts', available: false, disabledReason: 'entity_action_context_pending' },
  'portfolio_position:view': { href: '/portfolio', available: false, disabledReason: 'entity_action_context_pending' },
  'portfolio_position:analyze': { href: '/', available: false, disabledReason: 'entity_action_context_pending' },
  'portfolio_position:monitor': { href: '/alerts', available: false, disabledReason: 'entity_action_context_pending' },
  'portfolio_position:ask_ai': { href: '/chat', available: false, disabledReason: 'entity_action_context_pending' },
  'calendar_event:view': { href: '/calendar', available: false, disabledReason: 'calendar_route_pending' },
  'calendar_event:monitor': { href: '/alerts', available: false, disabledReason: 'entity_action_context_pending' },
};

const DEFAULT_ACTIONS: Record<EntityType, EntityActionType[]> = {
  stock: ['view', 'analyze', 'watch', 'monitor', 'ask_ai', 'compare'],
  index: ['view', 'monitor', 'ask_ai'],
  sector: ['view', 'monitor', 'ask_ai'],
  concept: ['view', 'monitor', 'ask_ai'],
  strategy: ['view', 'monitor'],
  report: ['view', 'monitor', 'track_outcome'],
  signal: ['view', 'track_outcome'],
  alert: ['view', 'monitor'],
  portfolio_position: ['view', 'analyze', 'monitor', 'ask_ai'],
  calendar_event: ['view', 'monitor'],
};

export const makeEntityRef = (entityType: EntityType | string, entityId: string): string => {
  const normalizedType = String(entityType).trim();
  const normalizedId = String(entityId).trim();
  if (!normalizedType) throw new Error('entityType is required');
  if (!normalizedId) throw new Error('entityId is required');
  return `${normalizedType}:${normalizedId}`;
};

export const parseEntityRef = (ref: string): [string, string] => {
  const normalized = String(ref || '').trim();
  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex < 0) throw new Error("entity ref must contain ':'");
  const entityType = normalized.slice(0, separatorIndex).trim();
  const entityId = normalized.slice(separatorIndex + 1).trim();
  if (!entityType || !entityId) throw new Error('entity ref must include both type and id');
  return [entityType, entityId];
};

export const buildEntityLink = (
  entityType: EntityType,
  entityId: string,
  options: {
    label?: string;
    actions?: EntityActionType[];
    metadata?: Record<string, unknown>;
  } = {},
): EntityLink => {
  const normalizedId = normalizeEntityId(entityType, entityId);
  const actions = options.actions ?? DEFAULT_ACTIONS[entityType] ?? ['view'];
  const actionItems = actions.map((action) => buildEntityAction(entityType, normalizedId, action));
  const links = actionItems.reduce<Partial<Record<EntityActionType, string>>>((result, item) => {
    if (item.href && item.available) result[item.action] = item.href;
    return result;
  }, {});

  return {
    entityType,
    entityId: normalizedId,
    ref: makeEntityRef(entityType, normalizedId),
    label: options.label ?? '',
    links,
    actions: actionItems,
    metadata: options.metadata ?? {},
  };
};

export const buildEntityAction = (
  entityType: EntityType,
  entityId: string,
  action: EntityActionType,
): EntityAction => {
  const normalizedId = normalizeEntityId(entityType, entityId);
  const route = ACTION_ROUTES[`${entityType}:${action}`] ?? {
    href: null,
    available: false,
    disabledReason: 'unsupported_action',
  };
  const params = buildActionParams(entityType, normalizedId, action);
  const href = route.href ? formatHref(route.href, params) : null;
  const hasContext = hasConsumableContext(entityType, normalizedId, action);
  const available = (route.available ?? true) && hasContext;
  return {
    action,
    label: ACTION_LABELS[action],
    href,
    available,
    disabledReason: route.disabledReason ?? (available ? null : 'invalid_entity_context'),
    params,
  };
};

const buildActionParams = (
  entityType: EntityType,
  entityId: string,
  action: EntityActionType,
): Record<string, unknown> => {
  const params: Record<string, unknown> = {
    entity_type: entityType,
    entity_id: entityId,
  };
  if (entityType === 'stock') {
    const [market, code] = splitMarketEntityId(entityId);
    params.market = market.toLowerCase();
    params.code = code;
    params.stock_code = code;
  }
  if (entityType === 'portfolio_position') {
    const parts = entityId.split(':');
    if (parts.length >= 2) {
      params.account_id = parts[0];
      params.symbol = parts[parts.length - 1];
    }
  }
  if (action === 'monitor') {
    params.target_entity_ref = makeEntityRef(entityType, entityId);
  }
  return params;
};

const splitMarketEntityId = (entityId: string): [string, string] => {
  const separatorIndex = entityId.indexOf(':');
  if (separatorIndex < 0) return ['CN', entityId];
  return [entityId.slice(0, separatorIndex) || 'CN', entityId.slice(separatorIndex + 1)];
};

const normalizeEntityId = (entityType: EntityType, entityId: string): string => {
  const normalizedId = String(entityId).trim();
  if (entityType !== 'stock') return normalizedId;
  return normalizeStockEntityId(normalizedId);
};

const normalizeStockEntityId = (entityId: string): string => {
  if (!entityId) throw new Error('entityId is required');
  const separatorIndex = entityId.indexOf(':');
  const explicitMarket = separatorIndex >= 0
    ? entityId.slice(0, separatorIndex).trim().toUpperCase().replace(/^BSE$/, 'CN')
    : '';
  const rawCode = (separatorIndex >= 0 ? entityId.slice(separatorIndex + 1) : entityId).trim();
  const upperCode = rawCode.toUpperCase();
  if (!rawCode || (separatorIndex >= 0 && !explicitMarket)) {
    throw new Error('stock entityId must include a market and code');
  }

  const inferredMarket = inferStockMarket(upperCode);
  const market = explicitMarket || inferredMarket;
  if (!market || !['CN', 'HK', 'US', 'JP', 'KR', 'TW'].includes(market)) {
    throw new Error('unsupported stock entityId');
  }
  if (
    explicitMarket
    && inferredMarket
    && explicitMarket !== inferredMarket
    && !/^\d{6}$/.test(upperCode)
  ) {
    throw new Error('stock entityId market conflicts with code');
  }

  let code = normalizeStockCode(rawCode).toUpperCase();
  if (market === 'HK' && /^\d{1,5}$/.test(code)) code = `HK${code.padStart(5, '0')}`;
  if (market === 'US' && code.endsWith('.US')) code = code.slice(0, -3);
  if (market === 'JP' && /^\d{4,5}$/.test(code)) code = `${code}.T`;

  const valid = (
    (market === 'CN' && /^\d{6}$/.test(code))
    || (market === 'HK' && /^HK\d{5}$/.test(code))
    || (market === 'US' && /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(code))
    || (market === 'JP' && /^\d{4,5}\.T$/.test(code))
    || (market === 'KR' && /^\d{6}\.(?:KS|KQ)$/.test(code))
    || (market === 'TW' && /^\d{4,6}\.TW(?:O)?$/.test(code))
  );
  if (!valid) throw new Error('unsupported stock entityId');
  return `${market}:${code}`;
};

const inferStockMarket = (code: string): string => {
  if (/^(?:(?:SH|SZ|BJ)\.?\d{6}|\d{6}\.(?:SH|SZ|SS|BJ)|\d{6})$/.test(code)) return 'CN';
  if (/^(?:HK\d{1,5}|\d{1,5}\.HK|\d{5})$/.test(code)) return 'HK';
  if (/^\d{4,5}\.T$/.test(code)) return 'JP';
  if (/^\d{6}\.(?:KS|KQ)$/.test(code)) return 'KR';
  if (/^\d{4,6}\.TW(?:O)?$/.test(code)) return 'TW';
  if (/^[A-Z]{1,5}(?:[.-][A-Z])?(?:\.US)?$/.test(code)) return 'US';
  return '';
};

const hasConsumableContext = (entityType: EntityType, entityId: string, action: EntityActionType): boolean => {
  if (entityType === 'report' && action === 'track_outcome') {
    if (!/^[1-9]\d*$/.test(entityId)) return false;
    return Number.isSafeInteger(Number(entityId));
  }
  return true;
};

const formatHref = (template: string, params: Record<string, unknown>): string =>
  template
    .replace('{code}', encodeURIComponent(String(params.code ?? '')))
    .replace('{entity_id}', encodeURIComponent(String(params.entity_id ?? '')));
