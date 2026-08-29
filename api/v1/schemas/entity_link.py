# -*- coding: utf-8 -*-
"""Shared entity link and action schemas."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


EntityType = Literal[
    "stock",
    "index",
    "sector",
    "concept",
    "strategy",
    "report",
    "signal",
    "alert",
    "portfolio_position",
    "calendar_event",
]
EntityActionType = Literal[
    "view",
    "analyze",
    "watch",
    "monitor",
    "ask_ai",
    "compare",
    "track_outcome",
]


class EntityAction(BaseModel):
    """One user action that can be rendered for an entity."""

    action: EntityActionType
    label: str = Field("", description="Display label. Clients may localize by action.")
    href: Optional[str] = Field(None, description="Optional frontend route")
    available: bool = Field(False, description="Whether this action is currently usable")
    disabled_reason: Optional[str] = Field(None, description="Stable reason when available=false")
    params: Dict[str, Any] = Field(default_factory=dict, description="Opaque action parameters")


class EntityLink(BaseModel):
    """Stable cross-page reference to a business entity."""

    entity_type: EntityType
    entity_id: str = Field(..., min_length=1)
    ref: str = Field(..., description="Stable ref in the form '<entity_type>:<entity_id>'")
    label: str = ""
    links: Dict[str, str] = Field(default_factory=dict, description="Named frontend routes")
    actions: List[EntityAction] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_stable_ref(self) -> "EntityLink":
        normalized_id = self.entity_id.strip()
        if not normalized_id or normalized_id != self.entity_id:
            raise ValueError("entity_id must be a non-empty normalized value")
        expected_ref = f"{self.entity_type}:{normalized_id}"
        if self.ref != expected_ref:
            raise ValueError("ref must exactly match entity_type and entity_id")
        return self
