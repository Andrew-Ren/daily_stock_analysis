# -*- coding: utf-8 -*-
"""Tests for shared EntityLink helpers."""

from __future__ import annotations

import pytest

from api.v1.schemas.entity_link import EntityAction, EntityLink
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


def test_direct_entity_action_construction_defaults_to_unavailable() -> None:
    action = EntityAction(action="view")

    assert action.href is None
    assert action.available is False


def test_available_entity_action_requires_a_route() -> None:
    with pytest.raises(ValueError, match="requires a non-empty href"):
        EntityAction(action="view", available=True)

    action = EntityAction(action="view", available=True, href="/stocks/600519")
    assert action.href == "/stocks/600519"


def test_entity_links_must_match_available_actions() -> None:
    action = EntityAction(action="view", available=True, href="/stocks/600519")
    valid = EntityLink(
        entity_type="stock",
        entity_id="CN:600519",
        ref="stock:CN:600519",
        actions=[action],
        links={"view": "/stocks/600519"},
    )
    assert valid.links == {"view": "/stocks/600519"}

    with pytest.raises(ValueError, match="exactly match"):
        EntityLink(
            entity_type="stock",
            entity_id="CN:600519",
            ref="stock:CN:600519",
            actions=[action],
            links={"watch": "/"},
        )


def test_entity_link_builder_deduplicates_actions_in_first_seen_order() -> None:
    payload = build_entity_link(
        "report",
        "1",
        actions=["view", "view", "track_outcome", "view"],
    )
    link = EntityLink.model_validate(payload)

    assert [action.action for action in link.actions] == ["view", "track_outcome"]


def test_entity_link_builder_rejects_values_outside_the_shared_schema() -> None:
    with pytest.raises(ValueError, match="unsupported entity_type"):
        build_entity_link("unknown", "1")
    with pytest.raises(ValueError, match="unsupported entity action"):
        build_entity_link("report", "1", actions=["view", "launch"])


def test_stock_entity_link_metadata_uses_canonical_entity_id_code() -> None:
    hk_link = EntityLink.model_validate(build_stock_entity_link("00700", market="hk"))
    us_link = EntityLink.model_validate(build_stock_entity_link("aapl", market="us"))

    assert hk_link.entity_id == "HK:HK00700"
    assert hk_link.metadata["stock_code"] == "HK00700"
    assert us_link.entity_id == "US:AAPL"
    assert us_link.metadata["stock_code"] == "AAPL"


def test_generic_stock_builder_uses_the_same_canonical_identity_path() -> None:
    generic = EntityLink.model_validate(build_entity_link("stock", "600519"))
    specific = EntityLink.model_validate(build_stock_entity_link("600519"))

    assert generic.entity_id == "CN:600519"
    assert generic.ref == specific.ref == "stock:CN:600519"


def test_us_index_canonical_symbols_longer_than_five_letters_are_supported() -> None:
    link = EntityLink.model_validate(build_stock_entity_link("AAICPRC", market="us"))

    assert link.entity_id == "US:AAICPRC"
    assert link.ref == "stock:US:AAICPRC"


def test_us_index_preferred_share_with_multi_letter_suffix_is_supported() -> None:
    link = EntityLink.model_validate(build_stock_entity_link("PEB.PG", market="us"))

    assert link.entity_id == "US:PEB.PG"
    assert link.ref == "stock:US:PEB.PG"


def test_entity_link_schema_rejects_contradictory_or_empty_refs() -> None:
    with pytest.raises(ValueError, match="ref must exactly match"):
        EntityLink(entity_type="stock", entity_id="CN:600519", ref="report:7")
    with pytest.raises(ValueError, match="ref must exactly match"):
        EntityLink(entity_type="stock", entity_id="CN:600519", ref="")
    with pytest.raises(ValueError, match="normalized value"):
        EntityLink(entity_type="stock", entity_id=" CN:600519 ", ref="stock:CN:600519")
    with pytest.raises(ValueError, match="canonical market-qualified"):
        EntityLink(entity_type="stock", entity_id="600519", ref="stock:600519")
    with pytest.raises(ValueError, match="canonical market-qualified"):
        EntityLink(entity_type="stock", entity_id="cn:600519", ref="stock:cn:600519")


def test_qualified_foreign_symbols_infer_one_stable_market_identity() -> None:
    assert stock_entity_id("HK00700") == "HK:HK00700"
    assert stock_entity_id("2330.TW") == "TW:2330.TW"
    assert stock_entity_id("AAPL.US") == "US:AAPL"
    with pytest.raises(ValueError, match="market conflicts"):
        stock_entity_id("HK00700", market="cn")


