# -*- coding: utf-8 -*-
"""Helpers for stable cross-page entity links and actions."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Tuple
from urllib.parse import quote

from api.v1.schemas.entity_link import EntityActionType, EntityType
from src.services.stock_code_utils import resolve_daily_stock_identity


_ACTION_LABELS: Dict[str, str] = {
    "view": "View",
    "analyze": "Analyze",
    "watch": "Watch",
    "monitor": "Monitor",
    "ask_ai": "Ask AI",
    "compare": "Compare",
    "track_outcome": "Track Outcome",
}
_MAX_SAFE_REPORT_ID = "9007199254740991"


@dataclass(frozen=True)
class _RouteTemplate:
    href: Optional[str]
    available: bool = True
    disabled_reason: Optional[str] = None


_ACTION_ROUTES: Dict[Tuple[str, str], _RouteTemplate] = {
    ("stock", "view"): _RouteTemplate("/stocks/{code}", available=False, disabled_reason="stock_detail_route_pending"),
    ("stock", "analyze"): _RouteTemplate("/", available=False, disabled_reason="stock_action_context_pending"),
    ("stock", "watch"): _RouteTemplate("/", available=False, disabled_reason="stock_action_context_pending"),
    ("stock", "monitor"): _RouteTemplate("/alerts", available=False, disabled_reason="stock_action_context_pending"),
    ("stock", "ask_ai"): _RouteTemplate("/chat", available=False, disabled_reason="stock_action_context_pending"),
    ("stock", "compare"): _RouteTemplate("/stocks/compare", available=False, disabled_reason="compare_route_pending"),
    ("index", "view"): _RouteTemplate("/market", available=False, disabled_reason="market_detail_route_pending"),
    ("sector", "view"): _RouteTemplate("/market", available=False, disabled_reason="market_detail_route_pending"),
    ("concept", "view"): _RouteTemplate("/market", available=False, disabled_reason="market_detail_route_pending"),
    ("strategy", "view"): _RouteTemplate("/screening", available=False, disabled_reason="entity_action_context_pending"),
    ("strategy", "monitor"): _RouteTemplate("/alerts", available=False, disabled_reason="entity_action_context_pending"),
    ("report", "view"): _RouteTemplate("/", available=False, disabled_reason="report_detail_route_pending"),
    ("report", "monitor"): _RouteTemplate("/alerts", available=False, disabled_reason="entity_action_context_pending"),
    ("report", "track_outcome"): _RouteTemplate("/decision-signals?sourceReportId={entity_id}"),
    ("signal", "view"): _RouteTemplate("/decision-signals", available=False, disabled_reason="entity_action_context_pending"),
    ("signal", "track_outcome"): _RouteTemplate("/decision-signals", available=False, disabled_reason="entity_action_context_pending"),
    ("alert", "view"): _RouteTemplate("/alerts", available=False, disabled_reason="entity_action_context_pending"),
    ("alert", "monitor"): _RouteTemplate("/alerts", available=False, disabled_reason="entity_action_context_pending"),
    ("portfolio_position", "view"): _RouteTemplate("/portfolio", available=False, disabled_reason="entity_action_context_pending"),
    ("portfolio_position", "analyze"): _RouteTemplate("/", available=False, disabled_reason="entity_action_context_pending"),
    ("portfolio_position", "monitor"): _RouteTemplate("/alerts", available=False, disabled_reason="entity_action_context_pending"),
    ("portfolio_position", "ask_ai"): _RouteTemplate("/chat", available=False, disabled_reason="entity_action_context_pending"),
    ("calendar_event", "view"): _RouteTemplate("/calendar", available=False, disabled_reason="calendar_route_pending"),
    ("calendar_event", "monitor"): _RouteTemplate("/alerts", available=False, disabled_reason="entity_action_context_pending"),
}

_DEFAULT_ACTIONS: Dict[str, Tuple[str, ...]] = {
    "stock": ("view", "analyze", "watch", "monitor", "ask_ai", "compare"),
    "index": ("view", "monitor", "ask_ai"),
    "sector": ("view", "monitor", "ask_ai"),
    "concept": ("view", "monitor", "ask_ai"),
    "strategy": ("view", "monitor"),
    "report": ("view", "monitor", "track_outcome"),
    "signal": ("view", "track_outcome"),
    "alert": ("view", "monitor"),
    "portfolio_position": ("view", "analyze", "monitor", "ask_ai"),
    "calendar_event": ("view", "monitor"),
}


def make_entity_ref(entity_type: EntityType | str, entity_id: str) -> str:
    """Build a stable opaque entity ref."""
    normalized_type = str(entity_type).strip()
    normalized_id = str(entity_id).strip()
    if not normalized_type:
        raise ValueError("entity_type is required")
    if not normalized_id:
        raise ValueError("entity_id is required")
    normalized_id = _normalize_entity_id(normalized_type, normalized_id)
    return f"{normalized_type}:{normalized_id}"


def parse_entity_ref(ref: str) -> Tuple[str, str]:
    """Parse '<entity_type>:<entity_id>' into a tuple."""
    raw = str(ref or "").strip()
    if ":" not in raw:
        raise ValueError("entity ref must contain ':'")
    entity_type, entity_id = raw.split(":", 1)
    entity_type = entity_type.strip()
    entity_id = entity_id.strip()
    if not entity_type or not entity_id:
        raise ValueError("entity ref must include both type and id")
    return entity_type, entity_id


def stock_entity_id(stock_code: str, *, market: Optional[str] = None) -> str:
    """Build a stable stock entity id as '<MARKET>:<canonical_code>'."""
    raw_code = str(stock_code or "").strip()
    if not raw_code:
        raise ValueError("stock_code is required")
    explicit_market = str(market).strip().upper() if market is not None else None
    if explicit_market == "BSE":
        explicit_market = "CN"
    identity = resolve_daily_stock_identity(
        raw_code,
        market_hint=explicit_market.lower() if explicit_market else None,
    )
    if identity is None:
        us_code = raw_code.upper().removesuffix(".US")
        if (
            explicit_market in {None, "US"}
            and len(us_code) <= 7
            and re.fullmatch(r"[A-Z][A-Z0-9]*(?:\.[A-Z])?", us_code)
        ):
            return f"US:{us_code}"
        if explicit_market:
            raise ValueError("market is incompatible with stock_code identity")
        raise ValueError("unsupported stock_code identity")
    if not identity.refill_code:
        raise ValueError("stock_code identity has no canonical exchange-qualified code")
    inferred_market = identity.market.upper()
    normalized_market = explicit_market or inferred_market
    if inferred_market and market is not None and normalized_market != inferred_market:
        raise ValueError("market conflicts with stock_code identity")
    normalized_code = identity.refill_code
    if normalized_market == "HK" and normalized_code.isdigit() and 1 <= len(normalized_code) <= 5:
        normalized_code = f"HK{normalized_code.zfill(5)}"
    elif normalized_market in {"US", "JP", "KR", "TW"}:
        normalized_code = normalized_code.upper()
    if not normalized_code:
        raise ValueError("stock_code is required")
    return f"{normalized_market}:{normalized_code}"


def _normalize_entity_id(entity_type: str, entity_id: str) -> str:
    normalized_id = str(entity_id or "").strip()
    if entity_type != "stock":
        return normalized_id
    if ":" not in normalized_id:
        return stock_entity_id(normalized_id)
    market, stock_code = normalized_id.split(":", 1)
    return stock_entity_id(stock_code, market=market)


def build_stock_entity_link(
    stock_code: str,
    *,
    market: Optional[str] = None,
    label: str = "",
    stock_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Build an EntityLink payload for a stock-like symbol."""
    entity_id = stock_entity_id(stock_code, market=market)
    _, canonical_stock_code = _split_market_entity_id(entity_id)
    display_label = label or stock_name or stock_code
    return build_entity_link(
        "stock",
        entity_id,
        label=display_label,
        metadata={"stock_code": canonical_stock_code},
    )


