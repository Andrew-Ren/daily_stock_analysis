# -*- coding: utf-8 -*-
"""Build a read-only dashboard overview from persisted and cached state."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from src.config import Config, get_config
from src.repositories.portfolio_repo import PortfolioRepository
from src.schemas.market_light import MarketLightSnapshot
from src.services.alert_service import AlertService
from src.services.history_service import HistoryService
from src.services.task_queue import AnalysisTaskQueue, get_task_queue

_MARKET_REVIEW_TYPE = "market_review"
_DASHBOARD_HISTORY_SCAN_LIMIT = 10


class DashboardOverviewService:
    """Aggregate dashboard blocks without invoking analysis generation."""

    def __init__(
        self,
        *,
        history_service: Optional[HistoryService] = None,
        config: Optional[Config] = None,
        portfolio_repository: Optional[PortfolioRepository] = None,
        alert_service: Optional[AlertService] = None,
        task_queue: Optional[AnalysisTaskQueue] = None,
    ):
        self.history_service = history_service
        self.config = config
        self.portfolio_repository = portfolio_repository
        self.alert_service = alert_service
        self.task_queue = task_queue

    def get_overview(self) -> Dict[str, Any]:
        now = datetime.now().astimezone().isoformat()
        market, changed = self._market_and_changes()
        return {
            "as_of": now,
            "market": market,
            "personal": self._personal_block(),
            "activity": self._activity_block(),
            "system": {
                "meta": {
                    "quality": "fresh",
                    "sources": ["dashboard_runtime"],
                    "stale": False,
                    "limitations": [],
                },
                "data": {"refresh_starts_analysis": False, "generated_at": now},
            },
            "what_changed": changed,
        }

    def _market_and_changes(self) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        try:
            result = self._history().get_history_list(
                report_type=_MARKET_REVIEW_TYPE,
                page=1,
                limit=_DASHBOARD_HISTORY_SCAN_LIMIT,
            )
            reviews = list(result.get("items") or [])
            review_count = int(result.get("total") or 0)
        except Exception:
            market = {
                "meta": self._meta("unavailable", ["analysis_history"], ["market_review_query_failed"]),
                "data": {"review_count": 0, "latest_reviews": [], "latest_snapshots": {}},
            }
            return market, self._empty_changes("unavailable", "market_review_query_failed")

        snapshots_by_region: Dict[str, List[Dict[str, Any]]] = {}
        invalid_snapshot_count = 0
        detail_failure_count = 0
        for review in reviews:
            record_id = review.get("id")
            if record_id is None:
                continue
            try:
                detail = self._history().get_history_detail_by_id(int(record_id))
            except Exception:
                detail = None
            if not detail:
                detail_failure_count += 1
                continue
            raw_snapshots = self._extract_snapshots(detail.get("context_snapshot"))
            for region, raw_snapshot in raw_snapshots.items():
                if len(snapshots_by_region.get(region, [])) >= 2:
                    continue
                try:
                    snapshot = MarketLightSnapshot.model_validate(raw_snapshot).model_dump()
                except Exception:
                    invalid_snapshot_count += 1
                    continue
                snapshots_by_region.setdefault(region, []).append(snapshot)

        latest_snapshots = {
            region: snapshots[0]
            for region, snapshots in snapshots_by_region.items()
            if snapshots
        }
        limitations = []
        if review_count == 0:
            limitations.append("no_market_reviews")
        if review_count > 0 and not latest_snapshots:
            limitations.append("market_light_snapshot_unavailable")
        if detail_failure_count:
            limitations.append("market_review_detail_partial")
        if invalid_snapshot_count:
            limitations.append("invalid_market_light_snapshot_skipped")
        if any(snapshot.get("data_quality") != "ok" for snapshot in latest_snapshots.values()):
            limitations.append("market_light_data_partial")
        quality = "fresh" if latest_snapshots and not limitations else "partial"
        market = {
            "meta": self._meta(
                quality,
                ["analysis_history", "market_light_snapshots"],
                limitations,
            ),
            "data": {
                "review_count": review_count,
                "latest_reviews": reviews[:5],
                "latest_snapshots": latest_snapshots,
            },
        }
        return market, self._build_changes(snapshots_by_region)

    def _personal_block(self) -> Dict[str, Any]:
        data = {
            "watchlist_count": None,
            "cached_position_count": None,
            "active_monitor_count": None,
        }
        limitations: List[str] = []
        sources: List[str] = []
        success_count = 0

        try:
            data["watchlist_count"] = len(self._config().stock_list)
            sources.append("runtime_config")
            success_count += 1
        except Exception:
            limitations.append("watchlist_unavailable")

        try:
            data["cached_position_count"] = len(
                self._portfolio().list_cached_position_identities()
            )
            sources.append("portfolio_position_cache")
            limitations.append("cached_positions_only")
            success_count += 1
        except Exception:
            limitations.append("portfolio_relation_unavailable")

        try:
            result = self._alerts().list_rules(enabled=True, page=1, page_size=100)
            data["active_monitor_count"] = int(result.get("total") or 0)
            sources.append("alert_rules")
            success_count += 1
        except Exception:
            limitations.append("active_monitors_unavailable")

        quality = "unavailable" if success_count == 0 else "partial" if limitations else "fresh"
        return {"meta": self._meta(quality, sources, limitations), "data": data}

    def _activity_block(self) -> Dict[str, Any]:
        recent_reports: List[Dict[str, Any]] = []
        task_stats: Dict[str, int] = {}
        limitations: List[str] = []
        sources: List[str] = []
        success_count = 0
        try:
            result = self._history().get_history_list(page=1, limit=10)
            recent_reports = [
                item for item in list(result.get("items") or [])
                if item.get("report_type") != _MARKET_REVIEW_TYPE
            ][:5]
            sources.append("analysis_history")
            success_count += 1
        except Exception:
            limitations.append("recent_reports_unavailable")
        try:
            task_stats = {key: int(value) for key, value in self._tasks().get_task_stats().items()}
            sources.append("analysis_task_queue")
            success_count += 1
        except Exception:
            limitations.append("task_stats_unavailable")
        quality = "unavailable" if success_count == 0 else "partial" if limitations else "fresh"
        return {
            "meta": self._meta(quality, sources, limitations),
            "data": {"recent_reports": recent_reports, "task_stats": task_stats},
        }

    def _build_changes(self, snapshots_by_region: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
        items: List[Dict[str, Any]] = []
        current_dates: Dict[str, str] = {}
        previous_dates: Dict[str, str] = {}
        comparable_regions = 0
        limitations: List[str] = []
        for region, snapshots in snapshots_by_region.items():
            if snapshots:
                current_dates[region] = str(snapshots[0].get("trade_date") or "")
            if len(snapshots) < 2:
                continue
            current, previous = snapshots[0], snapshots[1]
            previous_dates[region] = str(previous.get("trade_date") or "")
            comparable_regions += 1
            quality = self._snapshot_quality(current)
            current_score = current.get("score")
            previous_score = previous.get("score")
            if current_score != previous_score:
                items.append({
                    "key": f"market.{region}.score",
                    "label": f"{region.upper()} Market Light score",
                    "before": previous_score,
                    "after": current_score,
                    "direction": "increased" if current_score > previous_score else "decreased",
                    "source": "persisted_market_review",
                    "quality": quality,
                })
            if current.get("status") != previous.get("status"):
                items.append({
                    "key": f"market.{region}.status",
                    "label": f"{region.upper()} Market Light status",
                    "before": previous.get("status"),
                    "after": current.get("status"),
                    "direction": "changed",
                    "source": "persisted_market_review",
                    "quality": quality,
                })
        if comparable_regions == 0:
            limitations.append("previous_completed_snapshot_unavailable")
        quality = "fresh" if comparable_regions and not limitations else "partial"
        return {
            "meta": self._meta(
                quality,
                ["persisted_market_review"],
                limitations,
            ),
            "data": {
                "comparison_mode": "previous_completed_snapshot",
                "current_trade_dates": current_dates,
                "previous_trade_dates": previous_dates,
                "items": items,
            },
        }

    @staticmethod
    def _extract_snapshots(context_snapshot: Any) -> Dict[str, Dict[str, Any]]:
        if not isinstance(context_snapshot, dict):
            return {}
        snapshots = context_snapshot.get("market_light_snapshots")
        if not isinstance(snapshots, dict):
            return {}
        return {
            str(region).strip().lower(): snapshot
            for region, snapshot in snapshots.items()
            if isinstance(snapshot, dict)
        }

    @staticmethod
    def _snapshot_quality(snapshot: Dict[str, Any]) -> str:
        quality = snapshot.get("data_quality")
        if quality == "ok":
            return "fresh"
        if quality == "unavailable":
            return "unavailable"
        return "partial"

    @staticmethod
    def _empty_changes(quality: str, limitation: str) -> Dict[str, Any]:
        return {
            "meta": DashboardOverviewService._meta(
                quality,
                ["persisted_market_review"],
                [limitation],
            ),
            "data": {
                "comparison_mode": "previous_completed_snapshot",
                "current_trade_dates": {},
                "previous_trade_dates": {},
                "items": [],
            },
        }

    @staticmethod
    def _meta(quality: str, sources: List[str], limitations: List[str]) -> Dict[str, Any]:
        return {
            "quality": quality,
            "sources": list(dict.fromkeys(sources)),
            "stale": None,
            "limitations": list(dict.fromkeys(limitations)),
        }

    def _history(self) -> HistoryService:
        if self.history_service is None:
            self.history_service = HistoryService()
        return self.history_service

    def _config(self) -> Config:
        if self.config is None:
            self.config = get_config()
        return self.config

    def _portfolio(self) -> PortfolioRepository:
        if self.portfolio_repository is None:
            self.portfolio_repository = PortfolioRepository()
        return self.portfolio_repository

    def _alerts(self) -> AlertService:
        if self.alert_service is None:
            self.alert_service = AlertService()
        return self.alert_service

    def _tasks(self) -> AnalysisTaskQueue:
        if self.task_queue is None:
            self.task_queue = get_task_queue()
        return self.task_queue
