# -*- coding: utf-8 -*-
"""Build a read-only dashboard overview from persisted and cached state."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from src.config import Config, get_config
from src.repositories.portfolio_repo import PortfolioRepository
from src.schemas.market_light import MarketLightSnapshot
from src.services.alert_service import AlertService
from src.services.history_service import HistoryService
from src.services.task_queue import AnalysisTaskQueue, get_task_queue

_MARKET_REVIEW_TYPE = "market_review"
_DASHBOARD_HISTORY_PAGE_SIZE = 50
_DASHBOARD_MARKET_REVIEW_SCAN_LIMIT = 100
_DASHBOARD_RECENT_REPORT_SCAN_LIMIT = 100


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
        snapshot_candidates_by_region: Dict[
            str,
            Dict[str, Optional[Dict[str, Any]]],
        ] = {}
        regions_with_unknown_trade_date: Set[str] = set()
        latest_reviews: List[Dict[str, Any]] = []
        invalid_snapshot_count = 0
        detail_failure_count = 0
        history_scan_incomplete = False
        review_count = 0
        scanned_count = 0
        page = 1
        try:
            while True:
                result = self._history().get_history_list(
                    stock_code="MARKET",
                    report_type=_MARKET_REVIEW_TYPE,
                    page=page,
                    limit=_DASHBOARD_MARKET_REVIEW_SCAN_LIMIT,
                    include_context_snapshot=True,
                )
                reviews = list(result.get("items") or [])
                if page == 1:
                    review_count = int(result.get("total") or 0)
                if len(latest_reviews) < 5:
                    latest_reviews.extend(reviews[: 5 - len(latest_reviews)])
                for review in reviews:
                    context_snapshot = review.get("context_snapshot")
                    if not isinstance(context_snapshot, dict):
                        detail_failure_count += 1
                        continue
                    snapshot_container = context_snapshot.get("market_light_snapshots")
                    if snapshot_container is not None and not isinstance(snapshot_container, dict):
                        detail_failure_count += 1
                        continue
                    for raw_region, raw_snapshot in (snapshot_container or {}).items():
                        region = str(raw_region).strip().lower()
                        if region and not isinstance(raw_snapshot, dict):
                            invalid_snapshot_count += 1
                            regions_with_unknown_trade_date.add(region)
                    raw_snapshots = self._extract_snapshots(context_snapshot)
                    for region, raw_snapshot in raw_snapshots.items():
                        raw_trade_date = str(raw_snapshot.get("trade_date") or "").strip()
                        try:
                            canonical_trade_date = date.fromisoformat(raw_trade_date).isoformat()
                        except Exception:
                            invalid_snapshot_count += 1
                            regions_with_unknown_trade_date.add(region)
                            continue
                        try:
                            snapshot = MarketLightSnapshot.model_validate(raw_snapshot).model_dump()
                        except Exception:
                            invalid_snapshot_count += 1
                            snapshot_candidates_by_region.setdefault(region, {}).setdefault(
                                canonical_trade_date,
                                None,
                            )
                            continue
                        snapshot_region = str(snapshot.get("region") or "").strip().lower()
                        region_candidates = snapshot_candidates_by_region.setdefault(region, {})
                        if snapshot_region != region:
                            invalid_snapshot_count += 1
                            region_candidates.setdefault(canonical_trade_date, None)
                            continue
                        snapshot["trade_date"] = canonical_trade_date
                        if region_candidates.get(canonical_trade_date) is None:
                            region_candidates[canonical_trade_date] = snapshot
                scanned_count += len(reviews)
                if scanned_count >= review_count:
                    break
                if scanned_count >= _DASHBOARD_MARKET_REVIEW_SCAN_LIMIT:
                    history_scan_incomplete = True
                    break
                if not reviews:
                    history_scan_incomplete = True
                    break
                page += 1
        except Exception:
            if page == 1:
                market = {
                    "meta": self._meta("unavailable", ["analysis_history"], ["market_review_query_failed"]),
                    "data": {"review_count": 0, "latest_reviews": [], "latest_snapshots": {}},
                }
                return market, self._empty_changes("unavailable", "market_review_query_failed")
            history_scan_incomplete = True

        snapshots_by_region: Dict[str, List[Dict[str, Any]]] = {}
        unavailable_current_regions: List[str] = []
        for region, candidates in snapshot_candidates_by_region.items():
            ordered_dates = sorted(candidates, reverse=True)
            if detail_failure_count or region in regions_with_unknown_trade_date:
                unavailable_current_regions.append(region)
                continue
            current = candidates[ordered_dates[0]] if ordered_dates else None
            if current is None:
                unavailable_current_regions.append(region)
                continue
            selected = [current]
            if len(ordered_dates) > 1:
                previous = candidates[ordered_dates[1]]
                if previous is not None:
                    selected.append(previous)
            snapshots_by_region[region] = selected

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
        if unavailable_current_regions:
            limitations.append("latest_completed_snapshot_unavailable")
            limitations.extend(
                f"latest_completed_snapshot_unavailable:{region}"
                for region in sorted(unavailable_current_regions)
            )
        if history_scan_incomplete:
            limitations.append("market_review_history_scan_incomplete")
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
                "latest_reviews": latest_reviews,
                "latest_snapshots": latest_snapshots,
            },
        }
        return market, self._build_changes(
            snapshots_by_region,
            source_limitations=limitations,
        )

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
            page = 1
            scanned_count = 0
            total = 0
            while len(recent_reports) < 5:
                result = self._history().get_history_list(
                    page=page,
                    limit=_DASHBOARD_HISTORY_PAGE_SIZE,
                )
                history_items = list(result.get("items") or [])
                if page == 1:
                    total = int(result.get("total") or 0)
                recent_reports.extend(
                    item for item in history_items
                    if item.get("report_type") != _MARKET_REVIEW_TYPE
                )
                scanned_count += len(history_items)
                if len(recent_reports) >= 5 or scanned_count >= total:
                    break
                if scanned_count >= _DASHBOARD_RECENT_REPORT_SCAN_LIMIT:
                    limitations.append("recent_reports_history_scan_incomplete")
                    break
                if not history_items:
                    limitations.append("recent_reports_history_scan_incomplete")
                    break
                page += 1
            recent_reports = recent_reports[:5]
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

    def _build_changes(
        self,
        snapshots_by_region: Dict[str, List[Dict[str, Any]]],
        *,
        source_limitations: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        items: List[Dict[str, Any]] = []
        current_dates: Dict[str, str] = {}
        previous_dates: Dict[str, str] = {}
        comparable_regions = 0
        missing_baseline_regions: List[str] = []
        limitations: List[str] = list(source_limitations or [])
        for region, snapshots in snapshots_by_region.items():
            if snapshots:
                current_dates[region] = str(snapshots[0].get("trade_date") or "")
            if len(snapshots) < 2:
                missing_baseline_regions.append(region)
                continue
            current, previous = snapshots[0], snapshots[1]
            previous_dates[region] = str(previous.get("trade_date") or "")
            quality = self._comparison_quality(current, previous)
            if quality == "unavailable":
                limitations.append(f"comparison_snapshot_unavailable:{region}")
                continue
            comparable_regions += 1
            if quality == "partial":
                limitations.append(f"comparison_snapshot_data_partial:{region}")
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
        if missing_baseline_regions or not snapshots_by_region:
            limitations.append("previous_completed_snapshot_unavailable")
        limitations.extend(
            f"previous_completed_snapshot_unavailable:{region}"
            for region in sorted(missing_baseline_regions)
        )
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

    @classmethod
    def _comparison_quality(
        cls,
        current: Dict[str, Any],
        previous: Dict[str, Any],
    ) -> str:
        qualities = {cls._snapshot_quality(current), cls._snapshot_quality(previous)}
        if "unavailable" in qualities:
            return "unavailable"
        if "partial" in qualities:
            return "partial"
        return "fresh"

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
