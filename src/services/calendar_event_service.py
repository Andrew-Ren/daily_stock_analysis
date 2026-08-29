# -*- coding: utf-8 -*-
"""Validation and serialization for shared calendar events."""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Dict, Optional

from data_provider.base import canonical_stock_code
from src.repositories.calendar_event_repo import CalendarEventRepository
from src.services.stock_code_utils import resolve_daily_stock_identity

_ALLOWED_EVENT_TYPES = {"earnings", "dividend", "lockup_unlock", "macro", "user", "monitor"}
_ALLOWED_SCOPE_TYPES = {"market", "symbol", "portfolio", "sector", "custom"}
_ALLOWED_MARKETS = {"cn", "hk", "us", "jp", "kr", "tw", "global"}
CALENDAR_EVENT_MAX_PAGE = 1_000_000


class CalendarEventServiceError(ValueError):
    """User-facing calendar event validation error."""


class CalendarEventService:
    """Expose one event contract for dashboard and symbol consumers."""

    def __init__(self, repository: Optional[CalendarEventRepository] = None):
        self.repo = repository or CalendarEventRepository()

    def create_user_event(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        fields = self._normalize_create_payload(payload)
        return self._event_to_dict(self.repo.create_event(fields))

    def list_events(self, **filters: Any) -> Dict[str, Any]:
        start_date = filters.get("start_date") or date.today()
        end_date = filters.get("end_date")
        if end_date is None:
            remaining_days = (date.max - start_date).days
            end_date = start_date + timedelta(days=min(6, remaining_days))
        if end_date < start_date:
            raise CalendarEventServiceError("end_date must be on or after start_date")

        scope_type = self._optional_normalized(filters.get("scope_type"))
        scope_value = self._optional_normalized(filters.get("scope_value"))
        market = self._optional_normalized(filters.get("market"), lower=True)
        symbol, symbol_market = self._resolve_symbol_identity(
            filters.get("symbol"),
            market_hint=market,
        )
        if scope_type and scope_type not in _ALLOWED_SCOPE_TYPES:
            raise CalendarEventServiceError(f"unsupported scope_type: {scope_type}")
        if market and market not in _ALLOWED_MARKETS:
            raise CalendarEventServiceError(f"unsupported market: {market}")
        if market and symbol_market and market != symbol_market:
            raise CalendarEventServiceError("market conflicts with symbol identity")
        if symbol and scope_type and scope_type != "symbol":
            raise CalendarEventServiceError("symbol filter can only be combined with scope_type=symbol")
        if scope_type == "symbol" and scope_value:
            scope_value, scope_market = self._resolve_symbol_identity(
                scope_value,
                market_hint=market,
            )
            if market and scope_market and market != scope_market:
                raise CalendarEventServiceError("market conflicts with symbol identity")
            if symbol and scope_value != symbol:
                raise CalendarEventServiceError("scope_value conflicts with symbol identity")

        page = max(1, int(filters.get("page") or 1))
        if page > CALENDAR_EVENT_MAX_PAGE:
            raise CalendarEventServiceError(
                f"page must be less than or equal to {CALENDAR_EVENT_MAX_PAGE}"
            )
        page_size = max(1, min(int(filters.get("page_size") or 100), 100))
        rows, total = self.repo.list_events(
            start_date=start_date,
            end_date=end_date,
            scope_type=scope_type,
            scope_value=scope_value,
            market=market,
            symbol=symbol,
            page=page,
            page_size=page_size,
        )
        return {
            "items": [self._event_to_dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "coverage": {
                "status": "manual_only",
                "external_sources_configured": False,
                "message": (
                    "External calendar coverage is not configured; results include only "
                    "persisted user events."
                ),
            },
        }

    def delete_user_event(self, event_id: int) -> bool:
        row = self.repo.get_event(event_id)
        if row is None:
            return False
        if row.source != "user":
            raise CalendarEventServiceError("only user-created calendar events can be deleted")
        return self.repo.delete_event(event_id)

    @staticmethod
    def _normalize_create_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
        title = str(payload.get("title") or "").strip()
        event_type = str(payload.get("event_type") or "").strip().lower()
        scope_type = str(payload.get("scope_type") or "").strip().lower()
        scope_value = CalendarEventService._optional_normalized(payload.get("scope_value"))
        market = CalendarEventService._optional_normalized(payload.get("market"), lower=True)
        symbol, symbol_market = CalendarEventService._resolve_symbol_identity(
            payload.get("symbol"),
            market_hint=market,
        )

        if not title:
            raise CalendarEventServiceError("title is required")
        if event_type not in _ALLOWED_EVENT_TYPES:
            raise CalendarEventServiceError(f"unsupported event_type: {event_type}")
        if scope_type not in _ALLOWED_SCOPE_TYPES:
            raise CalendarEventServiceError(f"unsupported scope_type: {scope_type}")
        if market and market not in _ALLOWED_MARKETS:
            raise CalendarEventServiceError(f"unsupported market: {market}")

        if scope_type == "market":
            if not market:
                raise CalendarEventServiceError("market scope requires market")
            scope_value = market
            symbol = None
        elif scope_type == "symbol":
            if not symbol:
                raise CalendarEventServiceError("symbol scope requires symbol")
            if market and market != symbol_market:
                raise CalendarEventServiceError("market conflicts with symbol identity")
            market = symbol_market
            scope_value = symbol
        elif not scope_value:
            raise CalendarEventServiceError(f"{scope_type} scope requires scope_value")

        metadata = payload.get("metadata") or {}
        if not isinstance(metadata, dict):
            raise CalendarEventServiceError("metadata must be a JSON object")
        try:
            metadata_json = json.dumps(
                metadata,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            )
        except (TypeError, ValueError) as exc:
            raise CalendarEventServiceError("metadata must contain finite JSON values") from exc
        return {
            "title": title,
            "event_type": event_type,
            "scope_type": scope_type,
            "scope_value": scope_value,
            "market": market,
            "symbol": symbol,
            "event_date": payload["event_date"],
            "source": "user",
            "coverage_status": "confirmed",
            "description": CalendarEventService._optional_normalized(payload.get("description")),
            "payload": metadata_json,
        }

    @staticmethod
    def _optional_normalized(value: Any, *, lower: bool = False) -> Optional[str]:
        normalized = str(value or "").strip()
        if not normalized:
            return None
        return normalized.lower() if lower else normalized

    @staticmethod
    def _resolve_symbol_identity(
        value: Any,
        *,
        market_hint: Optional[str] = None,
    ) -> tuple[Optional[str], Optional[str]]:
        normalized = CalendarEventService._optional_normalized(value)
        if normalized is None:
            return None, None
        identity = resolve_daily_stock_identity(normalized, market_hint=market_hint)
        if identity is None or identity.market not in _ALLOWED_MARKETS - {"global"}:
            raise CalendarEventServiceError("unsupported symbol identity")
        code = canonical_stock_code(identity.refill_code or identity.normalized_code)
        return code, identity.market

    @staticmethod
    def _event_to_dict(row: Any) -> Dict[str, Any]:
        try:
            metadata = json.loads(row.payload or "{}")
        except (TypeError, ValueError):
            metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        try:
            json.dumps(metadata, allow_nan=False)
        except (TypeError, ValueError):
            metadata = {}
        return {
            "id": int(row.id),
            "title": str(row.title),
            "event_type": str(row.event_type),
            "scope_type": str(row.scope_type),
            "scope_value": row.scope_value,
            "market": row.market,
            "symbol": row.symbol,
            "event_date": row.event_date.isoformat(),
            "source": str(row.source),
            "coverage_status": str(row.coverage_status),
            "description": row.description,
            "metadata": metadata,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
