# -*- coding: utf-8 -*-
"""Repository and API contract tests for shared calendar events."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

import src.auth as auth
from api.app import create_app
from src.config import Config
from src.repositories.calendar_event_repo import CalendarEventRepository
from src.storage import DatabaseManager


def _reset_auth_globals() -> None:
    auth._auth_enabled = None
    auth._session_secret = None
    auth._password_hash_salt = None
    auth._password_hash_stored = None
    auth._rate_limit = {}


class CalendarEventApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        _reset_auth_globals()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "calendar.db"
        os.environ["DATABASE_PATH"] = str(self.db_path)
        os.environ["ADMIN_AUTH_ENABLED"] = "false"
        Config.reset_instance()
        DatabaseManager.reset_instance()
        self.app = create_app(static_dir=Path(self.temp_dir.name) / "empty-static")
        self.client = TestClient(self.app)
        self.repo = CalendarEventRepository()

    def tearDown(self) -> None:
        DatabaseManager.reset_instance()
        Config.reset_instance()
        os.environ.pop("DATABASE_PATH", None)
        os.environ.pop("ADMIN_AUTH_ENABLED", None)
        self.temp_dir.cleanup()
        _reset_auth_globals()

    def _create(self, **overrides: object) -> dict:
        payload = {
            "title": "AAPL earnings",
            "event_type": "earnings",
            "scope_type": "symbol",
            "scope_value": "ignored-by-normalization",
            "market": "us",
            "symbol": "AAPL",
            "event_date": (date.today() + timedelta(days=2)).isoformat(),
            "description": "User reminder",
            "metadata": {"confidence": "user_confirmed"},
        }
        payload.update(overrides)
        response = self.client.post("/api/v1/calendar/events", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_create_normalizes_scope_and_persists_metadata(self) -> None:
        created = self._create()

        self.assertEqual(created["scope_value"], "AAPL")
        self.assertEqual(created["source"], "user")
        self.assertEqual(created["coverage_status"], "confirmed")
        self.assertEqual(created["metadata"], {"confidence": "user_confirmed"})
        stored = self.repo.get_event(created["id"])
        self.assertIsNotNone(stored)
        self.assertEqual(stored.symbol, "AAPL")

    def test_default_window_is_seven_dates_and_coverage_is_explicit(self) -> None:
        self._create(title="today", event_date=date.today().isoformat())
        self._create(title="day six", event_date=(date.today() + timedelta(days=6)).isoformat())
        self._create(title="day seven", event_date=(date.today() + timedelta(days=7)).isoformat())

        response = self.client.get("/api/v1/calendar/events")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        self.assertEqual(payload["start_date"], date.today().isoformat())
        self.assertEqual(payload["end_date"], (date.today() + timedelta(days=6)).isoformat())
        self.assertEqual(payload["coverage"]["status"], "manual_only")
        self.assertFalse(payload["coverage"]["external_sources_configured"])
        self.assertIn("not configured", payload["coverage"]["message"])

    def test_shared_query_supports_mixed_scopes_and_exact_symbol_filter(self) -> None:
        start = date.today()
        end = start + timedelta(days=10)
        aapl = self._create(event_date=(start + timedelta(days=1)).isoformat())
        self._create(
            title="Market CPI",
            event_type="macro",
            scope_type="market",
            scope_value=None,
            market="us",
            symbol=None,
            event_date=(start + timedelta(days=2)).isoformat(),
        )
        self._create(
            title="Portfolio review",
            event_type="user",
            scope_type="portfolio",
            scope_value="account-1",
            market=None,
            symbol=None,
            event_date=(start + timedelta(days=3)).isoformat(),
        )

        all_events = self.client.get(
            "/api/v1/calendar/events",
            params={"start_date": start.isoformat(), "end_date": end.isoformat()},
        ).json()
        symbol_events = self.client.get(
            "/api/v1/calendar/events",
            params={
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "symbol": "aapl",
            },
        ).json()

        self.assertEqual(all_events["total"], 3)
        self.assertEqual(symbol_events["total"], 1)
        self.assertEqual(symbol_events["items"][0]["id"], aapl["id"])

    def test_symbol_aliases_share_one_canonical_calendar_identity(self) -> None:
        start = date.today()
        end = start + timedelta(days=10)
        hk_event = self._create(
            title="Tencent earnings",
            market="hk",
            symbol="00700",
            event_date=(start + timedelta(days=1)).isoformat(),
        )
        cn_event = self._create(
            title="Moutai earnings",
            market="cn",
            symbol="600519.SH",
            event_date=(start + timedelta(days=2)).isoformat(),
        )

        self.assertEqual(hk_event["symbol"], "HK00700")
        self.assertEqual(hk_event["scope_value"], "HK00700")
        self.assertEqual(cn_event["symbol"], "600519")
        self.assertEqual(cn_event["scope_value"], "600519")

        for alias, expected_id in (
            ("00700", hk_event["id"]),
            ("00700.HK", hk_event["id"]),
            ("HK00700", hk_event["id"]),
            ("600519", cn_event["id"]),
        ):
            response = self.client.get(
                "/api/v1/calendar/events",
                params={
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "symbol": alias,
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual([item["id"] for item in response.json()["items"]], [expected_id])

    def test_default_window_clamps_at_date_max(self) -> None:
        response = self.client.get(
            "/api/v1/calendar/events",
            params={"start_date": date.max.isoformat()},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["start_date"], date.max.isoformat())
        self.assertEqual(response.json()["end_date"], date.max.isoformat())

    def test_repository_range_and_pagination_do_not_depend_on_ui_state(self) -> None:
        start = date.today()
        for offset in range(3):
            self._create(title=f"event-{offset}", event_date=(start + timedelta(days=offset)).isoformat())

        first_page, total = self.repo.list_events(
            start_date=start,
            end_date=start + timedelta(days=2),
            page=1,
            page_size=2,
        )
        second_page, second_total = self.repo.list_events(
            start_date=start,
            end_date=start + timedelta(days=2),
            page=2,
            page_size=2,
        )

        self.assertEqual(total, 3)
        self.assertEqual(second_total, 3)
        self.assertEqual([row.title for row in first_page], ["event-0", "event-1"])
        self.assertEqual([row.title for row in second_page], ["event-2"])

    def test_scope_validation_rejects_incomplete_contracts(self) -> None:
        invalid_payloads = [
            {"scope_type": "market", "market": None, "symbol": None, "scope_value": None},
            {"scope_type": "symbol", "market": "us", "symbol": None, "scope_value": None},
            {"scope_type": "portfolio", "market": None, "symbol": None, "scope_value": None},
        ]
        for overrides in invalid_payloads:
            with self.subTest(scope_type=overrides["scope_type"]):
                payload = {
                    "title": "invalid",
                    "event_type": "user",
                    "event_date": date.today().isoformat(),
                    **overrides,
                }
                response = self.client.post("/api/v1/calendar/events", json=payload)
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(response.json()["error"], "validation_error")

    def test_non_finite_metadata_is_rejected_before_persistence(self) -> None:
        event_date = date.today().isoformat()
        response = self.client.post(
            "/api/v1/calendar/events",
            content=(
                '{"title":"invalid metadata","event_type":"user",'
                '"scope_type":"symbol","market":"us","symbol":"AAPL",'
                f'"event_date":"{event_date}","metadata":{{"value":1e400}}}}'
            ),
            headers={"Content-Type": "application/json"},
        )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["error"], "validation_error")
        rows, total = self.repo.list_events(
            start_date=date.today(),
            end_date=date.today(),
            page=1,
            page_size=100,
        )
        self.assertEqual(rows, [])
        self.assertEqual(total, 0)

    def test_legacy_non_finite_metadata_does_not_break_listing(self) -> None:
        event = self.repo.create_event({
            "title": "legacy invalid metadata",
            "event_type": "user",
            "scope_type": "symbol",
            "scope_value": "AAPL",
            "market": "us",
            "symbol": "AAPL",
            "event_date": date.today(),
            "source": "user",
            "coverage_status": "confirmed",
            "payload": '{"value":Infinity}',
        })

        response = self.client.get("/api/v1/calendar/events")

        self.assertEqual(response.status_code, 200, response.text)
        item = next(item for item in response.json()["items"] if item["id"] == event.id)
        self.assertEqual(item["metadata"], {})

    def test_delete_is_limited_to_user_events(self) -> None:
        created = self._create()
        deleted = self.client.delete(f"/api/v1/calendar/events/{created['id']}")
        missing = self.client.delete(f"/api/v1/calendar/events/{created['id']}")

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"deleted": 1})
        self.assertEqual(missing.status_code, 404)

        external = self.repo.create_event(
            {
                "title": "Vendor event",
                "event_type": "dividend",
                "scope_type": "symbol",
                "scope_value": "AAPL",
                "market": "us",
                "symbol": "AAPL",
                "event_date": date.today(),
                "source": "vendor",
                "coverage_status": "confirmed",
                "payload": "{}",
            }
        )
        refused = self.client.delete(f"/api/v1/calendar/events/{external.id}")
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json()["error"], "validation_error")

    def test_static_openapi_matches_calendar_runtime_contract(self) -> None:
        static_spec = json.loads(
            (Path(__file__).resolve().parents[1] / "docs" / "architecture" / "api_spec.json").read_text(
                encoding="utf-8"
            )
        )
        runtime_spec = self.app.openapi()
        for api_path in ("/api/v1/calendar/events", "/api/v1/calendar/events/{event_id}"):
            self.assertEqual(static_spec["paths"][api_path], runtime_spec["paths"][api_path])
        for schema_name in (
            "CalendarCoverageSummary",
            "CalendarEventCreateRequest",
            "CalendarEventDeleteResponse",
            "CalendarEventItem",
            "CalendarEventListResponse",
        ):
            self.assertEqual(
                static_spec["components"]["schemas"][schema_name],
                runtime_spec["components"]["schemas"][schema_name],
            )


if __name__ == "__main__":
    unittest.main()
