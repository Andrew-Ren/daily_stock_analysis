# -*- coding: utf-8 -*-
"""Read-only data capability and dataset quality overview service."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

from src.config import get_config

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _ProviderDefinition:
    name: str
    label: str
    fetcher_name: Optional[str]
    markets: Sequence[str]
    datasets: Sequence[str]
    builtin: bool = False


_PROVIDER_DEFINITIONS: Sequence[_ProviderDefinition] = (
    _ProviderDefinition(
        name="efinance",
        label="Efinance",
        fetcher_name="EfinanceFetcher",
        markets=("cn",),
        datasets=("quote.realtime", "kline.daily", "market.overview"),
        builtin=True,
    ),
    _ProviderDefinition(
        name="akshare",
        label="AkShare",
        fetcher_name="AkshareFetcher",
        markets=("cn", "hk"),
        datasets=(
            "quote.realtime",
            "kline.daily",
            "index.daily",
            "market.overview",
            "financial.snapshot",
        ),
        builtin=True,
    ),
    _ProviderDefinition(
        name="tencent",
        label="Tencent",
        fetcher_name="TencentFetcher",
        markets=("cn",),
        datasets=("kline.daily", "index.daily"),
        builtin=True,
    ),
    _ProviderDefinition(
        name="yfinance",
        label="YFinance",
        fetcher_name="YfinanceFetcher",
        markets=("cn", "hk", "us", "jp", "kr", "tw"),
        datasets=("quote.realtime", "kline.daily", "index.daily", "financial.snapshot"),
        builtin=True,
    ),
    _ProviderDefinition(
        name="pytdx",
        label="PyTDX",
        fetcher_name="PytdxFetcher",
        markets=("cn",),
        datasets=("quote.realtime", "kline.daily"),
        builtin=True,
    ),
    _ProviderDefinition(
        name="baostock",
        label="Baostock",
        fetcher_name="BaostockFetcher",
        markets=("cn",),
        datasets=("kline.daily",),
        builtin=True,
    ),
    _ProviderDefinition(
        name="tushare",
        label="Tushare",
        fetcher_name="TushareFetcher",
        markets=("cn", "hk"),
        datasets=("quote.realtime", "kline.daily", "index.daily", "market.overview", "financial.snapshot"),
    ),
    _ProviderDefinition(
        name="tickflow",
        label="TickFlow",
        fetcher_name="TickFlowFetcher",
        markets=("cn",),
        datasets=("quote.realtime", "kline.daily", "index.daily", "market.overview"),
    ),
    _ProviderDefinition(
        name="longbridge",
        label="Longbridge",
        fetcher_name="LongbridgeFetcher",
        markets=("hk", "us"),
        datasets=("quote.realtime", "kline.daily", "financial.snapshot"),
    ),
    _ProviderDefinition(
        name="futu",
        label="Futu OpenD",
        fetcher_name="FutuFetcher",
        markets=("hk",),
        datasets=("quote.realtime", "financial.snapshot"),
    ),
    _ProviderDefinition(
        name="finnhub",
        label="Finnhub",
        fetcher_name="FinnhubFetcher",
        markets=("us",),
        datasets=("quote.realtime",),
    ),
    _ProviderDefinition(
        name="alphavantage",
        label="Alpha Vantage",
        fetcher_name="AlphaVantageFetcher",
        markets=("us",),
        datasets=("quote.realtime",),
    ),
)

_FETCHER_TO_PROVIDER = {
    definition.fetcher_name: definition.name
    for definition in _PROVIDER_DEFINITIONS
    if definition.fetcher_name
}

_REALTIME_SOURCE_PROVIDER = {
    "efinance": "efinance",
    "akshare_em": "akshare",
    "akshare_sina": "akshare",
    "akshare_qq": "akshare",
    "tencent": "akshare",
    "tushare": "tushare",
    "tickflow": "tickflow",
    "futu": "futu",
    "longbridge": "longbridge",
    "akshare": "akshare",
    "yfinance": "yfinance",
    "finnhub": "finnhub",
    "alphavantage": "alphavantage",
}

_SCREENING_SOURCES = {"tushare", "sina", "efinance", "akshare_em", "em_datacenter"}


def _truthy(value: Any) -> bool:
    return bool(str(value or "").strip())


def _split_priority(value: Any) -> List[str]:
    if isinstance(value, (list, tuple)):
        raw_items = value
    else:
        raw_items = str(value or "").split(",")
    return [str(item).strip().lower() for item in raw_items if str(item).strip()]


class DataCapabilityService:
    """Build side-effect-light provider capability and dataset quality snapshots."""

    def __init__(self, *, config: Any = None, fetcher_manager: Any = None) -> None:
        self.config = config or get_config()
        self.fetcher_manager = fetcher_manager

    def get_overview(self) -> Dict[str, Any]:
        """Return a read-only data capability overview."""

        fetchers = self._fetchers_snapshot()
        providers = self._build_provider_capabilities(fetchers)
        provider_map = {item["name"]: item for item in providers}
        priorities = self._build_priority_views(fetchers)
        datasets = self._build_dataset_quality(provider_map, priorities)
        warnings = self._build_global_warnings(provider_map, priorities)

        return {
            "as_of": datetime.now(timezone.utc).astimezone().isoformat(),
            "providers": providers,
            "datasets": datasets,
            "priorities": priorities,
            "warnings": warnings,
        }

    def _fetchers_snapshot(self) -> List[Any]:
        manager = self.fetcher_manager
        if manager is None:
            try:
                from data_provider import DataFetcherManager

                manager = DataFetcherManager()
            except Exception as exc:  # noqa: BLE001 - diagnostics must fail open.
                logger.warning("Failed to initialize data fetcher manager for capability overview: %s", exc)
                return []

        snapshot = getattr(manager, "_get_fetchers_snapshot", None)
        if callable(snapshot):
            try:
                return list(snapshot())
            except Exception as exc:  # noqa: BLE001 - diagnostics must fail open.
                logger.warning("Failed to read data fetcher snapshot: %s", exc)
                return []
        return list(getattr(manager, "_fetchers", []) or [])

    def _build_provider_capabilities(self, fetchers: Sequence[Any]) -> List[Dict[str, Any]]:
        fetcher_map = {str(getattr(fetcher, "name", "")): fetcher for fetcher in fetchers}
        providers: List[Dict[str, Any]] = []

        for definition in _PROVIDER_DEFINITIONS:
            fetcher = fetcher_map.get(definition.fetcher_name or "")
            configured = self._is_provider_configured(definition)
            enabled = bool(definition.builtin or configured)
            warnings: List[str] = []

            if not configured and not definition.builtin:
                status = "unconfigured"
            elif fetcher is None and enabled:
                status = "unavailable"
                warnings.append("provider_not_initialized")
            else:
                status = self._provider_runtime_status(fetcher)
                if status == "unavailable":
                    warnings.append("provider_marked_unavailable")
                elif status == "unknown":
                    warnings.append("runtime_probe_not_performed")

            providers.append(
                {
                    "name": definition.name,
                    "label": definition.label,
                    "enabled": enabled,
                    "configured": configured,
                    "status": status,
                    "priority": self._provider_priority(definition, fetcher),
                    "markets": list(definition.markets),
                    "datasets": list(definition.datasets),
                    "warnings": warnings,
                    "last_error": self._safe_last_error(fetcher),
                    "cooldown": None,
                }
            )

        return providers

    @staticmethod
    def _provider_runtime_status(fetcher: Any) -> str:
        probe_result = DataCapabilityService._probe_fetcher_available(fetcher)
        if probe_result is True:
            return "ok"
        if probe_result is False:
            return "unavailable"

        known_available = getattr(fetcher, "_available", None)
        if known_available is True:
            return "ok"
        if known_available is False:
            return "unavailable"
        return "unknown"

    @staticmethod
    def _probe_fetcher_available(fetcher: Any, capability: str = "") -> Optional[bool]:
        try:
            from data_provider.base import DataFetcherManager

            for probe_name in ("is_available_for_request", "is_available", "_is_available"):
                result = DataFetcherManager._call_availability_probe(fetcher, probe_name, capability)
                if result is not None:
                    return result
        except Exception as exc:  # noqa: BLE001 - diagnostics must fail open.
            logger.debug("Failed to probe fetcher availability for capability overview: %s", exc)
        return None

    def _is_provider_configured(self, definition: _ProviderDefinition) -> bool:
        if definition.builtin:
            return True
        name = definition.name
        if name == "tushare":
            return _truthy(getattr(self.config, "tushare_token", None))
        if name == "tickflow":
            return _truthy(getattr(self.config, "tickflow_api_key", None))
        if name == "futu":
            return _truthy(getattr(self.config, "futu_opend_host", None))
        if name == "longbridge":
            app_key = getattr(self.config, "longbridge_app_key", None)
            app_secret = getattr(self.config, "longbridge_app_secret", None)
            access_token = getattr(self.config, "longbridge_access_token", None)
            oauth_client_id = getattr(self.config, "longbridge_oauth_client_id", None)
            has_legacy_credentials = _truthy(app_key) and _truthy(app_secret) and _truthy(access_token)
            has_oauth_credentials = _truthy(oauth_client_id) or (_truthy(app_key) and not _truthy(access_token))
            return has_legacy_credentials or has_oauth_credentials
        if name == "finnhub":
            return _truthy(getattr(self.config, "finnhub_api_key", None))
        if name == "alphavantage":
            return _truthy(getattr(self.config, "alphavantage_api_key", None))
        return False

    def _provider_priority(self, definition: _ProviderDefinition, fetcher: Any) -> Optional[int]:
        value = getattr(fetcher, "priority", None)
        if isinstance(value, int):
            return value
        if definition.name == "tickflow":
            priority = getattr(self.config, "tickflow_priority", None)
            return priority if isinstance(priority, int) else None
        return None

    @staticmethod
    def _safe_last_error(fetcher: Any) -> Optional[str]:
        if fetcher is None:
            return None
        for attr in ("last_error", "_last_error"):
            value = getattr(fetcher, attr, None)
            if value:
                return " ".join(str(value).split())
        return None

    def _build_priority_views(self, fetchers: Sequence[Any]) -> List[Dict[str, Any]]:
        generic_daily = [
            _FETCHER_TO_PROVIDER.get(str(getattr(fetcher, "name", "")), str(getattr(fetcher, "name", "")).lower())
            for fetcher in sorted(fetchers, key=lambda item: getattr(item, "priority", 99))
            if getattr(fetcher, "name", None)
        ]
        cn_index_daily = ["tencent", "akshare", "tickflow", "yfinance"]
        market_overview = self._market_overview_priority(generic_daily)
        screening_priority = self._screening_snapshot_priority()

        return [
            self._priority_view(
                "cn.realtime",
                _split_priority(getattr(self.config, "realtime_source_priority", "")),
                "Config.realtime_source_priority",
                known_sources=set(_REALTIME_SOURCE_PROVIDER),
            ),
            self._priority_view(
                "hk.realtime",
                _split_priority(getattr(self.config, "futu_hk_realtime_source_priority", "")),
                "Config.futu_hk_realtime_source_priority",
                known_sources={"futu", "longbridge", "akshare", "yfinance"},
            ),
            self._priority_view(
                "us.realtime",
                self._us_realtime_priority(),
                "DataFetcherManager US realtime route",
                known_sources={"longbridge", "yfinance"},
            ),
            self._priority_view(
                "daily.generic",
                generic_daily,
                "DataFetcherManager.fetchers",
                known_sources=set(_FETCHER_TO_PROVIDER.values()),
            ),
            self._priority_view(
                "cn.index.daily",
                cn_index_daily,
                "DataFetcherManager._CN_INDEX_DAILY_SOURCE_ORDER",
                known_sources=set(_FETCHER_TO_PROVIDER.values()),
            ),
            self._priority_view(
                "market.overview",
                market_overview,
                "DataFetcherManager market overview route",
                known_sources=set(_REALTIME_SOURCE_PROVIDER),
            ),
            self._priority_view(
                "screening.snapshot",
                screening_priority,
                "ScreeningService snapshot priority",
                known_sources=_SCREENING_SOURCES,
            ),
            self._priority_view(
                "news.events",
                ["intelligence", "search"],
                "IntelligenceSource/SearchService",
                known_sources={"intelligence", "search"},
            ),
        ]

    def _market_overview_priority(self, generic_daily: Sequence[str]) -> List[str]:
        tokens: List[str] = []
        if _truthy(getattr(self.config, "tickflow_api_key", None)):
            tokens.append("tickflow")
        for token in generic_daily:
            if token in {"efinance", "akshare", "tushare"} and token not in tokens:
                tokens.append(token)
        return tokens

    def _screening_snapshot_priority(self) -> List[str]:
        try:
            from src.services.screening_service import _resolve_screening_snapshot_source_priority

            return _split_priority(_resolve_screening_snapshot_source_priority(self.config))
        except Exception as exc:  # noqa: BLE001 - diagnostics must fail open.
            logger.debug("Failed to resolve screening snapshot priority: %s", exc)
            return _split_priority("sina,efinance,akshare_em,em_datacenter")

    def _us_realtime_priority(self) -> List[str]:
        if self._is_provider_configured(
            next(item for item in _PROVIDER_DEFINITIONS if item.name == "longbridge")
        ):
            return ["longbridge", "yfinance"]
        return ["yfinance", "longbridge"]

    @staticmethod
    def _priority_view(
        scenario: str,
        providers: Sequence[str],
        source: str,
        *,
        known_sources: Iterable[str],
    ) -> Dict[str, Any]:
        known = set(known_sources)
        warnings = [f"unknown_source:{provider}" for provider in providers if provider not in known]
        return {
            "scenario": scenario,
            "providers": list(providers),
            "source": source,
            "warnings": warnings,
        }

    def _build_dataset_quality(
        self,
        provider_map: Dict[str, Dict[str, Any]],
        priorities: Sequence[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        priority_map = {item["scenario"]: item for item in priorities}
        datasets = [
            self._aggregate_market_dataset(
                dataset="quote.realtime",
                market_priorities={
                    "cn": priority_map.get("cn.realtime", {}),
                    "hk": priority_map.get("hk.realtime", {}),
                    "us": priority_map.get("us.realtime", {}),
                },
                provider_map=provider_map,
                disabled=not bool(getattr(self.config, "enable_realtime_quote", True)),
                disabled_warning="realtime_quote_disabled",
            ),
            self._dataset_from_priority(
                dataset="kline.daily",
                priority=priority_map.get("daily.generic", {}),
                provider_map=provider_map,
            ),
            self._dataset_from_priority(
                dataset="index.daily",
                priority=priority_map.get("cn.index.daily", {}),
                provider_map=provider_map,
            ),
            self._dataset_from_priority(
                dataset="market.overview",
                priority=priority_map.get("market.overview", {}),
                provider_map=provider_map,
            ),
            self._dataset_from_priority(
                dataset="financial.snapshot",
                priority={
                    "providers": ["akshare", "yfinance", "tushare", "futu", "longbridge"],
                    "warnings": [],
                },
                provider_map=provider_map,
                disabled=not bool(getattr(self.config, "enable_fundamental_pipeline", True)),
                disabled_warning="fundamental_pipeline_disabled",
            ),
            self._news_events_dataset(),
            self._screening_dataset(priority_map.get("screening.snapshot", {})),
            self._local_dataset("alert.monitor", "alerts"),
            self._local_dataset("portfolio.account", "portfolio"),
        ]
        return datasets

    def _aggregate_market_dataset(
        self,
        *,
        dataset: str,
        market_priorities: Dict[str, Dict[str, Any]],
        provider_map: Dict[str, Dict[str, Any]],
        disabled: bool = False,
        disabled_warning: str = "",
    ) -> Dict[str, Any]:
        if disabled:
            return self._dataset_from_priority(
                dataset=dataset,
                priority={},
                provider_map=provider_map,
                disabled=True,
                disabled_warning=disabled_warning,
            )

        market_results = {
            market: self._dataset_from_priority(
                dataset=dataset,
                priority=priority,
                provider_map=provider_map,
            )
            for market, priority in market_priorities.items()
        }
        statuses = [str(result["status"]) for result in market_results.values()]
        selected_sources = [
            str(result["source"])
            for result in market_results.values()
            if result.get("source")
        ]
        unique_sources = sorted(set(selected_sources))
        warnings: List[str] = []
        fallback_from: List[str] = []
        coverage = {"markets": {}}

        for market, result in market_results.items():
            coverage["markets"][market] = {
                "status": result["status"],
                "source": result["source"],
                "fallback_from": list(result.get("fallback_from") or []),
                "warnings": list(result.get("warnings") or []),
            }
            fallback_from.extend(f"{market}:{token}" for token in result.get("fallback_from") or [])
            warnings.extend(f"{market}:{warning}" for warning in result.get("warnings") or [])

        return {
            "dataset": dataset,
            "status": self._aggregate_market_status(statuses),
            "source": unique_sources[0] if len(unique_sources) == 1 else None,
            "stale": None,
            "last_success": None,
            "last_error": None,
            "fallback_from": fallback_from,
            "coverage": coverage,
            "warnings": warnings,
        }

    @staticmethod
    def _aggregate_market_status(statuses: Sequence[str]) -> str:
        available_statuses = {"ok", "degraded"}
        if statuses and all(status == "ok" for status in statuses):
            return "ok"
        if statuses and all(status in available_statuses for status in statuses):
            return "degraded"
        if any(status in available_statuses for status in statuses):
            return "partial"
        if statuses and all(status == "unknown" for status in statuses):
            return "unknown"
        if statuses and all(status == "unconfigured" for status in statuses):
            return "unconfigured"
        if any(status == "unknown" for status in statuses):
            return "unknown"
        return "unavailable"

    def _dataset_from_priority(
        self,
        *,
        dataset: str,
        priority: Dict[str, Any],
        provider_map: Dict[str, Dict[str, Any]],
        disabled: bool = False,
        disabled_warning: str = "",
    ) -> Dict[str, Any]:
        if disabled:
            return {
                "dataset": dataset,
                "status": "unavailable",
                "source": None,
                "stale": None,
                "last_success": None,
                "last_error": None,
                "fallback_from": [],
                "coverage": None,
                "warnings": [disabled_warning] if disabled_warning else [],
            }

        providers = list(priority.get("providers") or [])
        warnings = list(priority.get("warnings") or [])
        if not providers:
            return self._unknown_dataset(dataset, warnings=["priority_empty", *warnings])

        selected: Optional[str] = None
        fallback_from: List[str] = []
        token_statuses: List[str] = []
        for token in providers:
            token_status = self._source_token_status(token, provider_map)
            token_statuses.append(token_status)
            if token_status == "ok":
                selected = token
                break
            fallback_from.append(token)
            warnings.append(f"source_status:{token}:{token_status}")

        if selected is None:
            if token_statuses and any(status == "unknown" for status in token_statuses):
                return {
                    "dataset": dataset,
                    "status": "unknown",
                    "source": None,
                    "stale": None,
                    "last_success": None,
                    "last_error": None,
                    "fallback_from": fallback_from,
                    "coverage": None,
                    "warnings": warnings,
                }
            return {
                "dataset": dataset,
                "status": "unavailable",
                "source": None,
                "stale": None,
                "last_success": None,
                "last_error": None,
                "fallback_from": fallback_from,
                "coverage": None,
                "warnings": warnings,
            }

        status = "ok" if not fallback_from else "degraded"
        return {
            "dataset": dataset,
            "status": status,
            "source": selected,
            "stale": None,
            "last_success": None,
            "last_error": None,
            "fallback_from": fallback_from,
            "coverage": None,
            "warnings": warnings,
        }

    @staticmethod
    def _source_token_status(token: str, provider_map: Dict[str, Dict[str, Any]]) -> str:
        provider_name = _REALTIME_SOURCE_PROVIDER.get(token, token)
        provider = provider_map.get(provider_name)
        if provider is None:
            if token in {"intelligence", "search"}:
                return "ok"
            return "unknown"
        return str(provider.get("status") or "unknown")

    @staticmethod
    def _unknown_dataset(dataset: str, *, warnings: Optional[List[str]] = None) -> Dict[str, Any]:
        return {
            "dataset": dataset,
            "status": "unknown",
            "source": None,
            "stale": None,
            "last_success": None,
            "last_error": None,
            "fallback_from": [],
            "coverage": None,
            "warnings": list(warnings or []),
        }

    @staticmethod
    def _local_dataset(dataset: str, source: str) -> Dict[str, Any]:
        return {
            "dataset": dataset,
            "status": "ok",
            "source": source,
            "stale": False,
            "last_success": None,
            "last_error": None,
            "fallback_from": [],
            "coverage": None,
            "warnings": [],
        }

    @staticmethod
    def _news_events_dataset() -> Dict[str, Any]:
        return {
            "dataset": "news.events",
            "status": "unknown",
            "source": "intelligence",
            "stale": None,
            "last_success": None,
            "last_error": None,
            "fallback_from": [],
            "coverage": None,
            "warnings": ["runtime_probe_not_performed"],
        }

    def _screening_dataset(self, priority: Dict[str, Any]) -> Dict[str, Any]:
        if not bool(getattr(self.config, "screening_enabled", False)):
            return {
                "dataset": "strategy.screening",
                "status": "unconfigured",
                "source": None,
                "stale": None,
                "last_success": None,
                "last_error": None,
                "fallback_from": [],
                "coverage": None,
                "warnings": ["screening_disabled"],
            }
        providers = list(priority.get("providers") or [])
        return {
            "dataset": "strategy.screening",
            "status": "ok" if providers else "unknown",
            "source": providers[0] if providers else None,
            "stale": None,
            "last_success": None,
            "last_error": None,
            "fallback_from": [],
            "coverage": None,
            "warnings": list(priority.get("warnings") or []),
        }

    def _build_global_warnings(
        self,
        provider_map: Dict[str, Dict[str, Any]],
        priorities: Sequence[Dict[str, Any]],
    ) -> List[str]:
        warnings: List[str] = []
        priority_map = {item["scenario"]: item for item in priorities}
        cn_realtime = set(priority_map.get("cn.realtime", {}).get("providers") or [])
        tickflow = provider_map.get("tickflow")
        if tickflow and tickflow.get("configured") and "tickflow" not in cn_realtime:
            warnings.append("tickflow_configured_but_not_in_realtime_priority")

        for priority in priorities:
            for warning in priority.get("warnings") or []:
                scoped = f"{priority['scenario']}:{warning}"
                if scoped not in warnings:
                    warnings.append(scoped)
        return warnings
