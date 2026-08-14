from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any


FINISHED_STATUSES = {"FT", "AET", "PEN"}


class InsufficientHistory(ValueError):
    pass


@dataclass(frozen=True)
class TeamMetrics:
    matches: int
    goals_for: float
    goals_against: float


@dataclass(frozen=True)
class PoissonPrediction:
    api_fixture_id: int
    model_version: str
    generated_at: str
    home_win_probability: float
    draw_probability: float
    away_win_probability: float
    expected_home_goals: float
    expected_away_goals: float
    most_likely_score: str
    over_2_5_probability: float
    btts_probability: float
    research_lean: str
    evidence_stars: int
    data_warning: str | None

    def to_row(self) -> dict[str, Any]:
        row = asdict(self)
        row["prediction_key"] = f"{self.api_fixture_id}:{self.model_version}:{self.generated_at[:13]}"
        return row


def team_metrics(history: list[dict[str, Any]], team_id: int) -> TeamMetrics:
    goals_for: list[int] = []
    goals_against: list[int] = []
    for item in history:
        if item.get("fixture", {}).get("status", {}).get("short") not in FINISHED_STATUSES:
            continue
        teams = item.get("teams", {})
        goals = item.get("goals", {})
        home_id, away_id = teams.get("home", {}).get("id"), teams.get("away", {}).get("id")
        home_goals, away_goals = goals.get("home"), goals.get("away")
        if not isinstance(home_goals, int) or not isinstance(away_goals, int):
            continue
        if team_id == home_id:
            goals_for.append(home_goals)
            goals_against.append(away_goals)
        elif team_id == away_id:
            goals_for.append(away_goals)
            goals_against.append(home_goals)
    matches = len(goals_for)
    if matches < 3:
        raise InsufficientHistory(f"team {team_id} has only {matches} completed recent matches")
    return TeamMetrics(matches=matches, goals_for=sum(goals_for) / matches, goals_against=sum(goals_against) / matches)


def poisson_probability(k: int, mean: float) -> float:
    return math.exp(-mean) * mean**k / math.factorial(k)


def predict_fixture(fixture: dict[str, Any], home_history: list[dict[str, Any]], away_history: list[dict[str, Any]], generated_at: datetime) -> PoissonPrediction:
    home = team_metrics(home_history, fixture["home_team_id"])
    away = team_metrics(away_history, fixture["away_team_id"])
    baseline = max(0.75, (home.goals_for + home.goals_against + away.goals_for + away.goals_against) / 4)
    home_lambda = min(4.5, max(0.2, baseline * (home.goals_for / baseline) * (away.goals_against / baseline) * 1.08))
    away_lambda = min(4.5, max(0.2, baseline * (away.goals_for / baseline) * (home.goals_against / baseline)))
    grid = {(h, a): poisson_probability(h, home_lambda) * poisson_probability(a, away_lambda) for h in range(0, 9) for a in range(0, 9)}
    normalizer = sum(grid.values())
    grid = {score: probability / normalizer for score, probability in grid.items()}
    home_win = sum(probability for (h, a), probability in grid.items() if h > a)
    draw = sum(probability for (h, a), probability in grid.items() if h == a)
    away_win = sum(probability for (h, a), probability in grid.items() if h < a)
    likely_score = max(grid, key=grid.get)
    over_2_5 = sum(probability for (h, a), probability in grid.items() if h + a >= 3)
    btts = sum(probability for (h, a), probability in grid.items() if h > 0 and a > 0)
    labels = [("主隊傾向", home_win), ("和局傾向", draw), ("客隊傾向", away_win)]
    lean, top_probability = max(labels, key=lambda value: value[1])
    sample = min(home.matches, away.matches)
    evidence_stars = 5 if sample >= 10 else 4 if sample >= 8 else 3 if sample >= 6 else 2
    warning = None if sample >= 6 else "歷史樣本偏少；輸出僅作低證據研究參考。"
    return PoissonPrediction(
        api_fixture_id=fixture["api_fixture_id"],
        model_version="poisson-v1-research",
        generated_at=generated_at.isoformat(),
        home_win_probability=round(home_win, 6),
        draw_probability=round(draw, 6),
        away_win_probability=round(away_win, 6),
        expected_home_goals=round(home_lambda, 4),
        expected_away_goals=round(away_lambda, 4),
        most_likely_score=f"{likely_score[0]}-{likely_score[1]}",
        over_2_5_probability=round(over_2_5, 6),
        btts_probability=round(btts, 6),
        research_lean=lean,
        evidence_stars=evidence_stars,
        data_warning=warning,
    )
