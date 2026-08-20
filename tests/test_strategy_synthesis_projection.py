# -*- coding: utf-8 -*-

from api.app import create_app
from api.v1.schemas.analysis import AnalysisResultResponse
from api.v1.schemas.history import ReportDetails
from api.v1.endpoints import analysis as analysis_endpoint
from api.v1.endpoints.analysis import _build_analysis_report
from src.agent.protocols import StrategyOpinion
from src.agent.skills.synthesis import StrategySynthesizer
from src.report_language import extract_strategy_synthesis_payload


def _build_synthesis():
    opinions = [
        StrategyOpinion(skill_id="trend", agent_name="Trend", signal="buy", confidence=0.8),
        StrategyOpinion(skill_id="value", agent_name="Value", signal="sell", confidence=0.9),
        StrategyOpinion(skill_id="neutral", agent_name="Neutral", signal="hold", confidence=0.5),
    ]
    return StrategySynthesizer().synthesize(
        opinions,
        weighted_score=3.6,
        final_signal="buy",
        weighted_confidence=0.75,
        conflicts=[],
        weights=[0.6, 0.3, 0.1],
    )


def test_synthesis_adds_versioned_distribution_and_deterministic_dissent():
    synthesis = _build_synthesis()

    assert synthesis["schema_version"] == "strategy-synthesis-v1"
    assert synthesis["signal_distribution"] == {
        "bullish": {"count": 1, "weight_share": 0.6},
        "neutral": {"count": 1, "weight_share": 0.1},
        "bearish": {"count": 1, "weight_share": 0.3},
    }
    assert synthesis["supporting_skills"][0]["applied_weight"] == 0.6
    assert synthesis["primary_dissent"]["skill_id"] == "value"
    assert synthesis["primary_dissent"]["applied_weight"] == 0.3


def test_report_details_extracts_only_valid_versioned_projection():
    synthesis = _build_synthesis()
    details = ReportDetails(raw_result={"dashboard": {"strategy_synthesis": synthesis}})

    assert details.strategy_synthesis is not None
    assert details.strategy_synthesis.final_signal == "buy"
    assert extract_strategy_synthesis_payload(
        {"dashboard": {"strategy_synthesis": {"final_signal": "buy"}}}
    ) == {}


def test_invalid_or_legacy_synthesis_is_hidden_from_public_field():
    details = ReportDetails(
        strategy_synthesis={"schema_version": "unknown"},
        raw_result={"strategy_synthesis": {"final_signal": "hold"}},
    )

    assert details.strategy_synthesis is None


def test_typed_projection_filters_malformed_collection_items_via_shared_normalizer():
    synthesis = _build_synthesis()
    synthesis["supporting_skills"].append("malformed")
    synthesis["opposing_skills"].append(None)
    synthesis["conflicts"].append(["malformed"])

    projected = extract_strategy_synthesis_payload(
        {"dashboard": {"strategy_synthesis": synthesis}}
    )

    assert len(projected["supporting_skills"]) == 1
    assert len(projected["opposing_skills"]) == 2
    assert projected["conflicts"] == []


def test_analysis_report_builder_exposes_typed_projection_from_raw_dashboard():
    report = _build_analysis_report(
        report_data={
            "meta": {},
            "summary": {},
            "strategy": {},
            "details": {
                "raw_result": {"dashboard": {"strategy_synthesis": _build_synthesis()}},
            },
        },
        query_id="strategy-projection",
        stock_code="600519",
        stock_name="贵州茅台",
        context_snapshot=None,
        fallback_fundamental_payload=None,
    )

    assert report.details is not None
    assert report.details.strategy_synthesis is not None
    assert report.details.strategy_synthesis.schema_version == "strategy-synthesis-v1"


def test_zero_effective_weight_uses_null_shares_and_insufficient_consensus():
    opinions = [
        StrategyOpinion(skill_id="a", signal="hold", confidence=0.0),
        StrategyOpinion(skill_id="b", signal="hold", confidence=0.0),
    ]
    synthesis = StrategySynthesizer().synthesize(
        opinions,
        weighted_score=3.0,
        final_signal="hold",
        weighted_confidence=0.0,
        conflicts=[],
        insufficient_evidence=True,
        weights=[0.0, 0.0],
    )

    assert synthesis["consensus_level"] == "insufficient"
    assert all(
        bucket["weight_share"] is None
        for bucket in synthesis["signal_distribution"].values()
    )


