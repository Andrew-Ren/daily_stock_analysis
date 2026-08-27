export type EntityType =
  | 'stock'
  | 'index'
  | 'sector'
  | 'concept'
  | 'strategy'
  | 'report'
  | 'signal'
  | 'alert'
  | 'portfolio_position'
  | 'calendar_event';

export type EntityActionType =
  | 'view'
  | 'analyze'
  | 'watch'
  | 'monitor'
  | 'ask_ai'
  | 'compare'
  | 'track_outcome';

export interface EntityAction {
  action: EntityActionType;
  label: string;
  href?: string | null;
  available: boolean;
  disabledReason?: string | null;
  params: Record<string, unknown>;
}

export interface EntityLink {
  entityType: EntityType;
  entityId: string;
  ref: string;
  label: string;
  links: Partial<Record<EntityActionType, string>>;
  actions: EntityAction[];
  metadata: Record<string, unknown>;
}
