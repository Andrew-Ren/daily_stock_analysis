# -*- coding: utf-8 -*-
"""Tests for the data capability overview service."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from api.app import create_app
from src.services.data_capability_service import DataCapabilityService


class _Fetcher:
    def __init__(
        self,
        name: str,
        priority: int,
        *,
        available=None,
        last_error: str = "",
        is_available=None,
        is_available_for_request=None,
    ) -> None:
        self.name = name
        self.priority = priority
        if available is not None:
            self._available = available
        if last_error:
            self.last_error = last_error
        if is_available is not None:
            self.is_available = lambda: is_available
        if is_available_for_request is not None:
            self.is_available_for_request = lambda _capability="": is_available_for_request


class _FetcherManager:
    def __init__(self, fetchers) -> None:
        self._fetchers = fetchers

    def _get_fetchers_snapshot(self):
        return list(self._fetchers)


def _config(**overrides):
    values = {
        "tushare_token": None,
        "tickflow_api_key": None,
        "tickflow_priority": 2,
        "futu_opend_host": None,
        "longbridge_app_key": None,
        "longbridge_app_secret": None,
        "longbridge_access_token": None,
        "longbridge_oauth_client_id": None,
        "finnhub_api_key": None,
        "alphavantage_api_key": None,
        "enable_realtime_quote": True,
        "enable_fundamental_pipeline": True,
        "realtime_source_priority": "tencent,akshare_sina,efinance,akshare_em",
        "futu_hk_realtime_source_priority": "futu,longbridge,akshare,yfinance",
        "screening_enabled": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _dataset(overview, name: str):
    return next(item for item in overview["datasets"] if item["dataset"] == name)


def _provider(overview, name: str):
    return next(item for item in overview["providers"] if item["name"] == name)


def test_overview_marks_tickflow_priority_gap_without_leaking_secret() -> None:
    manager = _FetcherManager([
        _Fetcher("AkshareFetcher", 1, available=True),
        _Fetcher("EfinanceFetcher", 3, available=True),
        _Fetcher("TickFlowFetcher", 2),
        _Fetcher("YfinanceFetcher", 4, available=True),
    ])
    secret = "tickflow-secret-value"
    service = DataCapabilityService(
        config=_config(tickflow_api_key=secret, realtime_source_priority="tencent,efinance"),
        fetcher_manager=manager,
    )

    overview = service.get_overview()

    assert _provider(overview, "tickflow")["configured"] is True
    assert _provider(overview, "tickflow")["status"] == "unknown"
    assert _provider(overview, "tickflow")["warnings"] == ["runtime_probe_not_performed"]
    assert "tickflow_configured_but_not_in_realtime_priority" in overview["warnings"]
    assert secret not in json.dumps(overview, ensure_ascii=False)


def test_realtime_dataset_degrades_when_first_priority_source_is_unconfigured() -> None:
    manager = _FetcherManager([
        _Fetcher("EfinanceFetcher", 0, available=True),
        _Fetcher("AkshareFetcher", 1, available=True),
        _Fetcher("YfinanceFetcher", 4, available=True),
    ])
    service = DataCapabilityService(
        config=_config(realtime_source_priority="tushare,efinance"),
        fetcher_manager=manager,
    )

    overview = service.get_overview()
    quote_quality = _dataset(overview, "quote.realtime")

    assert quote_quality["status"] == "degraded"
    assert quote_quality["source"] is None
    assert quote_quality["fallback_from"] == ["cn:tushare", "hk:futu", "hk:longbridge"]
    assert quote_quality["coverage"]["markets"]["cn"]["status"] == "degraded"
    assert quote_quality["coverage"]["markets"]["cn"]["source"] == "efinance"
    assert "cn:source_status:tushare:unconfigured" in quote_quality["warnings"]


def test_provider_runtime_probe_preserves_unknown_until_checked() -> None:
    manager = _FetcherManager([
        _Fetcher("TickFlowFetcher", 1),
        _Fetcher("TushareFetcher", 2, is_available=False),
    ])
    service = DataCapabilityService(
        config=_config(tickflow_api_key="secret", tushare_token="token"),
        fetcher_manager=manager,
    )

    overview = service.get_overview()

    assert _provider(overview, "tickflow")["status"] == "unknown"
    assert _provider(overview, "tushare")["status"] == "unavailable"


def test_provider_runtime_probe_honors_request_time_unavailable_over_cached_available_flag() -> None:
    manager = _FetcherManager([
        _Fetcher("LongbridgeFetcher", 1, available=True, is_available_for_request=False),
    ])
    service = DataCapabilityService(
        config=_config(longbridge_app_key="key"),
        fetcher_manager=manager,
    )

    overview = service.get_overview()

    assert _provider(overview, "longbridge")["status"] == "unavailable"
    assert _provider(overview, "longbridge")["warnings"] == ["provider_marked_unavailable"]


def test_realtime_dataset_quality_is_market_aware() -> None:
    manager = _FetcherManager([
        _Fetcher("EfinanceFetcher", 0, available=True),
        _Fetcher("YfinanceFetcher", 4, available=True),
    ])
    service = DataCapabilityService(
        config=_config(
            realtime_source_priority="efinance",
            futu_hk_realtime_source_priority="futu,longbridge",
        ),
        fetcher_manager=manager,
    )

    overview = service.get_overview()
    quote_quality = _dataset(overview, "quote.realtime")
    priorities = {item["scenario"]: item for item in overview["priorities"]}

    assert priorities["us.realtime"]["providers"] == ["yfinance", "longbridge"]
    assert quote_quality["status"] == "partial"
    assert quote_quality["coverage"]["markets"]["cn"]["status"] == "ok"
    assert quote_quality["coverage"]["markets"]["cn"]["source"] == "efinance"
    assert quote_quality["coverage"]["markets"]["hk"]["status"] == "unavailable"
    assert quote_quality["coverage"]["markets"]["us"]["status"] == "ok"


def test_daily_dataset_quality_is_market_aware() -> None:
    manager = _FetcherManager([
        _Fetcher("EfinanceFetcher", 0, available=True),
        _Fetcher("YfinanceFetcher", 4, available=False),
    ])
    service = DataCapabilityService(
        config=_config(),
        fetcher_manager=manager,
    )

    overview = service.get_overview()
    daily_quality = _dataset(overview, "kline.daily")

    assert daily_quality["status"] == "partial"
    assert daily_quality["coverage"]["markets"]["cn"]["status"] == "ok"
    assert daily_quality["coverage"]["markets"]["cn"]["source"] == "efinance"
    assert daily_quality["coverage"]["markets"]["hk"]["status"] == "unavailable"
    assert daily_quality["coverage"]["markets"]["us"]["status"] == "unavailable"
    assert "hk:source_status:yfinance:unavailable" in daily_quality["warnings"]
    assert "us:source_status:yfinance:unavailable" in daily_quality["warnings"]


def test_daily_dataset_quality_prefers_longbridge_for_us_when_available() -> None:
    manager = _FetcherManager([
        _Fetcher("LongbridgeFetcher", 5, available=True, is_available_for_request=True),
        _Fetcher("YfinanceFetcher", 4, available=True),
    ])
    service = DataCapabilityService(
        config=_config(longbridge_app_key="key"),
        fetcher_manager=manager,
    )

    overview = service.get_overview()
    daily_quality = _dataset(overview, "kline.daily")

    assert daily_quality["coverage"]["markets"]["us"]["status"] == "ok"
    assert daily_quality["coverage"]["markets"]["us"]["source"] == "longbridge"
    assert "us:finnhub" not in daily_quality["fallback_from"]


def test_screening_snapshot_priority_preserves_explicit_env_override() -> None:
    service = DataCapabilityService(
        config=_config(screening_enabled=True),
        fetcher_manager=_FetcherManager([]),
    )

    with patch.dict("os.environ", {"SNAPSHOT_SOURCE_PRIORITY": "tushare,em_datacenter"}, clear=False):
        with patch(
            "src.services.screening_service._resolve_screening_snapshot_source_priority",
            side_effect=AssertionError("resolver should not run when override is set"),
        ):
            overview = service.get_overview()

    priorities = {item["scenario"]: item for item in overview["priorities"]}
    screening = priorities["screening.snapshot"]

    assert screening["providers"] == ["tushare", "em_datacenter"]


def test_daily_capability_contract_includes_market_specific_daily_fetchers() -> None:
    service = DataCapabilityService(
        config=_config(
            futu_opend_host="127.0.0.1",
            finnhub_api_key="key",
            alphavantage_api_key="key",
        ),
        fetcher_manager=_FetcherManager([]),
    )

    overview = service.get_overview()

    assert "kline.daily" in _provider(overview, "futu")["datasets"]
    assert "kline.daily" in _provider(overview, "finnhub")["datasets"]
    assert "kline.daily" in _provider(overview, "alphavantage")["datasets"]


def test_disabled_runtime_features_surface_dataset_quality_warnings() -> None:
    manager = _FetcherManager([_Fetcher("AkshareFetcher", 1), _Fetcher("YfinanceFetcher", 4)])
    service = DataCapabilityService(
        config=_config(
            enable_realtime_quote=False,
            enable_fundamental_pipeline=False,
            screening_enabled=False,
        ),
        fetcher_manager=manager,
    )

    overview = service.get_overview()

    assert _dataset(overview, "quote.realtime")["status"] == "unavailable"
    assert _dataset(overview, "quote.realtime")["warnings"] == ["realtime_quote_disabled"]
    assert _dataset(overview, "financial.snapshot")["status"] == "unavailable"
    assert _dataset(overview, "financial.snapshot")["warnings"] == ["fundamental_pipeline_disabled"]
    assert _dataset(overview, "strategy.screening")["status"] == "unconfigured"
    assert _dataset(overview, "strategy.screening")["warnings"] == ["screening_disabled"]


def test_data_capability_api_paths_return_valid_contract() -> None:
    overview_payload = {
        "as_of": "2026-08-26T15:05:00+08:00",
        "providers": [
            {
                "name": "efinance",
                "label": "Efinance",
                "enabled": True,
                "configured": True,
                "status": "ok",
                "priority": 0,
                "markets": ["cn"],
                "datasets": ["quote.realtime"],
                "warnings": [],
                "last_error": None,
                "cooldown": None,
            }
        ],
        "datasets": [
            {
                "dataset": "quote.realtime",
                "status": "ok",
                "source": "efinance",
                "stale": False,
                "last_success": None,
                "last_error": None,
                "fallback_from": [],
                "coverage": None,
                "warnings": [],
            }
        ],
        "priorities": [
            {
                "scenario": "cn.realtime",
                "providers": ["efinance"],
                "source": "test",
                "warnings": [],
            }
        ],
        "warnings": [],
    }

    class _Service:
        def __init__(self, *, config) -> None:
            self.config = config

        def get_overview(self):
            return overview_payload

    with tempfile.TemporaryDirectory() as temp_dir:
        client = TestClient(create_app(static_dir=Path(temp_dir)))
        with patch("api.v1.endpoints.data.DataCapabilityService", _Service):
            overview_response = client.get("/api/v1/data/overview")
            capabilities_response = client.get("/api/v1/data/capabilities")

    assert overview_response.status_code == 200
    assert capabilities_response.status_code == 200
    assert overview_response.json() == overview_payload
    assert capabilities_response.json() == overview_payload
