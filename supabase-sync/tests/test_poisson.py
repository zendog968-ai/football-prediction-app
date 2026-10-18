from datetime import UTC, datetime, timedelta
import pytest
from football_sync.poisson import InsufficientHistory, predict_fixture
from football_sync.quality import estimate_goals, verified_history
from football_sync.supabase_store import prediction_to_existing_schema
NOW = datetime(2026, 10, 18, 9, tzinfo=UTC)
FIXTURE = dict(api_fixture_id=1, home_team_id=1, away_team_id=2, league_id=98, season=2026, kickoff_at='2026-10-19T09:00:00Z', status='NS')

def history(team, n, h=2, a=1):
    return [dict(fixture=dict(id=team*100+i,date=(NOW-timedelta(days=i+1)).isoformat(),status=dict(short='FT')),league=dict(id=98,season=2026),teams=dict(home=dict(id=team),away=dict(id=1000+i)),goals=dict(home=h,away=a)) for i in range(n)]

def test_normalization_version_and_grid_consistency():
    p=predict_fixture(FIXTURE,history(1,5),history(2,5),NOW,history(5,20))
    assert p.home_win_probability+p.draw_probability+p.away_win_probability == pytest.approx(1,abs=2e-6)
    assert p.model_version == 'poisson-v4-shrink10-research'
    assert '未校準' in p.data_warning
    assert len(p.top_scorelines)==3
    assert p.home_sample_matches==5 and p.away_sample_matches==5 and p.league_sample_matches==20
    row=prediction_to_existing_schema(p.to_row())
    assert 'Q4' in row['recommendation'] and len(row['recommendation'])<=50

def test_fixed_formula_matches_typescript():
    q=estimate_goals(FIXTURE,history(1,5),history(2,5),history(5,20),NOW)
    assert q['home_mean']==pytest.approx(2*(25/15)/1.5*(20/15)/1.5)
    assert q['away_mean']==pytest.approx((25/15)/1.5*(20/15)/1.5)

@pytest.mark.parametrize('n,league_n',[(2,20),(4,20),(5,19)])
def test_insufficient_real_history_stops_prediction(n,league_n):
    with pytest.raises(InsufficientHistory): predict_fixture(FIXTURE,history(1,n),history(2,5),NOW,history(5,league_n))

def test_foreign_future_stale_duplicate_extra_time_rejected():
    rows=history(1,5)
    bad=history(1,5)
    for r in bad: r['league']['id']=667
    future=history(3,1)[0]; future['fixture']['date']='2026-10-18T08:00:00Z'
    aet=history(4,1)[0]; aet['fixture']['status']['short']='AET'
    stale=history(6,1)[0]; stale['fixture']['date']='2024-01-01T00:00:00Z'
    assert len(verified_history(rows+rows+bad+[future,aet,stale],98,2026,NOW,10))==5

@pytest.mark.parametrize('extra',[{'status':'2H'},{'kickoff_at':'2026-10-18T08:00:00Z'},{'kickoff_at':'invalid'},{'away_team_id':1}])
def test_invalid_target_rejected(extra):
    with pytest.raises(InsufficientHistory): predict_fixture({**FIXTURE,**extra},history(1,5),history(2,5),NOW,history(5,20))

@pytest.mark.parametrize('extra',[{'league_id':True},{'season':True},{'home_team_id':0},{'api_fixture_id':0}])
def test_identity_is_positive_non_boolean(extra):
    with pytest.raises(InsufficientHistory): predict_fixture({**FIXTURE,**extra},history(1,5),history(2,5),NOW,history(5,20))

def test_high_means_retain_full_tail_and_correct_over_probability():
    import math
    p=predict_fixture(FIXTURE,history(1,5,20,20),history(2,5,20,20),NOW,history(5,20,1,1))
    assert p.expected_home_goals==4.5 and p.expected_away_goals==4.5
    assert p.over_2_5_probability==pytest.approx(1-math.exp(-9)*(1+9+81/2),abs=1e-6)


def test_delayed_observed_result_is_not_usable_at_cutoff():
    rows=history(1,5)
    rows[0]['result_observed_at']='2026-10-18T10:00:00Z'
    assert len(verified_history(rows,98,2026,NOW,10))==4
