from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any


FINISHED_STATUSES = {"FT", "AET", "PEN"}


@dataclass(frozen=True)
class ImpliedProbabilities:
    home: float
    draw: float
    away: float


def de_vig_1x2(home_odds: float | None, draw_odds: float | None, away_odds: float | None) -> ImpliedProbabilities | None:
    values = (home_odds, draw_odds, away_odds)
    if not all(isinstance(value, (int, float)) and math.isfinite(float(value)) and float(value) > 1.0 for value in values):
        return None
    inverse = [1.0 / float(value) for value in values]
    total = sum(inverse)
    if total <= 0:
        return None
    return ImpliedProbabilities(home=inverse[0] / total, draw=inverse[1] / total, away=inverse[2] / total)


def blend_probabilities(model: tuple[float, float, float], market: ImpliedProbabilities | None, weight: float = 0.5) -> tuple[float, float, float]:
    if market is None:
        return model
    if not 0.0 <= weight <= 1.0:
        raise ValueError("weight must be within [0, 1]")
    blended = (
        (1.0 - weight) * model[0] + weight * market.home,
        (1.0 - weight) * model[1] + weight * market.draw,
        (1.0 - weight) * model[2] + weight * market.away,
    )
    total = sum(blended)
    return tuple(value / total for value in blended)  # type: ignore[return-value]


def dc_tau(home_goals: int, away_goals: int, home_lambda: float, away_lambda: float, rho: float) -> float:
    if home_goals == 0 and away_goals == 0:
        return 1.0 - home_lambda * away_lambda * rho
    if home_goals == 0 and away_goals == 1:
        return 1.0 + home_lambda * rho
    if home_goals == 1 and away_goals == 0:
        return 1.0 + away_lambda * rho
    if home_goals == 1 and away_goals == 1:
        return 1.0 - rho
    return 1.0


def estimate_dc_rho(history: list[dict[str, Any]], home_lambda: float, away_lambda: float) -> float:
    """Choose a bounded low-score correction by likelihood over verified completed scores."""
    scores: list[tuple[int, int]] = []
    for item in history:
        if item.get("fixture", {}).get("status", {}).get("short") not in FINISHED_STATUSES:
            continue
        home, away = item.get("goals", {}).get("home"), item.get("goals", {}).get("away")
        if isinstance(home, int) and isinstance(away, int):
            scores.append((home, away))
    if len(scores) < 20:
        return 0.0
    candidates = [round(-0.18 + 0.01 * index, 2) for index in range(37)]
    def log_likelihood(rho: float) -> float:
        total = 0.0
        for home, away in scores:
            tau = max(dc_tau(home, away, home_lambda, away_lambda, rho), 1e-8)
            total += math.log(tau)
        return total
    return max(candidates, key=log_likelihood)


def high_confidence_research(
    home: float,
    draw: float,
    away: float,
    over_1_5: float,
    over_2_5: float,
) -> dict[str, float | str | None]:
    winner_probability = max(home, away)
    winner_side = "主隊" if home >= away else "客隊"
    double_chance = max(home + draw, draw + away)
    double_chance_label = "1X" if home + draw >= draw + away else "X2"
    return {
        "winner_side": winner_side if winner_probability > 0.60 else None,
        "winner_probability": winner_probability if winner_probability > 0.60 else None,
        "over_1_5_probability": over_1_5 if over_1_5 > 0.75 else None,
        "over_2_5_probability": over_2_5 if over_2_5 > 0.75 else None,
        "double_chance": double_chance_label,
        "double_chance_probability": double_chance,
    }


def rest_days(history: list[dict[str, Any]], team_id: int, kickoff: datetime) -> float | None:
    dates: list[datetime] = []
    for item in history:
        if item.get("fixture", {}).get("status", {}).get("short") not in FINISHED_STATUSES:
            continue
        teams = item.get("teams", {})
        if teams.get("home", {}).get("id") != team_id and teams.get("away", {}).get("id") != team_id:
            continue
        raw_date = item.get("fixture", {}).get("date")
        if isinstance(raw_date, str):
            parsed = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
            if parsed < kickoff:
                dates.append(parsed)
    if not dates:
        return None
    return max(0.0, (kickoff - max(dates)).total_seconds() / 86400.0)
