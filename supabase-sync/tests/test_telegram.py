from football_sync.telegram import format_failure, format_kickoff_hkt, format_success


def test_success_summary_is_research_only_and_caps_at_two_predictions() -> None:
    report = {
        "counts": {"fixtures": 4, "odds_snapshots": 12, "ai_predictions": 3},
        "predictions": [
            {"league": "MLS", "home_team": "A", "away_team": "B", "kickoff_at": "2026-08-15T00:00:00Z", "score": "1-0", "lean": "主隊傾向", "stars": 4},
            {"league": "La Liga", "home_team": "C", "away_team": "D", "kickoff_at": "2026-08-15T20:00:00Z", "score": "1-1", "lean": "和局傾向", "stars": 3},
            {"league": "EPL", "home_team": "E", "away_team": "F", "score": "2-1", "lean": "主隊傾向", "stars": 2},
        ],
    }
    message = format_success(report)
    assert "A vs B" in message
    assert "C vs D" in message
    assert "E vs F" not in message
    assert "2026-08-15 08:00 (HKT)" in message
    assert "非投注、非資金建議" in message


def test_kickoff_is_converted_to_hong_kong_time() -> None:
    assert format_kickoff_hkt("2026-08-15T20:00:00Z") == "2026-08-16 04:00 (HKT)"
    assert format_kickoff_hkt("not-a-date") == "資料不足"


def test_failure_alert_does_not_claim_a_prediction() -> None:
    message = format_failure("timeout\nprivate detail")
    assert "三次嘗試後" in message
    assert "timeout private detail" in message
    assert "預測" in message
