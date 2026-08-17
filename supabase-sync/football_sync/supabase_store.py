from __future__ import annotations

import json
from typing import Any

from supabase import Client, create_client

from football_sync.config import Settings


def _selection_key(value: str) -> str:
    return value.strip().lower()


def _league_identity(name: object, country: object) -> str | None:
    league = str(name or "").strip()
    nation = str(country or "").strip()
    if not league:
        return None
    return f"{nation}::{league}" if nation else league


def fixture_to_existing_schema(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "fixture_id": row["api_fixture_id"],
        "league_name": _league_identity(row.get("league_name"), row.get("league_country")),
        "event_time": row["kickoff_at"],
        "status": row.get("status"),
        "home_team": row["home_team"],
        "away_team": row["away_team"],
        "home_score": row.get("home_goals"),
        "away_score": row.get("away_goals"),
        "updated_at": row["synced_at"],
    }


def odds_to_existing_schema(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map granular provider values into the user's pre-existing snapshot schema.

    The existing table has no bookmaker or selection columns, so those values remain
    auditable by prefixing `market_type` and preserving the exact selection in
    `handicap`. HDA values are compacted into a single three-way row per bookmaker.
    """
    hda_groups: dict[tuple[int, str], dict[str, Any]] = {}
    mapped: list[dict[str, Any]] = []
    for row in rows:
        fixture_id = row["api_fixture_id"]
        bookmaker = row["bookmaker_name"]
        market = row["market_code"]
        selection = row["selection"]
        key = _selection_key(selection)
        if market == "HDA":
            group = hda_groups.setdefault((fixture_id, bookmaker), {
                "fixture_id": fixture_id,
                "market_type": f"HDA | {bookmaker}",
                "handicap": "1X2",
                "home_odds": None,
                "draw_odds": None,
                "away_odds": None,
                "snapshot_time": row["captured_at"],
            })
            if key in {"home", "1"}:
                group["home_odds"] = row["decimal_odds"]
            elif key in {"draw", "x"}:
                group["draw_odds"] = row["decimal_odds"]
            elif key in {"away", "2"}:
                group["away_odds"] = row["decimal_odds"]
            continue
        mapped.append({
            "fixture_id": fixture_id,
            "market_type": f"{market} | {bookmaker}",
            "handicap": selection,
            "home_odds": row["decimal_odds"] if key.startswith(("home", "over")) else None,
            "draw_odds": None,
            "away_odds": row["decimal_odds"] if key.startswith(("away", "under")) else None,
            "snapshot_time": row["captured_at"],
        })
    return [*hda_groups.values(), *mapped]


def prediction_to_existing_schema(row: dict[str, Any]) -> dict[str, Any]:
    championship = "championship" in str(row.get("model_version", ""))
    legacy = str(row.get("model_version", "")).startswith("poisson-")
    metadata_payload: dict[str, Any] = {
        "h": row.get("expected_home_goals"),
        "a": row.get("expected_away_goals"),
        "s": "英冠校準" if legacy and championship else ("E" if row.get("ensemble_used") else "D"),
    }
    if not legacy and row.get("dc_rho") is not None:
        metadata_payload["r"] = row.get("dc_rho")
    metadata = json.dumps(metadata_payload, ensure_ascii=False, separators=(",", ":"))
    return {
        "fixture_id": row["api_fixture_id"],
        "home_win_prob": row["home_win_probability"],
        "draw_prob": row["draw_probability"],
        "away_win_prob": row["away_win_probability"],
        "predicted_score": row["most_likely_score"],
        "recommendation": f"\n[AURELIA_META]{metadata}",
        "confidence": row["evidence_stars"],
        "updated_at": row["generated_at"],
    }


class SupabaseStore:
    def __init__(self, client: Client):
        self.client = client

    @classmethod
    def from_settings(cls, settings: Settings) -> "SupabaseStore":
        if not settings.supabase_url or not settings.supabase_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required unless --dry-run is used")
        return cls(create_client(settings.supabase_url, settings.supabase_key))

    def upsert_fixtures(self, rows: list[dict[str, Any]]) -> None:
        self.client.table("fixtures").upsert([fixture_to_existing_schema(row) for row in rows], on_conflict="fixture_id").execute()

    def insert_odds_snapshots(self, rows: list[dict[str, Any]]) -> None:
        mapped = odds_to_existing_schema(rows)
        if mapped:
            self.client.table("odds_snapshots").insert(mapped, returning="minimal").execute()

    def upsert_predictions(self, rows: list[dict[str, Any]]) -> None:
        self.client.table("ai_predictions").upsert([prediction_to_existing_schema(row) for row in rows], on_conflict="fixture_id").execute()

    def insert_feature_snapshots(self, rows: list[dict[str, Any]]) -> None:
        if rows:
            self.client.table("model_feature_snapshots").insert(rows, returning="minimal").execute()
