# -*- coding: utf-8 -*-
"""Shared calendar event endpoints."""

from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Path, Query

from api.v1.schemas.calendar_events import (
    CalendarEventCreateRequest,
    CalendarEventDeleteResponse,
    CalendarEventItem,
    CalendarEventListResponse,
    CalendarMarket,
    CalendarScopeType,
)
from api.v1.schemas.common import ErrorResponse
from src.services.calendar_event_service import (
    CALENDAR_EVENT_MAX_ID,
    CALENDAR_EVENT_MAX_PAGE,
    CalendarEventService,
    CalendarEventServiceError,
)
from src.services.run_diagnostics import sanitize_diagnostic_text

logger = logging.getLogger(__name__)
router = APIRouter()


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail={"error": "validation_error", "message": str(exc)})


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"error": "not_found", "message": "calendar event not found"},
    )


def _internal_error(message: str, exc: Exception) -> HTTPException:
    sanitized = sanitize_diagnostic_text(str(exc), max_length=300) or "internal calendar error"
    logger.error("%s: %s", message, sanitized)
    return HTTPException(
        status_code=500,
        detail={"error": "internal_error", "message": f"{message}: internal calendar service error"},
    )


@router.post(
    "/events",
    response_model=CalendarEventItem,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Create a user calendar event",
)
def create_event(request: CalendarEventCreateRequest) -> CalendarEventItem:
    try:
        return CalendarEventItem(
            **CalendarEventService().create_user_event(request.model_dump())
        )
    except CalendarEventServiceError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Create calendar event failed", exc)


@router.get(
    "/events",
    response_model=CalendarEventListResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="List upcoming calendar events",
    description=(
        "Shared inclusive date-range query for Dashboard and symbol consumers. "
        "Defaults to seven calendar dates starting today."
    ),
)
def list_events(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    scope_type: Optional[CalendarScopeType] = Query(None),
    scope_value: Optional[str] = Query(None, max_length=128),
    market: Optional[CalendarMarket] = Query(None),
    symbol: Optional[str] = Query(None, max_length=32),
    page: int = Query(1, ge=1, le=CALENDAR_EVENT_MAX_PAGE),
    page_size: int = Query(100, ge=1, le=100),
) -> CalendarEventListResponse:
    try:
        return CalendarEventListResponse(
            **CalendarEventService().list_events(
                start_date=start_date,
                end_date=end_date,
                scope_type=scope_type,
                scope_value=scope_value,
                market=market,
                symbol=symbol,
                page=page,
                page_size=page_size,
            )
        )
    except CalendarEventServiceError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("List calendar events failed", exc)


@router.delete(
    "/events/{event_id}",
    response_model=CalendarEventDeleteResponse,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Delete a user calendar event",
)
def delete_event(
    event_id: int = Path(..., ge=1, le=CALENDAR_EVENT_MAX_ID),
) -> CalendarEventDeleteResponse:
    try:
        if not CalendarEventService().delete_user_event(event_id):
            raise _not_found()
        return CalendarEventDeleteResponse(deleted=1)
    except HTTPException:
        raise
    except CalendarEventServiceError as exc:
        raise _bad_request(exc)
    except Exception as exc:
        raise _internal_error("Delete calendar event failed", exc)
