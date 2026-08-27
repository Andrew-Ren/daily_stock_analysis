import type { EntityAction, EntityActionType, EntityLink, EntityType } from '../types/entityLink';

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
  'stock:analyze': { href: '/' },
  'stock:watch': { href: '/' },
  'stock:monitor': { href: '/alerts' },
  'stock:ask_ai': { href: '/chat' },
  'stock:compare': { href: '/stocks/compare', available: false, disabledReason: 'compare_route_pending' },
  'index:view': { href: '/market', available: false, disabledReason: 'market_detail_route_pending' },
  'sector:view': { href: '/market', available: false, disabledReason: 'market_detail_route_pending' },
  'concept:view': { href: '/market', available: false, disabledReason: 'market_detail_route_pending' },
  'strategy:view': { href: '/screening' },
  'strategy:monitor': { href: '/alerts' },
  'report:view': { href: '/', available: false, disabledReason: 'report_detail_route_pending' },
  'report:monitor': { href: '/alerts' },
  'report:track_outcome': { href: '/decision-signals' },
  'signal:view': { href: '/decision-signals' },
  'signal:track_outcome': { href: '/decision-signals' },
  'alert:view': { href: '/alerts' },
  'alert:monitor': { href: '/alerts' },
  'portfolio_position:view': { href: '/portfolio' },
  'portfolio_position:analyze': { href: '/' },
  'portfolio_position:monitor': { href: '/alerts' },
  'portfolio_position:ask_ai': { href: '/chat' },
  'calendar_event:view': { href: '/calendar', available: false, disabledReason: 'calendar_route_pending' },
  'calendar_event:monitor': { href: '/alerts' },
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
  const normalizedId = String(entityId).trim();
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
  const route = ACTION_ROUTES[`${entityType}:${action}`] ?? {
    href: null,
    available: false,
    disabledReason: 'unsupported_action',
  };
  const params = buildActionParams(entityType, entityId, action);
  const href = route.href ? formatHref(route.href, params) : null;
  return {
    action,
    label: ACTION_LABELS[action],
    href,
    available: route.available ?? true,
    disabledReason: route.disabledReason ?? null,
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

const formatHref = (template: string, params: Record<string, unknown>): string =>
  template.replace('{code}', String(params.code ?? '')).replace('{entity_id}', String(params.entity_id ?? ''));
