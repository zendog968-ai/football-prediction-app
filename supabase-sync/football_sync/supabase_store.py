from __future__ import annotations

import json
from typing import Any

from supabase import Client, create_client

from football_sync.config import Settings

RECOMMENDATION_METADATA_PREFIX = "\n[AURELIA_META]"
# The deployed legacy table is varchar(50), despite newer environments sometimes
# allowing a longer recommendation value.  Do not rely on the larger capacity.
RECOMMENDATION_METADATA_MAX_LENGTH = 50


def _selection_key(value: str) -> str:
    return value.strip().lower()


def fixture_to_existing_schema(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "fixture_id": row["api_fixture_id"],
        "league_name": row.get("league_name"),
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
    """Map a prediction without turning legacy recommendation text into advice.

    Q4 metadata is deliberately compact because the deployed column is varchar(50):
    ``q4`` is a versioned uncalibrated-research tuple containing
    [expected_home_goals, expected_away_goals, home_samples, away_samples, league_samples]. The
    verbose, unambiguous counterparts remain on the prediction row
    (``calibration_status``, ``research_source`` and ``data_warning``) for reports
    and formatters; no JSON is truncated to fit this legacy field.
    """
    version = str(row.get("model_version", ""))
    if version == "poisson-v4-shrink10-research":
        samples = [
            row.get("home_sample_matches"),
            row.get("away_sample_matches"),
            row.get("league_sample_matches"),
        ]
        if any(type(value) is not int or value < 0 for value in samples):
            raise ValueError("v4 research metadata requires verified home, away, and league sample counts")
        means = [row.get("expected_home_goals"), row.get("expected_away_goals")]
        if any(type(value) not in (int, float) or not 0.2 <= value <= 4.5 for value in means):
            raise ValueError("v4 research metadata requires verified expected goals")
        # q4 can never mean calibrated. Preserve the goal grid inputs as well as
        # sample provenance; dropping means would make cached totals/scores vanish.
        metadata_value: dict[str, Any] = {"q4": [round(value, 4) for value in means] + samples}
    else:
        # Preserve legacy row compatibility rather than asserting calibration for
        # an old output whose provenance cannot be recovered here.
        metadata_value = {
            "h": round(float(row.get("expected_home_goals") or 0), 3),
            "a": round(float(row.get("expected_away_goals") or 0), 3),
            "s": "LEGACY",
        }
    metadata = json.dumps(metadata_value, ensure_ascii=False, separators=(",", ":"))
    recommendation = f"{RECOMMENDATION_METADATA_PREFIX}{metadata}"
    if len(recommendation) > RECOMMENDATION_METADATA_MAX_LENGTH:
        raise ValueError("prediction metadata exceeds existing schema contract")
    return {
        "fixture_id": row["api_fixture_id"],
        "home_win_prob": row["home_win_probability"],
        "draw_prob": row["draw_probability"],
        "away_win_prob": row["away_win_probability"],
        "predicted_score": row["most_likely_score"],
        "recommendation": recommendation,
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
