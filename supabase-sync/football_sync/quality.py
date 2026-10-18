"""Time-safe, league-only regularized Poisson research (not calibrated XGBoost)."""
from __future__ import annotations
from datetime import datetime, timedelta
from typing import Any

MODEL_VERSION = "poisson-v4-shrink10-research"
PRIOR_MATCHES = 10
MIN_TEAM_MATCHES = 5
MIN_LEAGUE_MATCHES = 20


def timestamp(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("missing verified timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include timezone")
    return parsed


def verified_history(rows: list[dict[str, Any]], league_id: int, season: int, cutoff: datetime, limit: int) -> list[dict[str, Any]]:
    result = []
    seen = set()
    for row in rows:
        f = row.get("fixture", {}); league = row.get("league", {}); goals = row.get("goals", {})
        if f.get("status", {}).get("short") != "FT" or league.get("id") != league_id or league.get("season") != season:
            continue
        try:
            date = timestamp(f.get("date"))
        except (ValueError, TypeError):
            continue
        # Kickoff+3h is a conservative live-data guard, not evidence of historical
        # result availability. Replays without first-observed-at are regression only.
        if not cutoff - timedelta(days=365) <= date or date + timedelta(hours=3) >= cutoff:
            continue
        observed = row.get("result_observed_at")
        if observed is not None:
            try:
                if timestamp(observed) >= cutoff: continue
            except (ValueError, TypeError): continue
        h, a = goals.get("home"), goals.get("away")
        if type(h) is not int or type(a) is not int or h < 0 or a < 0:
            continue
        teams = row.get("teams", {})
        hi, ai = teams.get("home", {}).get("id"), teams.get("away", {}).get("id")
        if type(hi) is not int or type(ai) is not int or hi <= 0 or ai <= 0 or hi == ai:
            continue
        key = f.get("id") or (str(date), hi, ai)
        if key in seen:
            continue
        seen.add(key); result.append(row)
    return sorted(result, key=lambda x: timestamp(x["fixture"]["date"]))[-limit:]


def estimate_goals(fixture: dict[str, Any], home_rows: list[dict[str, Any]], away_rows: list[dict[str, Any]], league_rows: list[dict[str, Any]], generated_at: datetime) -> dict[str, Any]:
    kickoff = timestamp(fixture.get("kickoff_at"))
    if generated_at.tzinfo is None or kickoff <= generated_at or fixture.get("status") != "NS":
        raise ValueError("research requires a verified future NS fixture")
    cutoff = generated_at
    lid, season = fixture["league_id"], fixture["season"]
    home_id, away_id = fixture["home_team_id"], fixture["away_team_id"]
    if any(type(x) is not int or x <= 0 for x in (lid, season, home_id, away_id, fixture.get("api_fixture_id"))) or home_id == away_id:
        raise ValueError("invalid fixture team identity")
    # Filter team identity BEFORE truncating the window.
    def for_team(rows, team):
        return [r for r in rows if team in (r.get("teams", {}).get("home", {}).get("id"), r.get("teams", {}).get("away", {}).get("id"))]
    home = verified_history(for_team(home_rows, home_id), lid, season, cutoff, 10)
    away = verified_history(for_team(away_rows, away_id), lid, season, cutoff, 10)
    league = verified_history(league_rows, lid, season, cutoff, 200)
    if min(len(home), len(away)) < MIN_TEAM_MATCHES or len(league) < MIN_LEAGUE_MATCHES:
        raise ValueError(f"verified history insufficient: home={len(home)}, away={len(away)}, league={len(league)} (required 5/5/20)")
    lh = sum(r["goals"]["home"] for r in league) / len(league)
    la = sum(r["goals"]["away"] for r in league) / len(league)
    baseline = (lh + la) / 2
    if baseline <= 0 or lh <= 0 or la <= 0:
        raise ValueError("league baseline has no usable goals")
    def regularized(rows, team):
        gf = ga = 0
        for r in rows:
            h, a = r["goals"]["home"], r["goals"]["away"]
            if r["teams"]["home"]["id"] == team: gf += h; ga += a
            else: gf += a; ga += h
        return ((gf + PRIOR_MATCHES * baseline) / (len(rows) + PRIOR_MATCHES), (ga + PRIOR_MATCHES * baseline) / (len(rows) + PRIOR_MATCHES))
    hf, ha = regularized(home, home_id); af, aa = regularized(away, away_id)
    clamp = lambda x: min(4.5, max(0.2, x))
    return {"home_mean": clamp(lh * hf / baseline * aa / baseline), "away_mean": clamp(la * af / baseline * ha / baseline), "home_matches": len(home), "away_matches": len(away), "league_matches": len(league), "latest_history_at": max(timestamp(r["fixture"]["date"]) for r in home + away + league).isoformat(), "prediction_as_of": cutoff.isoformat(), "model_version": MODEL_VERSION, "prior_matches": PRIOR_MATCHES, "calibrated": False, "history_availability_policy": "observed-at-when-present; otherwise kickoff+3h live guard, not historical proof"}
