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


def _dependencies() -> dict[str, MagicMock | SimpleNamespace]:
    history = MagicMock()

    def list_history(**kwargs: object) -> dict:
        if kwargs.get("report_type") == "market_review":
            return {
                "items": [
                    _review(1, "2026-08-29T09:00:00+08:00"),
                    _review(2, "2026-08-28T09:00:00+08:00"),
                ],
                "total": 12,
            }
        return {"items": [_stock_report(), _review(1, "2026-08-29T09:00:00+08:00")], "total": 21}

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
    assert len(payload["market"]["data"]["latest_reviews"]) == 2
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
        {"items": [_review(1, "2026-08-29T09:00:00+08:00")], "total": 1}
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
        name for name in runtime_spec["components"]["schemas"] if name.startswith("Dashboard")
    ]
    assert schema_names
    for schema_name in schema_names:
        assert static_spec["components"]["schemas"][schema_name] == runtime_spec["components"]["schemas"][schema_name]
