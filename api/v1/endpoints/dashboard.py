# -*- coding: utf-8 -*-
"""Read-only dashboard overview endpoint."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from api.v1.schemas.common import ErrorResponse
from api.v1.schemas.dashboard import DashboardOverviewResponse
from src.services.dashboard_overview_service import DashboardOverviewService
from src.services.run_diagnostics import sanitize_diagnostic_text

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get(
    "/overview",
    response_model=DashboardOverviewResponse,
    responses={500: {"model": ErrorResponse}},
    summary="Get read-only dashboard overview",
    description="Aggregate persisted and cached state without starting analysis or LLM work.",
)
def get_dashboard_overview() -> DashboardOverviewResponse:
    try:
        return DashboardOverviewResponse(**DashboardOverviewService().get_overview())
    except Exception as exc:
        sanitized = sanitize_diagnostic_text(str(exc), max_length=300) or "internal dashboard error"
        logger.error("Get dashboard overview failed: %s", sanitized)
        raise HTTPException(
            status_code=500,
            detail={"error": "internal_error", "message": "Get dashboard overview failed"},
        )
