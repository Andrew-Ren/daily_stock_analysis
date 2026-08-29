# -*- coding: utf-8 -*-
"""Regression tests for provenance-aware screening explanations."""

from src.services.screening_service import _attach_candidate_explanations


def test_real_zero_quote_change_is_preserved_as_observed_evidence() -> None:
    candidate = {
        "rank": 1,
        "reason": "通过价值和流动性筛选",
        "factor_scores": {"value": 90.0},
        "dsa_context": {"quote": {"change_pct": 0.0}},
        "dsa_news": [],
        "dsa_events": [],
        "llm_catalysts": [],
    }

    result = _attach_candidate_explanations(candidate)

    quote_item = next(item for item in result["why_now"] if item["code"] == "quote_change_pct")
    assert quote_item["value"] == 0.0
    assert quote_item["quality"] == "observed"
    assert result["explanation_quality"]["why_now"] == "ok"


def test_top_level_zero_without_quote_provenance_is_not_presented_as_current_evidence() -> None:
    candidate = {
        "rank": 2,
        "reason": "本地因子入选",
        "change_pct": 0.0,
        "amount": 0.0,
        "factor_scores": {},
        "dsa_context": {},
        "dsa_news": [],
        "dsa_events": [],
        "llm_catalysts": [],
    }

    result = _attach_candidate_explanations(candidate)

    assert [item["code"] for item in result["why_now"]] == ["awaiting_evidence"]
    assert result["explanation_quality"]["why_now"] == "unknown"


def test_local_selection_explanation_survives_without_llm_output() -> None:
    candidate = {
        "rank": 3,
        "reason": "",
        "factor_scores": {"quality": 88.0, "value": 91.0},
        "dsa_context": {},
        "dsa_news": [],
        "dsa_events": [],
    }

    result = _attach_candidate_explanations(candidate)

    assert result["why_selected"][0]["code"] == "top_factors"
    assert "value 91.0" in result["why_selected"][0]["text"]
    assert result["explanation_quality"]["why_selected"] == "ok"


def test_llm_reason_does_not_replace_the_observed_local_selection_fallback() -> None:
    candidate = {
        "rank": 4,
        "reason": "模型认为催化充足",
        "llm_thesis": "模型认为催化充足",
        "factor_scores": {},
        "dsa_context": {},
        "dsa_news": [],
        "dsa_events": [],
    }

    result = _attach_candidate_explanations(candidate)

    assert [item["quality"] for item in result["why_selected"]] == ["inferred", "observed"]
    assert result["why_selected"][1]["code"] == "selection_rank"
    assert result["explanation_quality"]["why_selected"] == "partial"


def test_distinct_llm_ranking_reason_stays_inferred_and_keeps_rank_fallback() -> None:
    candidate = {
        "rank": 5,
        "reason": "LLM ranking reason",
        "ranking_reason": "LLM ranking reason",
        "llm_thesis": "A different, longer thesis",
        "factor_scores": {},
        "dsa_context": {},
        "dsa_news": [],
        "dsa_events": [],
    }

    result = _attach_candidate_explanations(candidate)

    assert [item["quality"] for item in result["why_selected"]] == ["inferred", "observed"]
    assert result["why_selected"][1]["code"] == "selection_rank"


def test_news_and_events_without_provenance_are_not_observed() -> None:
    candidate = {
        "rank": 6,
        "reason": "local reason",
        "factor_scores": {},
        "dsa_context": {},
        "dsa_news": [{"title": "Unattributed headline", "url": "https://example.test/news"}],
        "dsa_events": [{"title": "Unattributed event"}],
    }

    result = _attach_candidate_explanations(candidate)

    assert [item["code"] for item in result["why_now"]] == ["awaiting_evidence"]
    assert result["explanation_quality"]["why_now"] == "unknown"
