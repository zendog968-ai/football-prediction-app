from datetime import UTC

from football_sync.feature_snapshot import build_feature_snapshot


def _fixture(home: int, away: int, home_goals: int, away_goals: int, date: str) -> dict:
    return {
        "fixture": {"status": {"short": "FT"}, "date": date},
        "teams": {"home": {"id": home}, "away": {"id": away}},
        "goals": {"home": home_goals, "away": away_goals},
    }


def test_feature_snapshot_uses_completed_history_without_fabricating_xg() -> None:
    home_history = [_fixture(1, 8, 2, 0, "2026-08-10T12:00:00+00:00"), _fixture(7, 1, 1, 1, "2026-08-05T12:00:00+00:00")]
    away_history = [_fixture(2, 9, 0, 1, "2026-08-09T12:00:00+00:00"), _fixture(6, 2, 2, 2, "2026-08-03T12:00:00+00:00")]
    row = build_feature_snapshot(
        {"api_fixture_id": 99, "home_team_id": 1, "away_team_id": 2, "kickoff_at": "2026-08-16T12:00:00+00:00"},
        home_history,
        away_history,
        {"model_version": "dc-v1", "generated_at": "2026-08-16T00:00:00+00:00", "dc_rho": -0.04},
    )
    assert row["fixture_id"] == 99
    assert row["home_weighted5_goals_for"] is not None
    assert row["away_away5_goals_against"] is not None
    assert row["home_rest_days"] == 6.0
    assert row["home_elo"] != 1500.0
    assert row["xg_source_available"] is False
    assert row["home_xg_weighted5"] is None
