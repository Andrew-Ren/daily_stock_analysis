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
    def __init__(self, name: str, priority: int, *, available=None, last_error: str = "") -> None:
        self.name = name
        self.priority = priority
        if available is not None:
            self._available = available
        if last_error:
            self.last_error = last_error


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
        _Fetcher("AkshareFetcher", 1),
        _Fetcher("EfinanceFetcher", 3),
        _Fetcher("TickFlowFetcher", 2),
    ])
    secret = "tickflow-secret-value"
    service = DataCapabilityService(
        config=_config(tickflow_api_key=secret, realtime_source_priority="tencent,efinance"),
        fetcher_manager=manager,
    )

    overview = service.get_overview()

    assert _provider(overview, "tickflow")["configured"] is True
    assert _provider(overview, "tickflow")["status"] == "ok"
    assert "tickflow_configured_but_not_in_realtime_priority" in overview["warnings"]
    assert secret not in json.dumps(overview, ensure_ascii=False)


def test_realtime_dataset_degrades_when_first_priority_source_is_unconfigured() -> None:
    manager = _FetcherManager([_Fetcher("EfinanceFetcher", 0)])
    service = DataCapabilityService(
        config=_config(realtime_source_priority="tushare,efinance"),
        fetcher_manager=manager,
    )

    overview = service.get_overview()
    quote_quality = _dataset(overview, "quote.realtime")

    assert quote_quality["status"] == "degraded"
    assert quote_quality["source"] == "efinance"
    assert quote_quality["fallback_from"] == ["tushare"]
    assert "source_status:tushare:unconfigured" in quote_quality["warnings"]


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
