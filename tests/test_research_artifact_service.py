# -*- coding: utf-8 -*-
"""Tests for structured ResearchArtifact contract helpers."""

from __future__ import annotations

from pydantic import ValidationError
import pytest

from api.v1.schemas.research_artifact import ResearchArtifact
from src.services.research_artifact_service import build_research_artifact


def test_build_research_artifact_from_report_with_evidence_and_invalidation() -> None:
    report = {
        "meta": {
            "id": 12,
            "query_id": "q-12",
            "stock_code": "600519",
            "stock_name": "贵州茅台",
            "created_at": "2026-03-19T08:00:00",
        },
        "summary": {
            "analysis_summary": "趋势维持偏强",
            "operation_advice": "持有",
            "action": "hold",
            "action_label": "持有",
            "trend_prediction": "震荡上行",
            "sentiment_score": 72,
        },
        "strategy": {
            "stop_loss": "1680",
            "take_profit": "1880",
        },
        "details": {
            "analysis_context_pack_overview": {
                "subject": {"market": "cn"},
                "blocks": [
                    {
                        "key": "daily_price",
                        "label": "日线行情",
                        "status": "available",
                        "source": "tencent",
                        "warnings": [],
                        "missing_reasons": [],
                    },
                    {
                        "key": "news",
                        "label": "新闻",
                        "status": "partial",
                        "source": "anspire",
                        "warnings": ["partial"],
                        "missing_reasons": [],
                    },
                ],
                "data_quality": {
                    "overall_score": 83,
                    "level": "good",
                    "limitations": ["新闻覆盖有限"],
                },
            },
            "news_content": "公司新闻摘要",
        },
    }

    artifact = ResearchArtifact.model_validate(build_research_artifact(report))

    assert artifact.schema_version == "research-artifact-v1"
    assert artifact.artifact_id == "report:12"
    assert artifact.subject.stock_code == "600519"
    assert artifact.subject.market == "cn"
    assert artifact.thesis.direction == "neutral"
    assert artifact.thesis.action == "hold"
    assert artifact.data_quality.level == "good"
    assert artifact.data_quality.source_count == 3
    assert {item.id for item in artifact.evidence} == {
        "context:daily_price",
        "context:news",
        "news:summary",
    }
    assert artifact.evidence[0].freshness == "fresh"
    assert artifact.evidence[0].quality_level == "good"
    condition_ids = {item.id for item in artifact.invalidation_conditions}
    assert "price:stop_loss" in condition_ids
    assert "data_quality:limitations" in condition_ids
    assert artifact.next_actions[-1].action == "monitor_invalidation"


def test_build_research_artifact_always_includes_invalidation_conditions() -> None:
    artifact = ResearchArtifact.model_validate(build_research_artifact({
        "meta": {"query_id": "q-empty", "stock_code": "AAPL"},
        "summary": {"analysis_summary": "等待更多证据", "sentiment_score": 50},
    }))

    assert artifact.artifact_id == "report:q-empty"
    assert artifact.invalidation_conditions[0].id == "manual:thesis_reassessment"
    assert artifact.data_quality.level == "unknown"


def test_research_artifact_requires_invalidation_conditions() -> None:
    with pytest.raises(ValidationError):
        ResearchArtifact.model_validate({
            "artifact_id": "report:bad",
            "subject": {"stock_code": "AAPL"},
            "thesis": {"summary": "missing invalidation"},
            "invalidation_conditions": [],
        })