def test_primary_dissent_tie_break_is_stable_and_absent_without_opposition():
    tied = [
        StrategyOpinion(skill_id="beta", signal="sell", confidence=0.8),
        StrategyOpinion(skill_id="alpha", signal="sell", confidence=0.8),
        StrategyOpinion(skill_id="trend", signal="buy", confidence=0.8),
    ]
    synthesis = StrategySynthesizer().synthesize(
        tied,
        weighted_score=3.6,
        final_signal="buy",
        weighted_confidence=0.8,
        conflicts=[],
        weights=[0.2, 0.2, 0.6],
    )
    aligned = StrategySynthesizer().synthesize(
        [
            StrategyOpinion(skill_id="a", signal="buy", confidence=0.8),
            StrategyOpinion(skill_id="b", signal="strong_buy", confidence=0.7),
        ],
        weighted_score=4.2,
        final_signal="buy",
        weighted_confidence=0.75,
        conflicts=[],
        weights=[0.6, 0.4],
    )

    assert synthesis["primary_dissent"]["skill_id"] == "alpha"
    assert aligned["primary_dissent"] is None


def test_invalid_preferred_candidate_falls_back_to_valid_raw_projection():
    valid = _build_synthesis()
    invalid = {**valid, "final_signal": "invalid"}
    details = ReportDetails(
        strategy_synthesis=invalid,
        raw_result={"dashboard": {"strategy_synthesis": valid}},
    )

    assert details.strategy_synthesis is not None
    assert details.strategy_synthesis.final_signal == "buy"


def test_in_memory_report_enrichment_projects_raw_synthesis():
    synthesis = _build_synthesis()
    report = analysis_endpoint._ensure_report_action_fields(
        {
            "meta": {},
            "summary": {},
            "details": {"raw_result": {"dashboard": {"strategy_synthesis": synthesis}}},
        }
    )

    assert report["details"]["strategy_synthesis"]["schema_version"] == "strategy-synthesis-v1"


def test_openapi_schema_exposes_typed_strategy_synthesis():
    schema = ReportDetails.model_json_schema()

    assert "strategy_synthesis" in schema["properties"]
    assert "StrategySynthesis" in str(schema)


def test_analysis_endpoints_openapi_exposes_typed_strategy_synthesis():
    openapi = create_app().openapi()
    schemas = openapi["components"]["schemas"]

    analysis_result = schemas["AnalysisResultResponse"]
    report_schema = analysis_result["properties"]["report"]
    assert "AnalysisReport" in str(report_schema)

    analysis_report = schemas["AnalysisReport"]
    assert "ReportDetails" in str(analysis_report["properties"]["details"])
    assert "StrategySynthesis" in str(
        schemas["ReportDetails"]["properties"]["strategy_synthesis"]
    )

    analyze_responses = openapi["paths"]["/api/v1/analysis/analyze"]["post"]["responses"]
    assert "AnalysisResultResponse" in str(analyze_responses["200"])

    status_responses = openapi["paths"]["/api/v1/analysis/status/{task_id}"]["get"][
        "responses"
    ]
    assert "TaskStatus" in str(status_responses["200"])
    assert "AnalysisResultResponse" in str(schemas["TaskStatus"]["properties"]["result"])


def test_typed_report_schema_preserves_legacy_runtime_dict_contract():
    report = {
        "meta": {"query_id": "q", "stock_code": "600519"},
        "summary": {},
        "details": {"strategy_synthesis": _build_synthesis()},
        "legacy_extension": {"kept": True},
    }

    response = AnalysisResultResponse(
        query_id="q",
        stock_code="600519",
        report=report,
        created_at="2026-08-20T00:00:00",
    )

    assert isinstance(response.report, dict)
    assert response.report["legacy_extension"] == {"kept": True}
