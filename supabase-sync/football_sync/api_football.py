from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


BASE_URL = "https://v3.football.api-sports.io"
ODDS_MARKETS = {"Match Winner": "HDA", "Asian Handicap": "HDC", "Goals Over/Under": "TOTALS"}


class ApiFootballError(RuntimeError):
    pass


class ApiFootballClient:
    def __init__(self, api_key: str, timeout: int = 25):
        self.session = requests.Session()
        self.session.headers.update({"x-apisports-key": api_key})
        retry = Retry(total=3, connect=3, read=3, backoff_factor=0.75, status_forcelist=(429, 500, 502, 503, 504), allowed_methods=frozenset({"GET"}))
        self.session.mount("https://", HTTPAdapter(max_retries=retry))
        self.timeout = timeout

    def _get(self, path: str, **params: Any) -> list[dict[str, Any]]:
        try:
            response = self.session.get(f"{BASE_URL}/{path}", params=params, timeout=self.timeout)
        except requests.RequestException as exc:
            raise ApiFootballError(f"API-Football {path} network request failed after retries: {exc}") from exc
        response.raise_for_status()
        payload = response.json()
        errors = payload.get("errors")
        if errors:
            raise ApiFootballError(f"API-Football {path} error: {errors}")
        result = payload.get("response")
        if not isinstance(result, list):
            raise ApiFootballError(f"API-Football {path} returned an invalid response")
        return result

    def fixtures_by_date(self, date: str) -> list[dict[str, Any]]:
        return self._get("fixtures", date=date, timezone="UTC")

    def live_fixtures(self) -> list[dict[str, Any]]:
        return self._get("fixtures", live="all", timezone="UTC")

    def fixture_odds(self, fixture_id: int) -> list[dict[str, Any]]:
        return self._get("odds", fixture=fixture_id)

    def team_recent_fixtures(
        self,
        team_id: int,
        limit: int,
        *,
        league_id: int,
        season: int,
    ) -> list[dict[str, Any]]:
        """Return only the fixture's own competition and season.

        A team-wide `last` query can mix league, cup and friendly matches.  That is
        unsuitable for a league-level pre-match baseline, so callers must provide a
        verified competition and season.
        """
        return self._get(
            "fixtures",
            team=team_id,
            league=league_id,
            season=season,
            last=limit,
            timezone="UTC",
        )

    def league_recent_fixtures(self, league_id: int, season: int, limit: int = 200) -> list[dict[str, Any]]:
        """Return completed history from a verified league and season for calibration."""
        return self._get("fixtures", league=league_id, season=season, last=limit, timezone="UTC")


def normalize_fixture(raw: dict[str, Any], captured_at: datetime) -> dict[str, Any]:
    fixture = raw.get("fixture", {})
    league = raw.get("league", {})
    teams = raw.get("teams", {})
    goals = raw.get("goals", {})
    score = raw.get("score", {})
    fixture_id = fixture.get("id")
    home = teams.get("home", {})
    away = teams.get("away", {})
    if not isinstance(fixture_id, int) or not isinstance(home.get("id"), int) or not isinstance(away.get("id"), int):
        raise ApiFootballError("fixture misses a stable fixture or team identifier")
    kickoff = fixture.get("date")
    if not isinstance(kickoff, str):
        raise ApiFootballError(f"fixture {fixture_id} misses kickoff date")
    return {
        "api_fixture_id": fixture_id,
        "league_id": league.get("id"),
        "league_name": league.get("name"),
        "season": league.get("season"),
        "kickoff_at": kickoff,
        "status": fixture.get("status", {}).get("short"),
        "home_team_id": home["id"],
        "home_team": home.get("name"),
        "away_team_id": away["id"],
        "away_team": away.get("name"),
        "home_goals": goals.get("home"),
        "away_goals": goals.get("away"),
        "halftime_home_goals": score.get("halftime", {}).get("home"),
        "halftime_away_goals": score.get("halftime", {}).get("away"),
        "source_updated_at": fixture.get("timestamp"),
        "synced_at": captured_at.isoformat(),
    }


def normalize_odds(raw: list[dict[str, Any]], fixture_row: dict[str, Any], captured_at: datetime) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for response in raw:
        update = response.get("update")
        for bookmaker in response.get("bookmakers", []) or []:
            bookmaker_id = bookmaker.get("id")
            bookmaker_name = bookmaker.get("name")
            if not isinstance(bookmaker_id, int) or not isinstance(bookmaker_name, str):
                continue
            for bet in bookmaker.get("bets", []) or []:
                market_name = bet.get("name")
                market_code = ODDS_MARKETS.get(market_name)
                if not market_code:
                    continue
                for value in bet.get("values", []) or []:
                    odds_text = value.get("odd")
                    selection = value.get("value")
                    try:
                        odds = float(odds_text)
                    except (TypeError, ValueError):
                        continue
                    if odds <= 1 or not isinstance(selection, str):
                        continue
                    rows.append({
                        "api_fixture_id": fixture_row["api_fixture_id"],
                        "bookmaker_id": bookmaker_id,
                        "bookmaker_name": bookmaker_name,
                        "market_code": market_code,
                        "market_name": market_name,
                        "selection": selection,
                        "decimal_odds": odds,
                        "source_updated_at": update,
                        "captured_at": captured_at.isoformat(),
                    })
    return rows
