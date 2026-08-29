# -*- coding: utf-8 -*-
"""Read-only dashboard overview schemas."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from api.v1.schemas.history import HistoryItem
from src.schemas.market_light import MarketLightSnapshot

DashboardQuality = Literal["fresh", "partial", "unavailable"]


class DashboardBlockMeta(BaseModel):
    quality: DashboardQuality
    sources: List[str] = Field(default_factory=list)
    stale: Optional[bool] = None
    limitations: List[str] = Field(default_factory=list)


class DashboardMarketData(BaseModel):
    review_count: int = 0
    latest_reviews: List[HistoryItem] = Field(default_factory=list)
    latest_snapshots: Dict[str, MarketLightSnapshot] = Field(default_factory=dict)


class DashboardMarketBlock(BaseModel):
    meta: DashboardBlockMeta
    data: DashboardMarketData = Field(default_factory=DashboardMarketData)


class DashboardPersonalData(BaseModel):
    watchlist_count: Optional[int] = None
    cached_position_count: Optional[int] = None
    active_monitor_count: Optional[int] = None


class DashboardPersonalBlock(BaseModel):
    meta: DashboardBlockMeta
    data: DashboardPersonalData = Field(default_factory=DashboardPersonalData)


class DashboardActivityData(BaseModel):
    recent_reports: List[HistoryItem] = Field(default_factory=list)
    task_stats: Dict[str, int] = Field(default_factory=dict)


class DashboardActivityBlock(BaseModel):
    meta: DashboardBlockMeta
    data: DashboardActivityData = Field(default_factory=DashboardActivityData)


class DashboardSystemData(BaseModel):
    refresh_starts_analysis: Literal[False] = False
    generated_at: str


class DashboardSystemBlock(BaseModel):
    meta: DashboardBlockMeta
    data: DashboardSystemData


class DashboardChangeItem(BaseModel):
    key: str
    label: str
    before: Optional[Any] = None
    after: Optional[Any] = None
    direction: Literal["increased", "decreased", "changed"]
    source: str
    quality: DashboardQuality


class DashboardWhatChangedData(BaseModel):
    comparison_mode: Literal["previous_completed_snapshot"] = "previous_completed_snapshot"
    current_trade_dates: Dict[str, str] = Field(default_factory=dict)
    previous_trade_dates: Dict[str, str] = Field(default_factory=dict)
    items: List[DashboardChangeItem] = Field(default_factory=list)


class DashboardWhatChangedBlock(BaseModel):
    meta: DashboardBlockMeta
    data: DashboardWhatChangedData = Field(default_factory=DashboardWhatChangedData)


class DashboardOverviewResponse(BaseModel):
    as_of: str
    market: DashboardMarketBlock
    personal: DashboardPersonalBlock
    activity: DashboardActivityBlock
    system: DashboardSystemBlock
    what_changed: DashboardWhatChangedBlock
