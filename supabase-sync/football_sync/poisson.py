from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

from football_sync.quality import estimate_goals

FINISHED_STATUSES = {"FT", "AET", "PEN"}
MIN_BASIC_HISTORY = 2
RESEARCH_MODE = "poisson_research"
CALIBRATION_STATUS = "uncalibrated"
RESEARCH_SOURCE = "API-Football FT; same league/season; pre-kickoff cutoff; shrinkage prior=10"


class InsufficientHistory(ValueError):
    pass


@dataclass(frozen=True)
class TeamMetrics:
    matches: int
    goals_for: float
    goals_against: float


@dataclass(frozen=True)
class LeagueMetrics:
    matches: int
    home_goals: float
    away_goals: float


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
    top_scorelines: list[dict[str, float | str]]
    research_lean: str
    evidence_stars: int
    data_warning: str | None
    home_sample_matches: int
    away_sample_matches: int
    league_sample_matches: int | None
    research_mode: str
    calibration_status: str
    research_source: str

    def to_row(self) -> dict[str, Any]:
        row = asdict(self)
        row["prediction_key"] = f"{self.api_fixture_id}:{self.model_version}:{self.generated_at[:13]}"
        return row


def team_metrics(history: list[dict[str, Any]], team_id: int, *, league_id: int, season: int) -> TeamMetrics:
    goals_for: list[int] = []
    goals_against: list[int] = []
    for item in history:
        if item.get("fixture", {}).get("status", {}).get("short") not in FINISHED_STATUSES:
            continue
        league = item.get("league", {})
        if league.get("id") != league_id or league.get("season") != season:
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
    if matches < MIN_BASIC_HISTORY:
        raise InsufficientHistory(f"team {team_id} has only {matches} completed recent matches")
    return TeamMetrics(matches=matches, goals_for=sum(goals_for) / matches, goals_against=sum(goals_against) / matches)


def league_metrics(history: list[dict[str, Any]], *, league_id: int, season: int) -> LeagueMetrics:
    home_goals: list[int] = []
    away_goals: list[int] = []
    for item in history:
        if item.get("fixture", {}).get("status", {}).get("short") not in FINISHED_STATUSES:
            continue
        league = item.get("league", {})
        if league.get("id") != league_id or league.get("season") != season:
            continue
        home, away = item.get("goals", {}).get("home"), item.get("goals", {}).get("away")
        if isinstance(home, int) and isinstance(away, int):
            home_goals.append(home)
            away_goals.append(away)
    if len(home_goals) < 20:
        raise InsufficientHistory(f"league {league_id} has only {len(home_goals)} completed league matches")
    matches = len(home_goals)
    return LeagueMetrics(matches=matches, home_goals=sum(home_goals) / matches, away_goals=sum(away_goals) / matches)


def poisson_probability(k: int, mean: float) -> float:
    return math.exp(-mean) * mean**k / math.factorial(k)


def predict_fixture(fixture: dict[str, Any], home_history: list[dict[str, Any]], away_history: list[dict[str, Any]], generated_at: datetime, league_history: list[dict[str, Any]] | None = None) -> PoissonPrediction:
    league_id = fixture.get("league_id")
    season = fixture.get("season")
    if type(league_id) is not int or type(season) is not int or league_id <= 0 or season <= 0:
        raise InsufficientHistory("fixture is missing a verified competition or season")
    try:
        quality = estimate_goals(fixture, home_history, away_history, league_history or [], generated_at)
    except (ValueError, KeyError) as exc:
        raise InsufficientHistory(str(exc)) from exc
    home_lambda, away_lambda = quality["home_mean"], quality["away_mean"]
    grid = {(h, a): poisson_probability(h, home_lambda) * poisson_probability(a, away_lambda) for h in range(0, 25) for a in range(0, 25)}
    normalizer = sum(grid.values())
    grid = {score: probability / normalizer for score, probability in grid.items()}
    home_win = sum(probability for (h, a), probability in grid.items() if h > a)
    draw = sum(probability for (h, a), probability in grid.items() if h == a)
    away_win = sum(probability for (h, a), probability in grid.items() if h < a)
    likely_score = max(grid, key=grid.get)
    top_scores = sorted(grid.items(), key=lambda item: item[1], reverse=True)[:3]
    over_2_5 = sum(probability for (h, a), probability in grid.items() if h + a >= 3)
    btts = sum(probability for (h, a), probability in grid.items() if h > 0 and a > 0)
    labels = [("主隊傾向", home_win), ("和局傾向", draw), ("客隊傾向", away_win)]
    lean, top_probability = max(labels, key=lambda value: value[1])
    # `confidence` is a required legacy destination column.  Keep its only valid
    # neutral value rather than turn sample availability into a high-confidence
    # filter or claim.  Exact sample counts travel as separate research metadata.
    evidence_stars = 1
    warnings = [
        "未校準Poisson研究值：不是校準機率，未進行前瞻驗證；不可解讀為賠率、EV、投注或高信心建議。",
        "來源：API-Football；僅同聯賽同賽季FT完場資料，以開賽前時間截點過濾，並採10場先驗收縮。",
    ]
    return PoissonPrediction(
        api_fixture_id=fixture["api_fixture_id"],
        model_version=quality["model_version"],
        generated_at=generated_at.isoformat(),
        home_win_probability=round(home_win, 6),
        draw_probability=round(draw, 6),
        away_win_probability=round(away_win, 6),
        expected_home_goals=round(home_lambda, 4),
        expected_away_goals=round(away_lambda, 4),
        most_likely_score=f"{likely_score[0]}-{likely_score[1]}",
        over_2_5_probability=round(over_2_5, 6),
        btts_probability=round(btts, 6),
        top_scorelines=[{"score": f"{home_goals}-{away_goals}", "probability": round(probability, 6)} for (home_goals, away_goals), probability in top_scores],
        research_lean=lean,
        evidence_stars=evidence_stars,
        data_warning=" ".join(warnings),
        home_sample_matches=quality["home_matches"],
        away_sample_matches=quality["away_matches"],
        league_sample_matches=quality["league_matches"],
        research_mode=RESEARCH_MODE,
        calibration_status=CALIBRATION_STATUS,
        research_source=RESEARCH_SOURCE,
    )
