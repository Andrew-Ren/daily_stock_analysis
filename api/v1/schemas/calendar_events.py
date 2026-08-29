# -*- coding: utf-8 -*-
"""Shared calendar event API schemas."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

CalendarEventType = Literal["earnings", "dividend", "lockup_unlock", "macro", "user", "monitor"]
CalendarScopeType = Literal["market", "symbol", "portfolio", "sector", "custom"]
CalendarMarket = Literal["cn", "hk", "us", "jp", "kr", "tw", "global"]


class CalendarEventCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    event_type: CalendarEventType
    scope_type: CalendarScopeType
    scope_value: Optional[str] = Field(None, max_length=128)
    market: Optional[CalendarMarket] = None
    symbol: Optional[str] = Field(None, max_length=32)
    event_date: date
    description: Optional[str] = Field(None, max_length=2000)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class CalendarEventItem(BaseModel):
    id: int
    title: str
    event_type: str
    scope_type: str
    scope_value: Optional[str] = None
    market: Optional[str] = None
    symbol: Optional[str] = None
    event_date: str
    source: str
    coverage_status: str
    description: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CalendarCoverageSummary(BaseModel):
    status: Literal["manual_only"]
    external_sources_configured: bool
    message: str


class CalendarEventListResponse(BaseModel):
    items: List[CalendarEventItem] = Field(default_factory=list)
    total: int
    page: int
    page_size: int
    start_date: str
    end_date: str
    coverage: CalendarCoverageSummary


class CalendarEventDeleteResponse(BaseModel):
    deleted: int
