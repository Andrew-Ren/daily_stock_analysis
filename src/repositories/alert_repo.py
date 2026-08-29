# -*- coding: utf-8 -*-
"""Alert repository.

Provides DB access helpers for alert-center P1 API tables.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, case, delete, desc, func, select

from src.storage import (
    AlertCooldownRecord,
    AlertNotificationRecord,
    AlertRuleRecord,
    AlertTriggerRecord,
    DatabaseManager,
)


class AlertRepository:
    """DB access layer for alert rules and read-only alert history."""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def create_rule(self, fields: Dict[str, Any]) -> AlertRuleRecord:
        with self.db.get_session() as session:
            row = AlertRuleRecord(**fields)
            session.add(row)
            session.commit()
            session.refresh(row)
            return row

    def get_rule(self, rule_id: int) -> Optional[AlertRuleRecord]:
        with self.db.get_session() as session:
            return session.execute(
                select(AlertRuleRecord).where(AlertRuleRecord.id == rule_id).limit(1)
            ).scalar_one_or_none()

    def update_rule(self, rule_id: int, fields: Dict[str, Any]) -> Optional[AlertRuleRecord]:
        with self.db.get_session() as session:
            row = session.execute(
                select(AlertRuleRecord).where(AlertRuleRecord.id == rule_id).limit(1)
            ).scalar_one_or_none()
            if row is None:
                return None
            for key, value in fields.items():
                setattr(row, key, value)
            row.updated_at = datetime.now()
            session.commit()
            session.refresh(row)
            return row

    def delete_rule(self, rule_id: int) -> bool:
        with self.db.get_session() as session:
            result = session.execute(delete(AlertRuleRecord).where(AlertRuleRecord.id == rule_id))
            session.commit()
            return bool(result.rowcount)

    def list_rules(
        self,
        *,
        enabled: Optional[bool] = None,
        alert_type: Optional[str] = None,
        target_scope: Optional[str] = None,
        target: Optional[str] = None,
        source: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[AlertRuleRecord], int]:
        conditions = []
        if enabled is not None:
            conditions.append(AlertRuleRecord.enabled.is_(enabled))
        if alert_type:
            conditions.append(AlertRuleRecord.alert_type == alert_type)
        if target_scope:
            conditions.append(AlertRuleRecord.target_scope == target_scope)
        if target:
            conditions.append(AlertRuleRecord.target == target)
        if source:
            conditions.append(AlertRuleRecord.source == source)

        where_clause = and_(*conditions) if conditions else True
        offset = (page - 1) * page_size
        with self.db.get_session() as session:
            total = session.execute(
                select(func.count(AlertRuleRecord.id)).select_from(AlertRuleRecord).where(where_clause)
            ).scalar() or 0
            rows = session.execute(
                select(AlertRuleRecord)
                .where(where_clause)
                .order_by(desc(AlertRuleRecord.updated_at), desc(AlertRuleRecord.id))
                .offset(offset)
                .limit(page_size)
            ).scalars().all()
            return list(rows), int(total)

    def list_enabled_rules(self, *, limit: int = 1000) -> List[AlertRuleRecord]:
        safe_limit = max(1, min(int(limit), 1000))
        with self.db.get_session() as session:
            rows = session.execute(
                select(AlertRuleRecord)
                .where(AlertRuleRecord.enabled.is_(True))
                .order_by(desc(AlertRuleRecord.updated_at), desc(AlertRuleRecord.id))
                .limit(safe_limit)
            ).scalars().all()
            return list(rows)

    def create_trigger(self, fields: Dict[str, Any]) -> AlertTriggerRecord:
        self._validate_trigger_fields(fields)

        with self.db.get_session() as session:
            row = AlertTriggerRecord(**fields)
            session.add(row)
            session.commit()
            session.refresh(row)
            return row

    def create_trigger_if_absent(self, fields: Dict[str, Any]) -> Tuple[AlertTriggerRecord, bool]:
        """Create a triggered history row unless the same DB signal already exists.

        Callers must use this only after they have decided the trigger is safe to
        deduplicate. Non-triggered or timestamp-less history should use
        ``create_trigger`` so audit rows are not silently reclassified as deduped.
        """
        self._validate_trigger_fields(fields)

        rule_id = fields.get("rule_id")
        data_timestamp = fields.get("data_timestamp")
        if fields.get("status") != "triggered" or rule_id is None or data_timestamp is None:
            raise ValueError(
                "create_trigger_if_absent requires triggered status, rule_id, and data_timestamp"
            )

        with self.db.get_session() as session:
            query = select(AlertTriggerRecord).where(
                AlertTriggerRecord.rule_id == rule_id,
                AlertTriggerRecord.target == fields.get("target"),
                AlertTriggerRecord.status == "triggered",
                AlertTriggerRecord.data_timestamp == data_timestamp,
            )
            data_source = fields.get("data_source")
            if data_source is None:
                query = query.where(AlertTriggerRecord.data_source.is_(None))
            else:
                query = query.where(AlertTriggerRecord.data_source == data_source)

            existing = session.execute(
                query.order_by(AlertTriggerRecord.id.asc()).limit(1)
            ).scalar_one_or_none()
            if existing is not None:
                return existing, False

            row = AlertTriggerRecord(**fields)
            session.add(row)
            session.commit()
            session.refresh(row)
            return row, True

    @staticmethod
    def _validate_trigger_fields(fields: Dict[str, Any]) -> None:
        if not fields.get("target"):
            raise ValueError("alert trigger target is required")
        if not fields.get("status"):
            raise ValueError("alert trigger status is required")

    def record_notification_attempt(self, fields: Dict[str, Any]) -> AlertNotificationRecord:
        if not fields.get("channel"):
            raise ValueError("alert notification channel is required")

        with self.db.get_session() as session:
            row = AlertNotificationRecord(**fields)
            session.add(row)
            session.commit()
            session.refresh(row)
            return row

    def get_active_cooldown(
        self,
        *,
        rule_id: int,
        target: str,
        severity: Optional[str],
        now: Optional[datetime] = None,
    ) -> Optional[AlertCooldownRecord]:
        now_value = now or datetime.now()
        with self.db.get_session() as session:
            return session.execute(
                select(AlertCooldownRecord)
                .where(
                    AlertCooldownRecord.rule_id == rule_id,
                    AlertCooldownRecord.target == target,
                    AlertCooldownRecord.severity == severity,
                    AlertCooldownRecord.state == "active",
                    AlertCooldownRecord.cooldown_until > now_value,
                )
                .order_by(desc(AlertCooldownRecord.cooldown_until), desc(AlertCooldownRecord.id))
                .limit(1)
            ).scalar_one_or_none()

    def upsert_cooldown(
        self,
        *,
        rule_id: int,
        rule_key: Optional[str],
        target: str,
        severity: Optional[str],
        last_triggered_at: datetime,
        cooldown_until: datetime,
        reason: Optional[str] = None,
        state: str = "active",
    ) -> AlertCooldownRecord:
        with self.db.get_session() as session:
            row = session.execute(
                select(AlertCooldownRecord)
                .where(
                    AlertCooldownRecord.rule_id == rule_id,
                    AlertCooldownRecord.target == target,
                    AlertCooldownRecord.severity == severity,
                )
                .limit(1)
            ).scalar_one_or_none()
            if row is None:
                row = AlertCooldownRecord(
                    rule_id=rule_id,
                    rule_key=rule_key,
                    target=target,
                    severity=severity,
                )
                session.add(row)
            row.rule_key = rule_key
            row.last_triggered_at = last_triggered_at
            row.cooldown_until = cooldown_until
            row.reason = reason
            row.state = state
            row.updated_at = datetime.now()
            session.commit()
            session.refresh(row)
            return row

    def get_rule_cooldown_summary(
        self,
        *,
        rule_id: int,
        target: str,
        severity: Optional[str],
    ) -> Optional[AlertCooldownRecord]:
        with self.db.get_session() as session:
            return session.execute(
                select(AlertCooldownRecord)
                .where(
                    AlertCooldownRecord.rule_id == rule_id,
                    AlertCooldownRecord.target == target,
                    AlertCooldownRecord.severity == severity,
                )
                .order_by(desc(AlertCooldownRecord.updated_at), desc(AlertCooldownRecord.id))
                .limit(1)
            ).scalar_one_or_none()

    def list_triggers(
        self,
        *,
        rule_id: Optional[int] = None,
        target: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[AlertTriggerRecord], int]:
        conditions = []
        if rule_id is not None:
            conditions.append(AlertTriggerRecord.rule_id == rule_id)
        if target:
            conditions.append(AlertTriggerRecord.target == target)
        if status:
            conditions.append(AlertTriggerRecord.status == status)

        where_clause = and_(*conditions) if conditions else True
        offset = (page - 1) * page_size
        with self.db.get_session() as session:
            total = session.execute(
                select(func.count(AlertTriggerRecord.id)).select_from(AlertTriggerRecord).where(where_clause)
            ).scalar() or 0
            rows = session.execute(
                select(AlertTriggerRecord)
                .where(where_clause)
                .order_by(desc(AlertTriggerRecord.triggered_at), desc(AlertTriggerRecord.id))
                .offset(offset)
                .limit(page_size)
            ).scalars().all()
            return list(rows), int(total)

    def get_monitor_summary(self, *, rule_limit: int = 20) -> Dict[str, Any]:
        """Aggregate the whole monitor dataset independently of list pagination."""
        safe_limit = max(1, min(int(rule_limit), 100))
        with self.db.get_session() as session:
            rules_total = session.execute(
                select(func.count(AlertRuleRecord.id)).select_from(AlertRuleRecord)
            ).scalar() or 0
            enabled_rules_total = session.execute(
                select(func.count(AlertRuleRecord.id))
                .select_from(AlertRuleRecord)
                .where(AlertRuleRecord.enabled.is_(True))
            ).scalar() or 0
            triggers_total = session.execute(
                select(func.count(AlertTriggerRecord.id)).select_from(AlertTriggerRecord)
            ).scalar() or 0

            rule_type_rows = session.execute(
                select(
                    AlertRuleRecord.alert_type,
                    func.count(AlertRuleRecord.id),
                    func.sum(case((AlertRuleRecord.enabled.is_(True), 1), else_=0)),
                )
                .group_by(AlertRuleRecord.alert_type)
                .order_by(desc(func.count(AlertRuleRecord.id)), AlertRuleRecord.alert_type)
            ).all()
            trigger_status_rows = session.execute(
                select(AlertTriggerRecord.status, func.count(AlertTriggerRecord.id))
                .group_by(AlertTriggerRecord.status)
                .order_by(desc(func.count(AlertTriggerRecord.id)), AlertTriggerRecord.status)
            ).all()

            unattributed_trigger_count = session.execute(
                select(func.count(AlertTriggerRecord.id))
                .select_from(AlertTriggerRecord)
                .where(AlertTriggerRecord.rule_id.is_(None))
            ).scalar() or 0
            orphaned_trigger_count = session.execute(
                select(func.count(AlertTriggerRecord.id))
                .select_from(AlertTriggerRecord)
                .outerjoin(AlertRuleRecord, AlertRuleRecord.id == AlertTriggerRecord.rule_id)
                .where(AlertTriggerRecord.rule_id.is_not(None), AlertRuleRecord.id.is_(None))
            ).scalar() or 0

            trigger_count = func.count(AlertTriggerRecord.id).label("trigger_count")
            last_triggered_at = func.max(AlertTriggerRecord.triggered_at).label("last_triggered_at")
            rule_rows = session.execute(
                select(
                    AlertRuleRecord.id,
                    AlertRuleRecord.name,
                    AlertRuleRecord.alert_type,
                    AlertRuleRecord.severity,
                    AlertRuleRecord.enabled,
                    trigger_count,
                    last_triggered_at,
                )
                .outerjoin(AlertTriggerRecord, AlertTriggerRecord.rule_id == AlertRuleRecord.id)
                .group_by(
                    AlertRuleRecord.id,
                    AlertRuleRecord.name,
                    AlertRuleRecord.alert_type,
                    AlertRuleRecord.severity,
                    AlertRuleRecord.enabled,
                )
                .order_by(desc(trigger_count), desc(last_triggered_at), AlertRuleRecord.id)
                .limit(safe_limit)
            ).all()

        return {
            "rules_total": int(rules_total),
            "enabled_rules_total": int(enabled_rules_total),
            "triggers_total": int(triggers_total),
            "unattributed_trigger_count": int(unattributed_trigger_count),
            "orphaned_trigger_count": int(orphaned_trigger_count),
            "rule_types": [
                {
                    "alert_type": str(alert_type),
                    "rule_count": int(count or 0),
                    "enabled_count": int(enabled_count or 0),
                }
                for alert_type, count, enabled_count in rule_type_rows
            ],
            "trigger_statuses": [
                {"status": str(status), "trigger_count": int(count or 0)}
                for status, count in trigger_status_rows
            ],
            "rules": [
                {
                    "rule_id": int(rule_id),
                    "name": str(name or ""),
                    "alert_type": str(alert_type or ""),
                    "severity": str(severity or ""),
                    "enabled": bool(enabled),
                    "trigger_count": int(count or 0),
                    "last_triggered_at": last_seen.isoformat() if last_seen else None,
                }
                for rule_id, name, alert_type, severity, enabled, count, last_seen in rule_rows
            ],
        }

    def list_notifications(
        self,
        *,
        trigger_id: Optional[int] = None,
        channel: Optional[str] = None,
        success: Optional[bool] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[AlertNotificationRecord], int]:
        conditions = []
        if trigger_id is not None:
            conditions.append(AlertNotificationRecord.trigger_id == trigger_id)
        if channel:
            conditions.append(AlertNotificationRecord.channel == channel)
        if success is not None:
            conditions.append(AlertNotificationRecord.success.is_(success))

        where_clause = and_(*conditions) if conditions else True
        offset = (page - 1) * page_size
        with self.db.get_session() as session:
            total = session.execute(
                select(func.count(AlertNotificationRecord.id))
                .select_from(AlertNotificationRecord)
                .where(where_clause)
            ).scalar() or 0
            rows = session.execute(
                select(AlertNotificationRecord)
                .where(where_clause)
                .order_by(desc(AlertNotificationRecord.created_at), desc(AlertNotificationRecord.id))
                .offset(offset)
                .limit(page_size)
            ).scalars().all()
            return list(rows), int(total)
