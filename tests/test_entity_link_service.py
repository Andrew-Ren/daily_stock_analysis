# -*- coding: utf-8 -*-
"""Tests for shared EntityLink helpers."""

from __future__ import annotations

import pytest

from api.v1.schemas.entity_link import EntityLink
from src.services.entity_link_service import (
    build_entity_link,
    build_stock_entity_link,
    make_entity_ref,
    parse_entity_ref,
    stock_entity_id,
)


def test_stock_entity_link_uses_stable_ref_and_pending_view_route() -> None:
    payload = build_stock_entity_link("600519.SH", market="cn", stock_name="贵州茅台")
    link = EntityLink.model_validate(payload)

    assert link.entity_type == "stock"
    assert link.entity_id == "CN:600519"
    assert link.ref == "stock:CN:600519"
    assert link.label == "贵州茅台"
    assert link.metadata["stock_code"] == "600519"
    assert link.links == {}

    actions = {item.action: item for item in link.actions}
    assert actions["view"].href == "/stocks/600519"
    assert actions["view"].available is False
    assert actions["view"].disabled_reason == "stock_detail_route_pending"
    assert actions["analyze"].available is False
    assert actions["watch"].available is False
    assert actions["monitor"].available is False
    assert actions["ask_ai"].available is False
    assert actions["analyze"].disabled_reason == "stock_action_context_pending"
    assert actions["watch"].disabled_reason == "stock_action_context_pending"
    assert actions["monitor"].disabled_reason == "stock_action_context_pending"
    assert actions["ask_ai"].disabled_reason == "stock_action_context_pending"
    assert actions["monitor"].href == "/alerts"
    assert actions["monitor"].params["target_entity_ref"] == "stock:CN:600519"


def test_stock_entity_link_metadata_uses_canonical_entity_id_code() -> None:
    hk_link = EntityLink.model_validate(build_stock_entity_link("00700", market="hk"))
    us_link = EntityLink.model_validate(build_stock_entity_link("aapl", market="us"))

    assert hk_link.entity_id == "HK:HK00700"
    assert hk_link.metadata["stock_code"] == "HK00700"
    assert us_link.entity_id == "US:AAPL"
    assert us_link.metadata["stock_code"] == "AAPL"


def test_report_entity_link_can_track_outcome_through_decision_signals() -> None:
    link = EntityLink.model_validate(build_entity_link("report", "123", label="AAPL report"))

    assert link.ref == "report:123"
    actions = {item.action: item for item in link.actions}
    assert actions["track_outcome"].available is True
    assert actions["track_outcome"].href == "/decision-signals"
    assert actions["view"].available is False


def test_entity_ref_helpers_validate_shape() -> None:
    assert make_entity_ref("signal", "42") == "signal:42"
    assert parse_entity_ref("alert:900") == ("alert", "900")
    assert stock_entity_id("00700", market="hk") == "HK:HK00700"

    with pytest.raises(ValueError):
        make_entity_ref("stock", "")
    with pytest.raises(ValueError):
        parse_entity_ref("missing_separator")