def test_explicit_market_canonicalizes_legacy_bare_foreign_code() -> None:
    assert stock_entity_id("8035", market="jp") == "JP:8035.T"
    assert stock_entity_id("8035", market="jp") == stock_entity_id("8035.T")


def test_unicode_width_variants_converge_to_ascii_stock_identities() -> None:
    assert stock_entity_id("６００５１９", market="cn") == "CN:600519"
    assert stock_entity_id("７００", market="hk") == "HK:HK00700"
    assert stock_entity_id("ＡＡＰＬ．ＵＳ") == "US:AAPL"
    assert make_entity_ref("stock", "CN:６００５１９") == "stock:CN:600519"
    assert make_entity_ref("stock", "ＣＮ：６００５１９") == "stock:CN:600519"
    assert build_stock_entity_link("６００５１９", market="ＣＮ")["entity_id"] == "CN:600519"


def test_non_ascii_decimal_scripts_are_rejected_after_width_normalization() -> None:
    with pytest.raises(ValueError, match="ASCII characters"):
        stock_entity_id("٦٠٠٥١٩", market="cn")


def test_invalid_unhinted_stock_identity_fails_closed() -> None:
    with pytest.raises(ValueError, match="unsupported stock_code identity"):
        stock_entity_id("not a stock!")


def test_unresolved_bare_korean_identity_requires_an_exchange_suffix() -> None:
    with pytest.raises(ValueError, match="canonical exchange-qualified"):
        stock_entity_id("999999", market="kr")

    assert stock_entity_id("999999.KS", market="kr") == "KR:999999.KS"
    assert stock_entity_id("999999.KQ", market="kr") == "KR:999999.KQ"


def test_bse_market_hint_converges_to_the_canonical_cn_identity() -> None:
    assert stock_entity_id("920748", market="BSE") == "CN:920748"
    assert stock_entity_id("920748", market="BSE") == stock_entity_id("920748.BJ")


@pytest.mark.parametrize(
    ("stock_code", "market"),
    [("600519", "us"), ("000001", "hk")],
)
def test_explicit_market_rejected_by_shared_identity_parser_fails_closed(
    stock_code: str,
    market: str,
) -> None:
    with pytest.raises(ValueError, match="incompatible"):
        stock_entity_id(stock_code, market=market)


def test_report_entity_link_can_track_outcome_through_decision_signals() -> None:
    link = EntityLink.model_validate(build_entity_link("report", "123", label="AAPL report"))

    assert link.ref == "report:123"
    actions = {item.action: item for item in link.actions}
    assert actions["track_outcome"].available is True
    assert actions["track_outcome"].href == "/decision-signals?sourceReportId=123"
    assert actions["view"].available is False


@pytest.mark.parametrize(
    ("entity_type", "entity_id"),
    [
        ("strategy", "value:quality"),
        ("signal", "42"),
        ("alert", "900"),
        ("portfolio_position", "default:AAPL"),
        ("calendar_event", "earnings:AAPL:2026-09-01"),
    ],
)
def test_actions_without_a_consumed_target_context_fail_closed(
    entity_type: str,
    entity_id: str,
) -> None:
    link = EntityLink.model_validate(build_entity_link(entity_type, entity_id))

    assert link.links == {}
    assert all(item.available is False for item in link.actions)
    assert all(item.disabled_reason for item in link.actions)


@pytest.mark.parametrize(
    "report_id",
    ["report/123", "0", "²", "١٢٣", "１２３", "9007199254740992", "9007199254740993"],
)
def test_report_tracking_requires_an_ascii_positive_source_report_id(report_id: str) -> None:
    link = EntityLink.model_validate(build_entity_link("report", report_id))

    assert link.links == {}
    action = next(item for item in link.actions if item.action == "track_outcome")
    assert action.available is False
    assert action.disabled_reason == "invalid_entity_context"


def test_entity_ref_helpers_validate_shape() -> None:
    assert make_entity_ref("signal", "42") == "signal:42"
    assert parse_entity_ref("alert:900") == ("alert", "900")
    assert stock_entity_id("00700", market="hk") == "HK:HK00700"
    assert stock_entity_id("700", market="hk") == "HK:HK00700"

    with pytest.raises(ValueError):
        make_entity_ref("stock", "")
    with pytest.raises(ValueError):
        parse_entity_ref("missing_separator")
