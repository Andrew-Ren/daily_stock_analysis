# -*- coding: utf-8 -*-
"""Contract tests for the read-only dashboard overview."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

import src.auth as auth
from api.app import create_app
from src.config import Config
from src.services.dashboard_overview_service import DashboardOverviewService
from src.storage import DatabaseManager


def _snapshot(region: str, trade_date: str, score: int, status: str, quality: str = "ok") -> dict:
    return {
        "region": region,
        "trade_date": trade_date,
        "status": status,
        "score": score,
        "label": status,
        "temperature_label": "neutral",
        "reasons": ["persisted evidence"],
        "guidance": "observe",
        "dimensions": {
            "breadth": {"score": score, "available": True},
            "index": {"score": score, "available": True},
            "limit": {"score": score, "available": True},
        },
        "data_quality": quality,
    }


def _review(record_id: int, created_at: str) -> dict:
    return {
        "id": record_id,
        "query_id": f"market-{record_id}",
        "stock_code": "MARKET",
        "stock_name": "市场复盘",
        "report_type": "market_review",
        "created_at": created_at,
    }


def _stock_report(record_id: int = 20) -> dict:
    return {
        "id": record_id,
        "query_id": f"stock-{record_id}",
        "stock_code": "600519",
        "stock_name": "贵州茅台",
        "report_type": "detailed",
        "created_at": "2026-08-29T08:00:00+08:00",
    }


def _history_page(history: MagicMock, items: list[dict], kwargs: dict) -> dict:
    page = int(kwargs.get("page") or 1)
    limit = int(kwargs.get("limit") or 50)
    start = (page - 1) * limit
    page_items = [dict(item) for item in items[start:start + limit]]
    if kwargs.get("include_context_snapshot"):
        for item in page_items:
            try:
                detail = history.get_history_detail_by_id(item["id"])
            except Exception:
                detail = None
            if detail:
                item["context_snapshot"] = detail.get("context_snapshot")
    return {"items": page_items, "total": len(items)}


def _dependencies() -> dict[str, MagicMock | SimpleNamespace]:
    history = MagicMock()
    market_reviews = [
        _review(index, f"2026-08-{30 - index:02d}T09:00:00+08:00")
        for index in range(1, 13)
    ]
    all_history = [_stock_report(20 + index) for index in range(9)] + market_reviews

    def list_history(**kwargs: object) -> dict:
        if kwargs.get("report_type") == "market_review":
            items = market_reviews
        else:
            items = all_history
        return _history_page(history, items, kwargs)

    history.get_history_list.side_effect = list_history
    history.get_history_detail_by_id.side_effect = lambda record_id: {
        "context_snapshot": {
            "market_light_snapshots": {
                "cn": _snapshot(
                    "cn",
                    "2026-08-29" if record_id == 1 else "2026-08-28",
                    60 if record_id == 1 else 50,
                    "yellow" if record_id == 1 else "green",
                )
            }
        }
    }
    portfolio = MagicMock()
    portfolio.list_cached_position_identities.return_value = [("cn", "600519"), ("us", "AAPL")]
    alerts = MagicMock()
    alerts.list_rules.return_value = {"items": [{"id": 1}], "total": 143}
    tasks = MagicMock()
    tasks.get_task_stats.return_value = {
        "total": 8,
        "pending": 1,
        "processing": 2,
        "completed": 4,
        "failed": 1,
    }
    return {
        "history_service": history,
        "config": SimpleNamespace(stock_list=["600519", "HK00700", "AAPL"]),
        "portfolio_repository": portfolio,
        "alert_service": alerts,
        "task_queue": tasks,
    }


def test_overview_uses_backend_totals_and_persisted_snapshot_changes() -> None:
    dependencies = _dependencies()
    service = DashboardOverviewService(**dependencies)

    payload = service.get_overview()

    assert payload["market"]["data"]["review_count"] == 12
    assert len(payload["market"]["data"]["latest_reviews"]) == 5
    assert payload["personal"]["data"] == {
        "watchlist_count": 3,
        "cached_position_count": 2,
        "active_monitor_count": 143,
    }
    assert payload["personal"]["meta"]["quality"] == "partial"
    assert payload["activity"]["data"]["recent_reports"][0]["id"] == 20
    assert payload["activity"]["data"]["task_stats"]["processing"] == 2
    changes = {item["key"]: item for item in payload["what_changed"]["data"]["items"]}
    assert changes["market.cn.score"]["before"] == 50
    assert changes["market.cn.score"]["after"] == 60
    assert changes["market.cn.score"]["direction"] == "increased"
    assert changes["market.cn.status"]["before"] == "green"
    assert changes["market.cn.status"]["after"] == "yellow"
    assert payload["what_changed"]["data"]["comparison_mode"] == "previous_completed_snapshot"
    assert payload["system"]["data"]["refresh_starts_analysis"] is False
    dependencies["alert_service"].list_rules.assert_called_once_with(
        enabled=True, page=1, page_size=100
    )


def test_one_market_snapshot_keeps_dashboard_but_marks_change_baseline_partial() -> None:
    dependencies = _dependencies()
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(
            dependencies["history_service"],
            [_review(1, "2026-08-29T09:00:00+08:00")],
            kwargs,
        )
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )
    dependencies["history_service"].get_history_detail_by_id.side_effect = None
    dependencies["history_service"].get_history_detail_by_id.return_value = {
        "context_snapshot": {"market_light_snapshots": {"cn": _snapshot("cn", "2026-08-29", 60, "yellow")}}
    }

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["meta"]["quality"] == "fresh"
    assert payload["what_changed"]["meta"]["quality"] == "partial"
    assert payload["what_changed"]["data"]["items"] == []
    assert "previous_completed_snapshot_unavailable" in payload["what_changed"]["meta"]["limitations"]


def test_present_but_unavailable_baseline_is_not_reported_as_missing() -> None:
    dependencies = _dependencies()
    reviews = [
        _review(1, "2026-08-29T09:00:00+08:00"),
        _review(2, "2026-08-28T09:00:00+08:00"),
    ]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )
    dependencies["history_service"].get_history_detail_by_id.side_effect = lambda record_id: {
        "context_snapshot": {
            "market_light_snapshots": {
                "cn": _snapshot(
                    "cn",
                    "2026-08-29" if record_id == 1 else "2026-08-28",
                    60 if record_id == 1 else 50,
                    "yellow",
                    "ok" if record_id == 1 else "unavailable",
                )
            }
        }
    }

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["what_changed"]["data"]["previous_trade_dates"] == {"cn": "2026-08-28"}
    assert "comparison_snapshot_unavailable:cn" in payload["what_changed"]["meta"]["limitations"]
    assert "previous_completed_snapshot_unavailable" not in payload["what_changed"]["meta"]["limitations"]
    assert "previous_completed_snapshot_unavailable:cn" not in payload["what_changed"]["meta"]["limitations"]


def test_market_history_reads_one_bounded_window_for_an_older_valid_baseline() -> None:
    dependencies = _dependencies()
    reviews = [_review(index, f"2026-07-{(index % 28) + 1:02d}T09:00:00+08:00") for index in range(1, 52)]

    def list_history(**kwargs: object) -> dict:
        if kwargs.get("report_type") != "market_review":
            return {"items": [], "total": 0}
        return _history_page(dependencies["history_service"], reviews, kwargs)

    dependencies["history_service"].get_history_list.side_effect = list_history
    dependencies["history_service"].get_history_detail_by_id.side_effect = lambda record_id: {
        "context_snapshot": {
            "market_light_snapshots": (
                {"us": _snapshot("us", "2026-08-29", 60, "yellow")}
                if record_id == 1
                else {"us": _snapshot("us", "2026-08-28", 50, "green")}
                if record_id == 51
                else {}
            )
        }
    }

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["what_changed"]["data"]["previous_trade_dates"]["us"] == "2026-08-28"
    assert payload["what_changed"]["meta"]["quality"] == "fresh"
    market_calls = [
        call for call in dependencies["history_service"].get_history_list.call_args_list
        if call.kwargs.get("report_type") == "market_review"
    ]
    assert len(market_calls) == 1
    assert market_calls[0].kwargs["limit"] == 100


def test_change_baseline_is_the_latest_strictly_earlier_trade_date() -> None:
    dependencies = _dependencies()
    reviews = [_review(index, f"2026-08-{30 - index:02d}T09:00:00+08:00") for index in range(1, 5)]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )
    dates = {1: "2026-08-28", 2: "2026-08-29", 3: "2026-08-29", 4: "2026-08-27"}
    dependencies["history_service"].get_history_detail_by_id.side_effect = lambda record_id: {
        "context_snapshot": {
            "market_light_snapshots": {
                "cn": _snapshot("cn", dates[record_id], record_id * 10, "yellow")
            }
        }
    }

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["what_changed"]["data"]["current_trade_dates"]["cn"] == "2026-08-29"
    assert payload["what_changed"]["data"]["previous_trade_dates"]["cn"] == "2026-08-28"


def test_trade_dates_are_canonicalized_before_deduplication_and_sorting() -> None:
    dependencies = _dependencies()
    reviews = [
        _review(1, "2026-08-30T09:00:00+08:00"),
        _review(2, "2026-08-29T09:00:00+08:00"),
    ]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )
    dependencies["history_service"].get_history_detail_by_id.side_effect = lambda record_id: {
        "context_snapshot": {
            "market_light_snapshots": {
                "cn": _snapshot(
                    "cn",
                    "20260829" if record_id == 1 else "2026-08-30",
                    60,
                    "yellow",
                )
            }
        }
    }

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["what_changed"]["data"]["current_trade_dates"] == {"cn": "2026-08-30"}
    assert payload["what_changed"]["data"]["previous_trade_dates"] == {"cn": "2026-08-29"}


def test_change_quality_uses_the_worse_snapshot_quality() -> None:
    dependencies = _dependencies()
    dependencies["history_service"].get_history_detail_by_id.side_effect = lambda record_id: {
        "context_snapshot": {
            "market_light_snapshots": {
                "cn": _snapshot(
                    "cn",
                    "2026-08-29" if record_id == 1 else "2026-08-28",
                    60 if record_id == 1 else 50,
                    "yellow" if record_id == 1 else "green",
                    "ok" if record_id == 1 else "partial",
                )
            }
        }
    }

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["what_changed"]["meta"]["quality"] == "partial"
    assert "comparison_snapshot_data_partial:cn" in payload["what_changed"]["meta"]["limitations"]
    assert {item["quality"] for item in payload["what_changed"]["data"]["items"]} == {"partial"}


def test_incomplete_detail_history_keeps_what_changed_partial() -> None:
    dependencies = _dependencies()
    original_detail = dependencies["history_service"].get_history_detail_by_id.side_effect

    def detail_with_failure(record_id: int) -> dict | None:
        if record_id == 1:
            return None
        return original_detail(record_id)

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail_with_failure

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"] == {}
    assert payload["what_changed"]["data"]["current_trade_dates"] == {}
    assert payload["what_changed"]["data"]["previous_trade_dates"] == {}
    assert payload["what_changed"]["data"]["items"] == []
    assert payload["what_changed"]["meta"]["quality"] == "partial"
    assert "market_review_detail_partial" in payload["what_changed"]["meta"]["limitations"]
    assert "latest_completed_snapshot_unavailable" in payload["market"]["meta"]["limitations"]


def test_malformed_projected_context_does_not_promote_older_snapshots() -> None:
    dependencies = _dependencies()
    original_detail = dependencies["history_service"].get_history_detail_by_id.side_effect

    def detail_with_malformed_json(record_id: int) -> dict:
        if record_id == 1:
            return {"context_snapshot": "{invalid-json"}
        return original_detail(record_id)

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail_with_malformed_json

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"] == {}
    assert payload["what_changed"]["data"]["current_trade_dates"] == {}
    assert payload["what_changed"]["data"]["previous_trade_dates"] == {}
    assert payload["what_changed"]["data"]["items"] == []
    assert "market_review_detail_partial" in payload["market"]["meta"]["limitations"]
    assert "latest_completed_snapshot_unavailable" in payload["market"]["meta"]["limitations"]


def test_malformed_nested_snapshot_container_does_not_promote_older_snapshots() -> None:
    dependencies = _dependencies()
    original_detail = dependencies["history_service"].get_history_detail_by_id.side_effect

    def detail_with_malformed_container(record_id: int) -> dict:
        if record_id == 1:
            return {"context_snapshot": {"market_light_snapshots": "{invalid-json"}}
        return original_detail(record_id)

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail_with_malformed_container

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"] == {}
    assert payload["what_changed"]["data"]["current_trade_dates"] == {}
    assert payload["what_changed"]["data"]["items"] == []
    assert "market_review_detail_partial" in payload["market"]["meta"]["limitations"]
    assert "latest_completed_snapshot_unavailable" in payload["market"]["meta"]["limitations"]


def test_malformed_scoped_container_does_not_hide_other_regions() -> None:
    dependencies = _dependencies()
    cn_review = _review(1, "2026-08-29T09:00:00+08:00")
    cn_review["region"] = "cn"
    reviews = [cn_review, _review(2, "2026-08-28T09:00:00+08:00")]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )

    def detail(record_id: int) -> dict:
        if record_id == 1:
            return {
                "context_snapshot": {
                    "market_review_region": "cn",
                    "market_light_snapshots": "{invalid-json",
                }
            }
        return {
            "context_snapshot": {
                "market_light_snapshots": {
                    "us": _snapshot("us", "2026-08-28", 55, "yellow")
                }
            }
        }

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert set(payload["market"]["data"]["latest_snapshots"]) == {"us"}
    limitations = payload["market"]["meta"]["limitations"]
    assert "latest_completed_snapshot_unavailable:cn" in limitations
    assert "latest_completed_snapshot_unavailable:us" not in limitations


def test_malformed_multi_region_container_blocks_each_scoped_region() -> None:
    dependencies = _dependencies()
    combined_review = _review(1, "2026-08-29T09:00:00+08:00")
    combined_review["region"] = "cn,us"
    older_reviews = [
        _review(2, "2026-08-28T09:00:00+08:00"),
        _review(3, "2026-08-27T09:00:00+08:00"),
    ]
    reviews = [combined_review, *older_reviews]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )

    def detail(record_id: int) -> dict:
        if record_id == 1:
            return {
                "context_snapshot": {
                    "market_review_region": "cn,us",
                    "market_light_snapshots": "{invalid-json",
                }
            }
        region = "cn" if record_id == 2 else "us"
        return {
            "context_snapshot": {
                "market_light_snapshots": {
                    region: _snapshot(region, "2026-08-28", 55, "yellow")
                }
            }
        }

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"] == {}
    limitations = payload["market"]["meta"]["limitations"]
    assert "latest_completed_snapshot_unavailable:cn" in limitations
    assert "latest_completed_snapshot_unavailable:us" in limitations


def test_invalid_outer_snapshot_key_falls_back_to_review_scope() -> None:
    dependencies = _dependencies()
    combined_review = _review(1, "2026-08-29T09:00:00+08:00")
    combined_review["region"] = "cn,us"
    reviews = [
        combined_review,
        _review(2, "2026-08-28T09:00:00+08:00"),
        _review(3, "2026-08-27T09:00:00+08:00"),
    ]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )

    def detail(record_id: int) -> dict:
        if record_id == 1:
            return {
                "context_snapshot": {
                    "market_review_region": "cn,us",
                    "market_light_snapshots": {"cn,us": []},
                }
            }
        region = "cn" if record_id == 2 else "us"
        return {
            "context_snapshot": {
                "market_light_snapshots": {
                    region: _snapshot(region, "2026-08-28", 55, "yellow")
                }
            }
        }

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"] == {}
    limitations = payload["market"]["meta"]["limitations"]
    assert "latest_completed_snapshot_unavailable:cn" in limitations
    assert "latest_completed_snapshot_unavailable:us" in limitations
    assert all("cn,us" not in limitation for limitation in limitations)


def test_older_malformed_detail_does_not_hide_valid_current_and_baseline() -> None:
    dependencies = _dependencies()
    reviews = [
        _review(1, "2026-08-29T09:00:00+08:00"),
        _review(2, "2026-08-28T09:00:00+08:00"),
        _review(3, "2026-08-27T09:00:00+08:00"),
    ]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )

    def detail(record_id: int) -> dict:
        if record_id == 3:
            return {"context_snapshot": "{invalid-json"}
        trade_date = "2026-08-29" if record_id == 1 else "2026-08-28"
        return {
            "context_snapshot": {
                "market_light_snapshots": {
                    "cn": _snapshot("cn", trade_date, 60 if record_id == 1 else 50, "yellow")
                }
            }
        }

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"]["cn"]["trade_date"] == "2026-08-29"
    assert payload["what_changed"]["data"]["current_trade_dates"] == {"cn": "2026-08-29"}
    assert payload["what_changed"]["data"]["previous_trade_dates"] == {"cn": "2026-08-28"}
    assert "market_review_detail_partial" in payload["market"]["meta"]["limitations"]


def test_malformed_detail_between_candidates_blocks_only_the_baseline() -> None:
    dependencies = _dependencies()
    reviews = [
        _review(1, "2026-08-29T09:00:00+08:00"),
        _review(2, "2026-08-28T09:00:00+08:00"),
        _review(3, "2026-08-27T09:00:00+08:00"),
    ]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )

    def detail(record_id: int) -> dict:
        if record_id == 2:
            return {"context_snapshot": "{invalid-json"}
        trade_date = "2026-08-29" if record_id == 1 else "2026-08-27"
        return {
            "context_snapshot": {
                "market_light_snapshots": {
                    "cn": _snapshot("cn", trade_date, 60 if record_id == 1 else 40, "yellow")
                }
            }
        }

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"]["cn"]["trade_date"] == "2026-08-29"
    assert payload["what_changed"]["data"]["current_trade_dates"] == {"cn": "2026-08-29"}
    assert payload["what_changed"]["data"]["previous_trade_dates"] == {}
    assert "previous_completed_snapshot_unavailable:cn" in payload["what_changed"]["meta"]["limitations"]


def test_malformed_region_snapshot_does_not_promote_older_region_snapshot() -> None:
    dependencies = _dependencies()
    original_detail = dependencies["history_service"].get_history_detail_by_id.side_effect

    def detail_with_malformed_region(record_id: int) -> dict:
        if record_id == 1:
            return {"context_snapshot": {"market_light_snapshots": {"cn": []}}}
        return original_detail(record_id)

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail_with_malformed_region

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"] == {}
    assert payload["what_changed"]["data"]["current_trade_dates"] == {}
    assert payload["what_changed"]["data"]["items"] == []
    assert "invalid_market_light_snapshot_skipped" in payload["market"]["meta"]["limitations"]
    assert "latest_completed_snapshot_unavailable:cn" in payload["market"]["meta"]["limitations"]


def test_malformed_only_region_is_reported_as_unavailable() -> None:
    dependencies = _dependencies()
    reviews = [_review(1, "2026-08-29T09:00:00+08:00")]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )
    dependencies["history_service"].get_history_detail_by_id.side_effect = lambda _record_id: {
        "context_snapshot": {
            "market_light_snapshots": {
                "cn": [],
                "us": _snapshot("us", "2026-08-29", 60, "yellow"),
            }
        }
    }

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert set(payload["market"]["data"]["latest_snapshots"]) == {"us"}
    assert "latest_completed_snapshot_unavailable:cn" in payload["market"]["meta"]["limitations"]


def test_invalid_latest_snapshot_does_not_promote_an_older_trade_date() -> None:
    dependencies = _dependencies()
    reviews = [
        _review(1, "2026-08-29T09:00:00+08:00"),
        _review(2, "2026-08-28T09:00:00+08:00"),
    ]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )

    def detail(record_id: int) -> dict:
        snapshot = _snapshot(
            "cn",
            "2026-08-29" if record_id == 1 else "2026-08-28",
            60 if record_id == 1 else 50,
            "yellow" if record_id == 1 else "green",
        )
        if record_id == 1:
            snapshot.pop("guidance")
        return {"context_snapshot": {"market_light_snapshots": {"cn": snapshot}}}

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"] == {}
    assert payload["what_changed"]["data"]["current_trade_dates"] == {}
    assert payload["what_changed"]["data"]["previous_trade_dates"] == {}
    assert payload["what_changed"]["data"]["items"] == []
    assert "invalid_market_light_snapshot_skipped" in payload["market"]["meta"]["limitations"]
    assert "latest_completed_snapshot_unavailable:cn" in payload["market"]["meta"]["limitations"]


def test_snapshot_region_mismatch_does_not_promote_an_older_trade_date() -> None:
    dependencies = _dependencies()
    reviews = [
        _review(1, "2026-08-29T09:00:00+08:00"),
        _review(2, "2026-08-28T09:00:00+08:00"),
    ]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )

    def detail(record_id: int) -> dict:
        snapshot = _snapshot(
            "us" if record_id == 1 else "cn",
            "2026-08-29" if record_id == 1 else "2026-08-28",
            60 if record_id == 1 else 50,
            "yellow" if record_id == 1 else "green",
        )
        return {"context_snapshot": {"market_light_snapshots": {"cn": snapshot}}}

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"] == {}
    assert payload["what_changed"]["data"]["current_trade_dates"] == {}
    assert payload["what_changed"]["data"]["previous_trade_dates"] == {}
    assert payload["what_changed"]["data"]["items"] == []
    assert "invalid_market_light_snapshot_skipped" in payload["market"]["meta"]["limitations"]
    assert "latest_completed_snapshot_unavailable:cn" in payload["market"]["meta"]["limitations"]


def test_invalid_previous_snapshot_does_not_fall_back_to_an_older_trade_date() -> None:
    dependencies = _dependencies()
    reviews = [
        _review(1, "2026-08-29T09:00:00+08:00"),
        _review(2, "2026-08-28T09:00:00+08:00"),
        _review(3, "2026-08-27T09:00:00+08:00"),
    ]
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(dependencies["history_service"], reviews, kwargs)
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )

    def detail(record_id: int) -> dict:
        trade_date = f"2026-08-{30 - record_id:02d}"
        snapshot = _snapshot("cn", trade_date, 70 - record_id * 10, "yellow")
        if record_id == 2:
            snapshot.pop("guidance")
        return {"context_snapshot": {"market_light_snapshots": {"cn": snapshot}}}

    dependencies["history_service"].get_history_detail_by_id.side_effect = detail

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["data"]["latest_snapshots"]["cn"]["trade_date"] == "2026-08-29"
    assert payload["what_changed"]["data"]["current_trade_dates"] == {"cn": "2026-08-29"}
    assert payload["what_changed"]["data"]["previous_trade_dates"] == {}
    assert payload["what_changed"]["data"]["items"] == []
    assert "invalid_market_light_snapshot_skipped" in payload["what_changed"]["meta"]["limitations"]
    assert "previous_completed_snapshot_unavailable:cn" in payload["what_changed"]["meta"]["limitations"]


def test_market_history_scan_is_bounded_and_reports_truncation() -> None:
    dependencies = _dependencies()
    reviews = [_review(index, "2026-08-29T09:00:00+08:00") for index in range(1, 251)]

    def list_history(**kwargs: object) -> dict:
        if kwargs.get("report_type") != "market_review":
            return {"items": [], "total": 0}
        return _history_page(dependencies["history_service"], reviews, kwargs)

    dependencies["history_service"].get_history_list.side_effect = list_history
    dependencies["history_service"].get_history_detail_by_id.return_value = {
        "context_snapshot": {"market_light_snapshots": {}}
    }
    dependencies["history_service"].get_history_detail_by_id.side_effect = None

    payload = DashboardOverviewService(**dependencies).get_overview()

    market_calls = [
        call for call in dependencies["history_service"].get_history_list.call_args_list
        if call.kwargs.get("report_type") == "market_review"
    ]
    assert [call.kwargs["page"] for call in market_calls] == [1]
    assert market_calls[0].kwargs["limit"] == 100
    assert all(call.kwargs["stock_code"] == "MARKET" for call in market_calls)
    assert all(call.kwargs["include_context_snapshot"] for call in market_calls)
    assert "market_review_history_scan_incomplete" in payload["market"]["meta"]["limitations"]
    assert "market_review_history_scan_incomplete" in payload["what_changed"]["meta"]["limitations"]


def test_changes_are_partial_when_only_some_regions_have_a_baseline() -> None:
    dependencies = _dependencies()
    dependencies["history_service"].get_history_list.side_effect = lambda **kwargs: (
        _history_page(
            dependencies["history_service"],
            [_review(1, "2026-08-29T09:00:00+08:00"), _review(2, "2026-08-28T09:00:00+08:00")],
            kwargs,
        )
        if kwargs.get("report_type") == "market_review"
        else {"items": [], "total": 0}
    )
    dependencies["history_service"].get_history_detail_by_id.side_effect = lambda record_id: {
        "context_snapshot": {
            "market_light_snapshots": {
                "cn": _snapshot("cn", "2026-08-29" if record_id == 1 else "2026-08-28", 60, "yellow"),
                **({"us": _snapshot("us", "2026-08-29", 55, "yellow")} if record_id == 1 else {}),
            }
        }
    }

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["what_changed"]["meta"]["quality"] == "partial"
    assert "previous_completed_snapshot_unavailable:us" in payload["what_changed"]["meta"]["limitations"]
    assert "us" in payload["what_changed"]["data"]["current_trade_dates"]
    assert "us" not in payload["what_changed"]["data"]["previous_trade_dates"]


def test_recent_reports_use_one_stable_bounded_history_window() -> None:
    dependencies = _dependencies()
    first_page = [_review(index, "2026-08-29T09:00:00+08:00") for index in range(1, 51)]
    second_page = [_stock_report(100 + index) for index in range(5)]
    history = first_page + second_page

    def list_history(**kwargs: object) -> dict:
        if kwargs.get("report_type") == "market_review":
            return {"items": [], "total": 0}
        page = int(kwargs.get("page") or 1)
        limit = int(kwargs.get("limit") or 50)
        start = (page - 1) * limit
        return {"items": history[start:start + limit], "total": len(history)}

    dependencies["history_service"].get_history_list.side_effect = list_history

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert [item["id"] for item in payload["activity"]["data"]["recent_reports"]] == [100, 101, 102, 103, 104]
    activity_calls = [
        call for call in dependencies["history_service"].get_history_list.call_args_list
        if "report_type" not in call.kwargs
    ]
    assert [call.kwargs["page"] for call in activity_calls] == [1]
    assert [call.kwargs["limit"] for call in activity_calls] == [100]


def test_recent_report_scan_is_bounded_when_history_contains_only_market_reviews() -> None:
    dependencies = _dependencies()
    history = [_review(index, "2026-08-29T09:00:00+08:00") for index in range(1, 251)]

    def list_history(**kwargs: object) -> dict:
        if kwargs.get("report_type") == "market_review":
            return {"items": [], "total": 0}
        page = int(kwargs.get("page") or 1)
        limit = int(kwargs.get("limit") or 50)
        start = (page - 1) * limit
        return {"items": history[start:start + limit], "total": len(history)}

    dependencies["history_service"].get_history_list.side_effect = list_history

    payload = DashboardOverviewService(**dependencies).get_overview()

    activity_calls = [
        call for call in dependencies["history_service"].get_history_list.call_args_list
        if "report_type" not in call.kwargs
    ]
    assert [call.kwargs["page"] for call in activity_calls] == [1]
    assert [call.kwargs["limit"] for call in activity_calls] == [100]
    assert payload["activity"]["data"]["recent_reports"] == []
    assert "recent_reports_history_scan_incomplete" in payload["activity"]["meta"]["limitations"]


def test_block_failures_are_isolated_and_system_remains_read_only() -> None:
    dependencies = _dependencies()
    dependencies["history_service"].get_history_list.side_effect = RuntimeError("db unavailable")
    dependencies["portfolio_repository"].list_cached_position_identities.side_effect = RuntimeError("cache unavailable")
    dependencies["alert_service"].list_rules.side_effect = RuntimeError("alerts unavailable")
    dependencies["task_queue"].get_task_stats.side_effect = RuntimeError("queue unavailable")

    payload = DashboardOverviewService(**dependencies).get_overview()

    assert payload["market"]["meta"]["quality"] == "unavailable"
    assert payload["what_changed"]["meta"]["quality"] == "unavailable"
    assert payload["personal"]["data"]["watchlist_count"] == 3
    assert payload["personal"]["meta"]["quality"] == "partial"
    assert payload["activity"]["meta"]["quality"] == "unavailable"
    assert payload["system"]["meta"]["quality"] == "fresh"
    assert payload["system"]["data"]["refresh_starts_analysis"] is False


def _reset_auth_globals() -> None:
    auth._auth_enabled = None
    auth._session_secret = None
    auth._password_hash_salt = None
    auth._password_hash_stored = None
    auth._rate_limit = {}


def test_dashboard_endpoint_exposes_read_only_contract() -> None:
    _reset_auth_globals()
    dependencies = _dependencies()
    overview = DashboardOverviewService(**dependencies).get_overview()
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            os.environ["DATABASE_PATH"] = str(Path(temp_dir) / "dashboard.db")
            os.environ["ADMIN_AUTH_ENABLED"] = "false"
            Config.reset_instance()
            DatabaseManager.reset_instance()
            app = create_app(static_dir=Path(temp_dir) / "empty-static")
            client = TestClient(app)
            with patch(
                "api.v1.endpoints.dashboard.DashboardOverviewService.get_overview",
                return_value=overview,
            ) as get_overview:
                response = client.get("/api/v1/dashboard/overview")

            assert response.status_code == 200, response.text
            assert response.json()["market"]["data"]["review_count"] == 12
            assert response.json()["system"]["data"]["refresh_starts_analysis"] is False
            get_overview.assert_called_once_with()
        finally:
            DatabaseManager.reset_instance()
            Config.reset_instance()
            os.environ.pop("DATABASE_PATH", None)
            os.environ.pop("ADMIN_AUTH_ENABLED", None)
            _reset_auth_globals()


def test_static_openapi_matches_dashboard_runtime_contract() -> None:
    static_spec = json.loads(
        (Path(__file__).resolve().parents[1] / "docs" / "architecture" / "api_spec.json").read_text(
            encoding="utf-8"
        )
    )
    runtime_spec = create_app().openapi()
    api_path = "/api/v1/dashboard/overview"
    assert static_spec["paths"][api_path] == runtime_spec["paths"][api_path]
    schema_names = [
        name
        for name in runtime_spec["components"]["schemas"]
        if name.startswith("Dashboard") or name.startswith("MarketLight")
    ]
    assert schema_names
    for schema_name in schema_names:
        assert static_spec["components"]["schemas"][schema_name] == runtime_spec["components"]["schemas"][schema_name]
