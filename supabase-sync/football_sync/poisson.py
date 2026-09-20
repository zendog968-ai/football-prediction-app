from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any


FINISHED_STATUSES = {"FT", "AET", "PEN"}
MIN_BASIC_HISTORY = 2


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
    if not isinstance(league_id, int) or not isinstance(season, int):
        raise InsufficientHistory("fixture is missing a verified competition or season")
    home = team_metrics(home_history, fixture["home_team_id"], league_id=league_id, season=season)
    away = team_metrics(away_history, fixture["away_team_id"], league_id=league_id, season=season)
    championship = league_id == 40
    calibration = league_metrics(league_history or [], league_id=league_id, season=season) if championship else None
    baseline = max(0.75, ((calibration.home_goals + calibration.away_goals) / 2) if calibration else (home.goals_for + home.goals_against + away.goals_for + away.goals_against) / 4)
    home_advantage = (calibration.home_goals / baseline) if calibration else 1.08
    away_adjustment = (calibration.away_goals / baseline) if calibration else 1.0
    home_lambda = min(4.5, max(0.2, baseline * (home.goals_for / baseline) * (away.goals_against / baseline) * home_advantage))
    away_lambda = min(4.5, max(0.2, baseline * (away.goals_for / baseline) * (home.goals_against / baseline) * away_adjustment))
    grid = {(h, a): poisson_probability(h, home_lambda) * poisson_probability(a, away_lambda) for h in range(0, 9) for a in range(0, 9)}
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
    sample = min(home.matches, away.matches)
    # This model is a compact research baseline, not a calibrated market-probability
    # model.  Data availability must never be presented as predictive confidence.
    evidence_stars = 2 if sample >= 6 else 1
    warnings = ["勝平負、大小球與BTTS均為未校準Poisson研究值；不可解讀為公平賠率、EV或命中率。"]
    if sample < 3:
        warnings.append("基礎Poisson僅使用每隊至少兩場同聯賽同賽季完場資料；輸出僅作低證據研究參考。")
    elif sample < 6:
        warnings.append("同聯賽賽季近況樣本偏少；輸出僅作低證據研究參考。")
    elif sample < 10:
        warnings.append("同聯賽賽季近況少於10場；未納入完整主客場、xG、陣容或市場校準。")
    if championship:
        warnings.append("英冠研究僅採用API-Football同聯賽正式賽資料，已排除友誼賽；聯賽平均與主場優勢為基礎校準，並非已驗證的完整校準模型。")
    return PoissonPrediction(
        api_fixture_id=fixture["api_fixture_id"],
        model_version=("poisson-v3-championship-basic-research" if sample < 3 else "poisson-v3-championship-research") if championship else ("poisson-v2-basic-league-research" if sample < 3 else "poisson-v2-league-research"),
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
    )
