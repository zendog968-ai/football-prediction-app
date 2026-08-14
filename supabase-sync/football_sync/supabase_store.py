from __future__ import annotations

from typing import Any

from supabase import Client, create_client

from football_sync.config import Settings


class SupabaseStore:
    def __init__(self, client: Client):
        self.client = client

    @classmethod
    def from_settings(cls, settings: Settings) -> "SupabaseStore":
        if not settings.supabase_url or not settings.supabase_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required unless --dry-run is used")
        return cls(create_client(settings.supabase_url, settings.supabase_key))

    def upsert_fixtures(self, rows: list[dict[str, Any]]) -> None:
        self.client.table("fixtures").upsert(rows, on_conflict="api_fixture_id").execute()

    def insert_odds_snapshots(self, rows: list[dict[str, Any]]) -> None:
        self.client.table("odds_snapshots").upsert(
            rows,
            on_conflict="api_fixture_id,bookmaker_id,market_code,selection,captured_at",
            returning="minimal",
        ).execute()

    def upsert_predictions(self, rows: list[dict[str, Any]]) -> None:
        self.client.table("ai_predictions").upsert(rows, on_conflict="prediction_key").execute()
