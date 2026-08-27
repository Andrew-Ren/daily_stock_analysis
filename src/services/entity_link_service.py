# -*- coding: utf-8 -*-
"""Helpers for stable cross-page entity links and actions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Tuple

from api.v1.schemas.entity_link import EntityActionType, EntityType
from data_provider.base import normalize_stock_code


_ACTION_LABELS: Dict[str, str] = {
    "view": "View",
    "analyze": "Analyze",
    "watch": "Watch",
    "monitor": "Monitor",
    "ask_ai": "Ask AI",
    "compare": "Compare",
    "track_outcome": "Track Outcome",
}


@dataclass(frozen=True)
class _RouteTemplate:
    href: Optional[str]
    available: bool = True
    disabled_reason: Optional[str] = None


_ACTION_ROUTES: Dict[Tuple[str, str], _RouteTemplate] = {
    ("stock", "view"): _RouteTemplate("/stocks/{code}", available=False, disabled_reason="stock_detail_route_pending"),
    ("stock", "analyze"): _RouteTemplate("/"),
    ("stock", "watch"): _RouteTemplate("/"),
    ("stock", "monitor"): _RouteTemplate("/alerts"),
    ("stock", "ask_ai"): _RouteTemplate("/chat"),
    ("stock", "compare"): _RouteTemplate("/stocks/compare", available=False, disabled_reason="compare_route_pending"),
    ("index", "view"): _RouteTemplate("/market", available=False, disabled_reason="market_detail_route_pending"),
    ("sector", "view"): _RouteTemplate("/market", available=False, disabled_reason="market_detail_route_pending"),
    ("concept", "view"): _RouteTemplate("/market", available=False, disabled_reason="market_detail_route_pending"),
    ("strategy", "view"): _RouteTemplate("/screening"),
    ("strategy", "monitor"): _RouteTemplate("/alerts"),
    ("report", "view"): _RouteTemplate("/", available=False, disabled_reason="report_detail_route_pending"),
    ("report", "monitor"): _RouteTemplate("/alerts"),
    ("report", "track_outcome"): _RouteTemplate("/decision-signals"),
    ("signal", "view"): _RouteTemplate("/decision-signals"),
    ("signal", "track_outcome"): _RouteTemplate("/decision-signals"),
    ("alert", "view"): _RouteTemplate("/alerts"),
    ("alert", "monitor"): _RouteTemplate("/alerts"),
    ("portfolio_position", "view"): _RouteTemplate("/portfolio"),
    ("portfolio_position", "analyze"): _RouteTemplate("/"),
    ("portfolio_position", "monitor"): _RouteTemplate("/alerts"),
    ("portfolio_position", "ask_ai"): _RouteTemplate("/chat"),
    ("calendar_event", "view"): _RouteTemplate("/calendar", available=False, disabled_reason="calendar_route_pending"),
    ("calendar_event", "monitor"): _RouteTemplate("/alerts"),
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


def stock_entity_id(stock_code: str, *, market: str = "cn") -> str:
    """Build a stable stock entity id as '<MARKET>:<canonical_code>'."""
    normalized_market = str(market or "cn").strip().upper()
    normalized_code = normalize_stock_code(str(stock_code or "").strip())
    if normalized_market == "HK" and normalized_code.isdigit() and 1 <= len(normalized_code) <= 5:
        normalized_code = f"HK{normalized_code.zfill(5)}"
    elif normalized_market in {"US", "JP", "KR", "TW"}:
        normalized_code = normalized_code.upper()
    if not normalized_code:
        raise ValueError("stock_code is required")
    return f"{normalized_market}:{normalized_code}"


def build_stock_entity_link(
    stock_code: str,
    *,
    market: str = "cn",
    label: str = "",
    stock_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Build an EntityLink payload for a stock-like symbol."""
    entity_id = stock_entity_id(stock_code, market=market)
    display_label = label or stock_name or stock_code
    return build_entity_link(
        "stock",
        entity_id,
        label=display_label,
        metadata={"stock_code": normalize_stock_code(stock_code)},
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
    normalized_id = str(entity_id).strip()
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
    route = _ACTION_ROUTES.get(
        (entity_type, action),
        _RouteTemplate(None, available=False, disabled_reason="unsupported_action"),
    )
    params = _action_params(entity_type, entity_id, action)
    href = _format_href(route.href, params) if route.href else None
    return {
        "action": action,
        "label": _ACTION_LABELS.get(action, action.replace("_", " ").title()),
        "href": href,
        "available": route.available,
        "disabled_reason": route.disabled_reason,
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


def _format_href(template: str, params: Dict[str, Any]) -> str:
    return template.format(
        code=params.get("code", ""),
        entity_id=str(params.get("entity_id", "")),
    )
