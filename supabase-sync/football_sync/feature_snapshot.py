from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from football_sync.model_upgrade import rest_days


FINISHED = {"FT", "AET", "PEN"}


def _finished(history: list[dict[str, Any]], team_id: int) -> list[dict[str, Any]]:
    result = []
    for item in history:
        if item.get("fixture", {}).get("status", {}).get("short") not in FINISHED:
            continue
        teams, goals = item.get("teams", {}), item.get("goals", {})
        if team_id not in {teams.get("home", {}).get("id"), teams.get("away", {}).get("id")}:
            continue
        if not isinstance(goals.get("home"), int) or not isinstance(goals.get("away"), int):
            continue
        result.append(item)
    return sorted(result, key=lambda item: str(item.get("fixture", {}).get("date") or ""), reverse=True)


def _weighted_metrics(history: list[dict[str, Any]], team_id: int, *, home_only: bool | None = None) -> tuple[float | None, float | None]:
    matches = _finished(history, team_id)
    values: list[tuple[int, int]] = []
    for item in matches:
        teams, goals = item["teams"], item["goals"]
        is_home = teams.get("home", {}).get("id") == team_id
        if home_only is not None and is_home != home_only:
            continue
        values.append((goals["home"] if is_home else goals["away"], goals["away"] if is_home else goals["home"]))
        if len(values) == 5:
            break
    if not values:
        return (None, None)
    weights = [1.0, 0.82, 0.67, 0.55, 0.45][: len(values)]
    denominator = sum(weights)
    return (
        sum(value[0] * weight for value, weight in zip(values, weights)) / denominator,
        sum(value[1] * weight for value, weight in zip(values, weights)) / denominator,
    )


def _dynamic_elo(history: list[dict[str, Any]], team_id: int) -> float:
    ratings: dict[int, float] = {team_id: 1500.0}
    for item in reversed(_finished(history, team_id)):
        teams, goals = item["teams"], item["goals"]
        home_id, away_id = teams.get("home", {}).get("id"), teams.get("away", {}).get("id")
        if not isinstance(home_id, int) or not isinstance(away_id, int):
            continue
        home_rating, away_rating = ratings.get(home_id, 1500.0), ratings.get(away_id, 1500.0)
        home_expectation = 1.0 / (1.0 + 10 ** (-(home_rating + 65 - away_rating) / 400))
        home_score = 1.0 if goals["home"] > goals["away"] else 0.5 if goals["home"] == goals["away"] else 0.0
        ratings[home_id] = home_rating + 20 * (home_score - home_expectation)
        ratings[away_id] = away_rating + 20 * ((1.0 - home_score) - (1.0 - home_expectation))
    return round(ratings.get(team_id, 1500.0), 3)


def build_feature_snapshot(
    fixture: dict[str, Any],
    home_history: list[dict[str, Any]],
    away_history: list[dict[str, Any]],
    prediction: dict[str, Any],
) -> dict[str, Any]:
    kickoff_raw = fixture.get("kickoff_at")
    kickoff = datetime.fromisoformat(str(kickoff_raw).replace("Z", "+00:00")) if kickoff_raw else datetime.now(UTC)
    home_id, away_id = fixture["home_team_id"], fixture["away_team_id"]
    home_weighted = _weighted_metrics(home_history, home_id)
    away_weighted = _weighted_metrics(away_history, away_id)
    home_split = _weighted_metrics(home_history, home_id, home_only=True)
    away_split = _weighted_metrics(away_history, away_id, home_only=False)
    return {
        "fixture_id": fixture["api_fixture_id"],
        "model_version": prediction["model_version"],
        "generated_at": prediction["generated_at"],
        "home_weighted5_goals_for": home_weighted[0],
        "home_weighted5_goals_against": home_weighted[1],
        "away_weighted5_goals_for": away_weighted[0],
        "away_weighted5_goals_against": away_weighted[1],
        "home_home5_goals_for": home_split[0],
        "home_home5_goals_against": home_split[1],
        "away_away5_goals_for": away_split[0],
        "away_away5_goals_against": away_split[1],
        "home_rest_days": rest_days(home_history, home_id, kickoff),
        "away_rest_days": rest_days(away_history, away_id, kickoff),
        "home_elo": _dynamic_elo(home_history, home_id),
        "away_elo": _dynamic_elo(away_history, away_id),
        "home_xg_weighted5": None,
        "away_xg_weighted5": None,
        "xg_source_available": False,
        "dc_rho": prediction.get("dc_rho"),
        "market_implied_home": prediction.get("market_implied_home"),
        "market_implied_draw": prediction.get("market_implied_draw"),
        "market_implied_away": prediction.get("market_implied_away"),
    }
