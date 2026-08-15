from football_sync.config import Settings
from main import prioritize_popular_fixtures, select_fixture_coverage


def fixture(fixture_id: int, league_id: int, date: str) -> dict:
    return {"fixture": {"id": fixture_id, "date": date}, "league": {"id": league_id}}


def test_round_robin_fixture_selection_keeps_j1_when_other_league_is_dense() -> None:
    fixtures = [
        fixture(1, 253, "2026-08-16T10:00:00+00:00"),
        fixture(2, 253, "2026-08-16T11:00:00+00:00"),
        fixture(3, 253, "2026-08-16T12:00:00+00:00"),
        fixture(4, 98, "2026-08-16T13:00:00+00:00"),
    ]
    selected = prioritize_popular_fixtures(fixtures, 2)
    assert [item["fixture"]["id"] for item in selected] == [1, 4]


def test_all_coverage_keeps_non_popular_league_fixtures_for_catalog_sync() -> None:
    settings = Settings(api_football_key="test", supabase_url=None, supabase_key=None, league_ids=frozenset({39}))
    fixtures = [fixture(1, 39, "2026-08-16T10:00:00+00:00"), fixture(2, 195, "2026-08-16T11:00:00+00:00")]
    assert [item["fixture"]["id"] for item in select_fixture_coverage(fixtures, settings, "all")] == [1, 2]
    assert [item["fixture"]["id"] for item in select_fixture_coverage(fixtures, settings, "popular")] == [1]
