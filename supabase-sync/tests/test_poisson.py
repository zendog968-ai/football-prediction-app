from datetime import UTC, datetime

import pytest

from football_sync.config import POPULAR_LEAGUE_IDS
from football_sync.poisson import InsufficientHistory, predict_fixture, team_metrics


def finished_fixture(home_id: int, away_id: int, home_goals: int, away_goals: int, *, league_id: int = 39, season: int = 2026) -> dict:
    return {
        "fixture": {"status": {"short": "FT"}},
        "league": {"id": league_id, "season": season},
        "teams": {"home": {"id": home_id}, "away": {"id": away_id}},
        "goals": {"home": home_goals, "away": away_goals},
    }


def test_poisson_prediction_is_normalized_and_research_only() -> None:
    home_history = [finished_fixture(1, 9, 2, 1), finished_fixture(9, 1, 0, 1), finished_fixture(1, 8, 3, 0)]
    away_history = [finished_fixture(2, 7, 1, 1), finished_fixture(7, 2, 2, 1), finished_fixture(2, 6, 0, 0)]
    fixture = {"api_fixture_id": 123, "home_team_id": 1, "away_team_id": 2, "league_id": 39, "season": 2026}
    prediction = predict_fixture(fixture, home_history, away_history, datetime(2026, 8, 14, tzinfo=UTC))
    assert prediction.home_win_probability + prediction.draw_probability + prediction.away_win_probability == pytest.approx(1, abs=1e-6)
    assert prediction.research_lean in {"主隊傾向", "和局傾向", "客隊傾向"}
    assert 1 <= prediction.evidence_stars <= 2
    assert prediction.data_warning is not None
    assert "未校準Poisson" in prediction.data_warning
    assert len(prediction.top_scorelines) == 3
    assert prediction.top_scorelines[0]["probability"] >= prediction.top_scorelines[1]["probability"]


def test_insufficient_real_history_stops_prediction() -> None:
    with pytest.raises(InsufficientHistory):
        team_metrics([finished_fixture(1, 2, 1, 0)], 1, league_id=39, season=2026)


def test_j1_two_match_basic_history_produces_explicit_low_evidence_poisson() -> None:
    assert 98 in POPULAR_LEAGUE_IDS
    home_history = [
        finished_fixture(1, 9, 2, 1, league_id=98),
        finished_fixture(8, 1, 0, 1, league_id=98),
    ]
    away_history = [
        finished_fixture(2, 7, 1, 1, league_id=98),
        finished_fixture(6, 2, 2, 1, league_id=98),
    ]
    fixture = {"api_fixture_id": 98001, "home_team_id": 1, "away_team_id": 2, "league_id": 98, "season": 2026}
    prediction = predict_fixture(fixture, home_history, away_history, datetime(2026, 8, 15, tzinfo=UTC))
    assert prediction.model_version == "poisson-v2-basic-league-research"
    assert prediction.evidence_stars == 1
    assert prediction.data_warning is not None and "基礎Poisson" in prediction.data_warning


def test_other_competitions_cannot_fill_same_league_history() -> None:
    history = [
        finished_fixture(1, 9, 2, 1, league_id=39),
        finished_fixture(1, 8, 4, 0, league_id=140),
        finished_fixture(7, 1, 0, 3, league_id=140),
    ]
    with pytest.raises(InsufficientHistory):
        team_metrics(history, 1, league_id=39, season=2026)
