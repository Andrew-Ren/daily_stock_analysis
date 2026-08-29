# -*- coding: utf-8 -*-
"""Contract tests for the stock profile aggregate endpoint."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

import src.auth as auth
from api.app import create_app
from src.config import Config
from src.services.stock_profile_service import StockProfileService
from src.storage import DatabaseManager


def _quote(code: str = "AAPL") -> dict:
    return {
        "stock_code": code,
        "stock_name": "Apple",
        "current_price": 200.0,
        "change": 1.0,
        "change_percent": 0.5,
        "update_time": "2026-08-29T10:00:00+08:00",
    }


def _history() -> dict:
    return {
        "data": [
            {
                "date": "2026-08-28",
                "open": 198.0,
                "high": 202.0,
                "low": 197.0,
                "close": 200.0,
                "volume": 1000.0,
            }
        ]
    }


def _report_list() -> dict:
    return {
        "items": [
            {
                "id": 12,
                "query_id": "query-12",
                "stock_code": "AAPL",
                "stock_name": "Apple",
                "analysis_summary": "Demand remains resilient",
                "sentiment_score": 70,
                "created_at": "2026-08-28T12:00:00+08:00",
            }
        ],
        "total": 1,
    }


def _report_detail() -> dict:
    return {
        "id": 12,
        "query_id": "query-12",
        "stock_code": "AAPL",
        "stock_name": "Apple",
        "analysis_summary": "Demand remains resilient",
        "operation_advice": "Watch",
        "action": "watch",
        "action_label": "Watch",
        "trend_prediction": "Neutral",
        "sentiment_score": 70,
        "stop_loss": "180",
        "created_at": "2026-08-28T12:00:00+08:00",
        "context_snapshot": None,
    }


def _intelligence(code: str = "AAPL", market: str = "us") -> dict:
    return {
        "items": [
            {
                "id": 5,
                "source_type": "rss",
                "title": "Company update",
                "url": "https://example.com/update",
                "scope_type": "symbol",
                "scope_value": code,
                "market": market,
            }
        ],
        "total": 1,
    }


def _service(**overrides: object) -> tuple[StockProfileService, dict[str, MagicMock]]:
    dependencies = {
        "stock_service": MagicMock(),
        "history_service": MagicMock(),
        "intelligence_service": MagicMock(),
        "portfolio_repository": MagicMock(),
        "alert_service": MagicMock(),
    }
    dependencies.update(overrides)
    dependencies["stock_service"].get_realtime_quote.return_value = _quote()
    dependencies["stock_service"].get_history_data.return_value = _history()
    dependencies["history_service"].get_history_list.return_value = _report_list()
    dependencies["history_service"].get_history_detail_by_id.return_value = _report_detail()
    dependencies["intelligence_service"].list_items.return_value = _intelligence()
    dependencies["portfolio_repository"].list_cached_position_identities.return_value = [("us", "aapl")]
    dependencies["alert_service"].list_rules.return_value = {
        "items": [{"id": 8, "enabled": True}, {"id": 9, "enabled": False}],
        "total": 2,
    }
    return StockProfileService(**dependencies), dependencies


def test_profile_uses_one_canonical_code_and_returns_structured_research() -> None:
    service, dependencies = _service()

    payload = service.get_profile("aapl", history_days=45)

    assert payload["canonical_code"] == "AAPL"
    assert payload["market"] == "us"
    assert payload["quote"]["status"] == "fresh"
    assert payload["history"]["status"] == "fresh"
    assert payload["research"]["status"] == "fresh"
    assert payload["research"]["data"]["structured_report"]["artifact_id"] == "report:12"
    assert payload["portfolio"]["data"] == {"held": True, "matched_markets": ["us"]}
    assert payload["monitors"]["data"] == {
        "total_rule_count": 2,
        "enabled_rule_count": 1,
        "rule_ids": [8, 9],
    }
    assert payload["evidence_quality"]["status"] == "partial"
    dependencies["stock_service"].get_realtime_quote.assert_called_once_with("AAPL")
    dependencies["stock_service"].get_history_data.assert_called_once_with(
        "AAPL", period="daily", days=45
    )
    dependencies["history_service"].get_history_list.assert_called_once_with(
        stock_code="AAPL", page=1, limit=5
    )
    assert {call.kwargs["scope_value"] for call in dependencies["intelligence_service"].list_items.call_args_list} == {
        "AAPL",
        "aapl",
    }
    assert {call.kwargs["target"] for call in dependencies["alert_service"].list_rules.call_args_list} == {
        "AAPL",
        "aapl",
    }


def test_hk_alias_is_canonicalized_before_every_downstream_query() -> None:
    service, dependencies = _service()
    dependencies["stock_service"].get_realtime_quote.return_value = _quote("HK00700")
    dependencies["history_service"].get_history_list.return_value = {"items": [], "total": 0}
    dependencies["intelligence_service"].list_items.return_value = _intelligence("HK00700", "hk")

    payload = service.get_profile("00700.HK")

    assert payload["canonical_code"] == "HK00700"
    assert payload["market"] == "hk"
    dependencies["stock_service"].get_realtime_quote.assert_called_once_with("HK00700")
    dependencies["history_service"].get_history_list.assert_called_once_with(
        stock_code="HK00700", page=1, limit=5
    )
    assert "00700.HK" in {
        call.kwargs["scope_value"]
        for call in dependencies["intelligence_service"].list_items.call_args_list
    }
    assert "00700.HK" in {
        call.kwargs["target"] for call in dependencies["alert_service"].list_rules.call_args_list
    }


def test_profile_collects_intelligence_and_monitors_saved_under_legacy_aliases() -> None:
    service, dependencies = _service()

    def intelligence_by_alias(**kwargs: object) -> dict:
        if kwargs.get("scope_value") == "600519.SH":
            return _intelligence("600519.SH", "cn")
        return {"items": [], "total": 0}

    def rules_by_alias(**kwargs: object) -> dict:
        if kwargs.get("target") == "SH600519":
            return {"items": [{"id": 88, "enabled": True}], "total": 1}
        return {"items": [], "total": 0}

    dependencies["intelligence_service"].list_items.side_effect = intelligence_by_alias
    dependencies["alert_service"].list_rules.side_effect = rules_by_alias

    payload = service.get_profile("600519")

    assert payload["intelligence"]["status"] == "fresh"
    assert payload["intelligence"]["items"][0]["scope_value"] == "600519.SH"
    assert payload["monitors"]["data"] == {
        "total_rule_count": 1,
        "enabled_rule_count": 1,
        "rule_ids": [88],
    }


def test_optional_block_failures_remain_partial_and_do_not_hide_monitor_data() -> None:
    service, dependencies = _service()
    dependencies["stock_service"].get_realtime_quote.side_effect = RuntimeError("quote failed")
    dependencies["stock_service"].get_history_data.return_value = {"data": []}
    dependencies["history_service"].get_history_detail_by_id.return_value = None
    dependencies["intelligence_service"].list_items.side_effect = RuntimeError("intel failed")
    dependencies["portfolio_repository"].list_cached_position_identities.side_effect = RuntimeError("db failed")

    payload = service.get_profile("AAPL")

    assert payload["quote"]["status"] == "unavailable"
    assert payload["history"]["status"] == "unavailable"
    assert payload["research"]["status"] == "partial"
    assert payload["research"]["data"]["recent_reports"][0]["id"] == 12
    assert payload["intelligence"]["status"] == "unavailable"
    assert payload["portfolio"]["status"] == "unavailable"
    assert payload["monitors"]["status"] == "fresh"
    assert payload["evidence_quality"]["status"] == "partial"
    assert "latest_report_detail_unavailable" in payload["evidence_quality"]["limitations"]


def test_all_dependency_failures_return_unavailable_profile_instead_of_raising() -> None:
    service, dependencies = _service()
    for dependency, method in (
        ("stock_service", "get_realtime_quote"),
        ("stock_service", "get_history_data"),
        ("history_service", "get_history_list"),
        ("intelligence_service", "list_items"),
        ("portfolio_repository", "list_cached_position_identities"),
        ("alert_service", "list_rules"),
    ):
        getattr(dependencies[dependency], method).side_effect = RuntimeError("offline")

    payload = service.get_profile("600519")

    assert payload["market"] == "cn"
    assert payload["evidence_quality"]["status"] == "unavailable"
    assert set(payload["evidence_quality"]["blocks"].values()) == {"unavailable"}


def _reset_auth_globals() -> None:
    auth._auth_enabled = None
    auth._session_secret = None
    auth._password_hash_salt = None
    auth._password_hash_stored = None
    auth._rate_limit = {}


def _endpoint_payload() -> dict:
    service, _ = _service()
    return service.get_profile("AAPL")


def test_profile_endpoint_validates_code_and_exposes_contract() -> None:
    _reset_auth_globals()
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            os.environ["DATABASE_PATH"] = str(Path(temp_dir) / "profile.db")
            os.environ["ADMIN_AUTH_ENABLED"] = "false"
            Config.reset_instance()
            DatabaseManager.reset_instance()
            app = create_app(static_dir=Path(temp_dir) / "empty-static")
            client = TestClient(app)
            with patch(
                "api.v1.endpoints.stocks.StockProfileService.get_profile",
                return_value=_endpoint_payload(),
            ) as get_profile:
                response = client.get("/api/v1/stocks/AAPL/profile", params={"history_days": 90})
            invalid = client.get("/api/v1/stocks/invalid-code/profile")

            assert response.status_code == 200, response.text
            assert response.json()["canonical_code"] == "AAPL"
            get_profile.assert_called_once_with("AAPL", history_days=90)
            assert invalid.status_code == 400
        finally:
            DatabaseManager.reset_instance()
            Config.reset_instance()
            os.environ.pop("DATABASE_PATH", None)
            os.environ.pop("ADMIN_AUTH_ENABLED", None)
            _reset_auth_globals()


def test_static_openapi_matches_stock_profile_runtime_contract() -> None:
    static_spec = json.loads(
        (Path(__file__).resolve().parents[1] / "docs" / "architecture" / "api_spec.json").read_text(
            encoding="utf-8"
        )
    )
    runtime_spec = create_app().openapi()
    api_path = "/api/v1/stocks/{stock_code}/profile"
    assert static_spec["paths"][api_path] == runtime_spec["paths"][api_path]
    schema_names = [
        name for name in runtime_spec["components"]["schemas"] if name.startswith("StockProfile")
    ]
    assert schema_names
    for schema_name in schema_names:
        assert static_spec["components"]["schemas"][schema_name] == runtime_spec["components"]["schemas"][schema_name]
