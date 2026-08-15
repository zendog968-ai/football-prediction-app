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


def test_fixture_mapping_preserves_country_for_ambiguous_league_names() -> None:
    mapped = fixture_to_existing_schema({
        "api_fixture_id": 1492334,
        "league_name": "Serie A",
        "league_country": "Brazil",
        "kickoff_at": "2026-08-15T19:30:00+00:00",
        "status": "NS",
        "home_team": "Fluminense",
        "away_team": "Palmeiras",
        "home_goals": None,
        "away_goals": None,
        "synced_at": "2026-08-15T12:00:00+00:00",
    })
    assert mapped["league_name"] == "Brazil::Serie A"


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
        "expected_home_goals": 1.5,
        "expected_away_goals": 0.9,
        "over_2_5_probability": 0.48,
        "top_scorelines": [{"score": "1-0", "probability": 0.14}],
        "model_version": "poisson-v3-championship-basic-research",
        "data_warning": "勝平負、大小球與BTTS均為未校準Poisson研究值；不可解讀為公平賠率、EV或命中率。",
        "generated_at": "2026-08-14T00:00:00+00:00",
    })
    assert "[AURELIA_META]" in mapped["recommendation"]
    assert '"h":1.5' in mapped["recommendation"]
    assert '"a":0.9' in mapped["recommendation"]
    assert '"s":"英冠校準"' in mapped["recommendation"]
    assert len(mapped["recommendation"]) <= 50
    assert mapped["confidence"] == 3