def build_entity_link(
    entity_type: EntityType | str,
    entity_id: str,
    *,
    label: str = "",
    actions: Optional[Iterable[EntityActionType | str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build an EntityLink-compatible dict with default or explicit actions."""
    normalized_type = str(entity_type).strip()
    normalized_id = _normalize_entity_id(normalized_type, entity_id)
    selected_actions = tuple(actions) if actions is not None else _DEFAULT_ACTIONS.get(normalized_type, ("view",))
    action_items = [
        build_entity_action(normalized_type, normalized_id, str(action))
        for action in selected_actions
    ]
    links = {
        item["action"]: item["href"]
        for item in action_items
        if item.get("href") and item.get("available")
    }
    return {
        "entity_type": normalized_type,
        "entity_id": normalized_id,
        "ref": make_entity_ref(normalized_type, normalized_id),
        "label": label,
        "links": links,
        "actions": action_items,
        "metadata": dict(metadata or {}),
    }


def build_entity_action(entity_type: str, entity_id: str, action: str) -> Dict[str, Any]:
    """Build one action descriptor for an entity."""
    entity_id = _normalize_entity_id(entity_type, entity_id)
    route = _ACTION_ROUTES.get(
        (entity_type, action),
        _RouteTemplate(None, available=False, disabled_reason="unsupported_action"),
    )
    params = _action_params(entity_type, entity_id, action)
    href = _format_href(route.href, params) if route.href else None
    has_context = _has_consumable_context(entity_type, entity_id, action)
    available = route.available and has_context
    return {
        "action": action,
        "label": _ACTION_LABELS.get(action, action.replace("_", " ").title()),
        "href": href,
        "available": available,
        "disabled_reason": route.disabled_reason or (None if available else "invalid_entity_context"),
        "params": params,
    }


def _action_params(entity_type: str, entity_id: str, action: str) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "entity_type": entity_type,
        "entity_id": entity_id,
    }
    if entity_type == "stock":
        market, code = _split_market_entity_id(entity_id)
        params.update({"market": market.lower(), "code": code, "stock_code": code})
    if entity_type == "portfolio_position":
        parts = entity_id.split(":")
        if len(parts) >= 2:
            params.update({"account_id": parts[0], "symbol": parts[-1]})
    if action == "monitor":
        params["target_entity_ref"] = make_entity_ref(entity_type, entity_id)
    return params


def _split_market_entity_id(entity_id: str) -> Tuple[str, str]:
    if ":" not in entity_id:
        return "CN", entity_id
    market, code = entity_id.split(":", 1)
    return market or "CN", code


def _has_consumable_context(entity_type: str, entity_id: str, action: str) -> bool:
    if (entity_type, action) == ("report", "track_outcome"):
        if re.fullmatch(r"[1-9][0-9]*", entity_id) is None:
            return False
        return len(entity_id) < len(_MAX_SAFE_REPORT_ID) or (
            len(entity_id) == len(_MAX_SAFE_REPORT_ID)
            and entity_id <= _MAX_SAFE_REPORT_ID
        )
    return True


def _format_href(template: str, params: Dict[str, Any]) -> str:
    return template.format(
        code=quote(str(params.get("code", "")), safe=""),
        entity_id=quote(str(params.get("entity_id", "")), safe=""),
    )
