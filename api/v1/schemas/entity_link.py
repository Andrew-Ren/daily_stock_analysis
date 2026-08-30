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

    @model_validator(mode="after")
    def validate_available_route(self) -> "EntityAction":
        if self.available and not str(self.href or "").strip():
            raise ValueError("available entity action requires a non-empty href")
        return self


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
        if self.entity_type == "stock":
            # Import lazily to keep the schema/service import cycle dormant while
            # still enforcing the exact canonicalization used by every builder.
            from src.services.entity_link_service import stock_entity_id

            market, separator, stock_code = normalized_id.partition(":")
            if not separator or stock_entity_id(stock_code, market=market) != normalized_id:
                raise ValueError("stock entity_id must be a canonical market-qualified value")
        expected_ref = f"{self.entity_type}:{normalized_id}"
        if self.ref != expected_ref:
            raise ValueError("ref must exactly match entity_type and entity_id")
        action_names = [action.action for action in self.actions]
        if len(action_names) != len(set(action_names)):
            raise ValueError("entity actions must be unique by action name")
        expected_links = {
            action.action: str(action.href)
            for action in self.actions
            if action.available and action.href is not None
        }
        if self.links != expected_links:
            raise ValueError("links must exactly match available action hrefs")
        if expected_links:
            # Validate the executable contract at the public schema boundary,
            # not only in the preferred builder. Direct API producers must not
            # make pending routes or invalid entity context clickable.
            from src.services.entity_link_service import build_entity_action

            for action in self.actions:
                if not action.available:
                    continue
                expected_action = build_entity_action(
                    self.entity_type,
                    normalized_id,
                    action.action,
                )
                if (
                    not expected_action["available"]
                    or action.href != expected_action["href"]
                ):
                    raise ValueError(
                        "available entity action must match the supported route contract"
                    )
        return self
