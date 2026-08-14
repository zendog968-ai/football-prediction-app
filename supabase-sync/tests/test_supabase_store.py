from football_sync.supabase_store import fixture_to_existing_schema, odds_to_existing_schema, prediction_to_existing_schema


def test_fixture_mapping_uses_existing_schema_names() -> None:
    mapped = fixture_to_existing_schema({
        "api_fixture_id": 10,
        "league_name": "MLS",
        "kickoff_at": "2026-08-15T00:00:00+00:00",
        "status": "NS",
        "home_team": "Home",
        "away_team": "Away",
        "home_goals": None,
        "away_goals": None,
        "synced_at": "2026-08-14T00:00:00+00:00",
    })
    assert mapped["fixture_id"] == 10
    assert "api_fixture_id" not in mapped


def test_hda_odds_are_compacted_by_bookmaker() -> None:
    rows = [{
        "api_fixture_id": 10,
        "bookmaker_name": "Example Book",
        "market_code": "HDA",
        "selection": selection,
        "decimal_odds": odds,
        "captured_at": "2026-08-14T00:00:00+00:00",
    } for selection, odds in [("Home", 1.8), ("Draw", 3.4), ("Away", 4.1)]]
    mapped = odds_to_existing_schema(rows)
    assert mapped == [{
        "fixture_id": 10,
        "market_type": "HDA | Example Book",
        "handicap": "1X2",
        "home_odds": 1.8,
        "draw_odds": 3.4,
        "away_odds": 4.1,
        "snapshot_time": "2026-08-14T00:00:00+00:00",
    }]


def test_prediction_mapping_retains_research_label() -> None:
    mapped = prediction_to_existing_schema({
        "api_fixture_id": 10,
        "home_win_probability": 0.5,
        "draw_probability": 0.25,
        "away_win_probability": 0.25,
        "most_likely_score": "1-0",
        "research_lean": "主隊傾向",
        "evidence_stars": 3,
        "generated_at": "2026-08-14T00:00:00+00:00",
    })
    assert mapped["recommendation"] == "研究傾向：主隊傾向"
    assert mapped["confidence"] == 3
