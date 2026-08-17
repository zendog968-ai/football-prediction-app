from datetime import datetime, timezone

from football_sync.model_upgrade import blend_probabilities, dc_tau, de_vig_1x2, estimate_dc_rho, high_confidence_research, rest_days


def test_de_vig_normalizes_three_way_market() -> None:
    implied = de_vig_1x2(2.0, 3.5, 4.0)
    assert implied is not None
    assert abs(implied.home + implied.draw + implied.away - 1.0) < 1e-12


def test_invalid_odds_do_not_produce_market_probability() -> None:
    assert de_vig_1x2(1.9, None, 4.2) is None
    assert de_vig_1x2(1.0, 3.5, 4.2) is None


def test_half_weight_blend_stays_normalized() -> None:
    implied = de_vig_1x2(2.0, 3.5, 4.0)
    assert implied is not None
    result = blend_probabilities((0.50, 0.25, 0.25), implied)
    assert abs(sum(result) - 1.0) < 1e-12
    assert result[0] < 0.50


def test_dc_tau_changes_only_low_scores() -> None:
    assert dc_tau(2, 1, 1.4, 1.0, -0.08) == 1.0
    assert dc_tau(0, 0, 1.4, 1.0, -0.08) != 1.0


def test_dc_rho_uses_zero_when_history_is_insufficient() -> None:
    history = [{"fixture": {"status": {"short": "FT"}}, "goals": {"home": 0, "away": 0}}]
    assert estimate_dc_rho(history, 1.3, 1.0) == 0.0


def test_high_confidence_research_and_double_chance() -> None:
    result = high_confidence_research(0.64, 0.20, 0.16, 0.82, 0.58)
    assert result["winner_side"] == "主隊"
    assert result["over_1_5_probability"] == 0.82
    assert result["over_2_5_probability"] is None
    assert result["double_chance"] == "1X"


def test_rest_days_uses_only_finished_previous_matches() -> None:
    kickoff = datetime(2026, 8, 16, 12, tzinfo=timezone.utc)
    history = [{"fixture": {"status": {"short": "FT"}, "date": "2026-08-12T12:00:00+00:00"}, "teams": {"home": {"id": 1}, "away": {"id": 2}}}]
    assert rest_days(history, 1, kickoff) == 4.0
