# -*- coding: utf-8 -*-
"""Persistence helpers for the shared calendar event domain."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, delete, func, select

from src.storage import CalendarEventRecord, DatabaseManager


class CalendarEventRepository:
    """Store and query calendar events without page-specific aggregation."""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def create_event(self, fields: Dict[str, Any]) -> CalendarEventRecord:
        with self.db.get_session() as session:
            row = CalendarEventRecord(**fields)
            session.add(row)
            session.commit()
            session.refresh(row)
            return row

    def get_event(self, event_id: int) -> Optional[CalendarEventRecord]:
        with self.db.get_session() as session:
            return session.execute(
                select(CalendarEventRecord).where(CalendarEventRecord.id == event_id).limit(1)
            ).scalar_one_or_none()

    def delete_event(self, event_id: int) -> bool:
        with self.db.get_session() as session:
            result = session.execute(
                delete(CalendarEventRecord).where(CalendarEventRecord.id == event_id)
            )
            session.commit()
            return bool(result.rowcount)

    def list_events(
        self,
        *,
        start_date: date,
        end_date: date,
        scope_type: Optional[str] = None,
        scope_value: Optional[str] = None,
        market: Optional[str] = None,
        symbol: Optional[str] = None,
        page: int = 1,
        page_size: int = 100,
    ) -> Tuple[List[CalendarEventRecord], int]:
        conditions = [
            CalendarEventRecord.event_date >= start_date,
            CalendarEventRecord.event_date <= end_date,
        ]
        if scope_type:
            conditions.append(CalendarEventRecord.scope_type == scope_type)
        if scope_value:
            conditions.append(func.lower(CalendarEventRecord.scope_value) == scope_value.lower())
        if market:
            conditions.append(func.lower(CalendarEventRecord.market) == market.lower())
        if symbol:
            conditions.extend(
                [
                    CalendarEventRecord.scope_type == "symbol",
                    func.lower(CalendarEventRecord.symbol) == symbol.lower(),
                ]
            )
        where_clause = and_(*conditions)
        safe_page = max(1, int(page))
        safe_size = max(1, min(int(page_size), 100))
        offset = (safe_page - 1) * safe_size
        if offset > 2**63 - 1:
            raise ValueError("calendar event page offset exceeds database integer range")

        with self.db.get_session() as session:
            total = session.execute(
                select(func.count(CalendarEventRecord.id))
                .select_from(CalendarEventRecord)
                .where(where_clause)
            ).scalar() or 0
            rows = session.execute(
                select(CalendarEventRecord)
                .where(where_clause)
                .order_by(CalendarEventRecord.event_date, CalendarEventRecord.id)
                .offset(offset)
                .limit(safe_size)
            ).scalars().all()
            return list(rows), int(total)
