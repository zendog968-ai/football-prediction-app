import importlib.util, pathlib, sys, json, sqlite3, urllib.error
from unittest.mock import patch
import pytest
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('football_ops',ROOT/'deploy/football_operations.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)

@pytest.fixture
def store(tmp_path,monkeypatch):
    monkeypatch.setattr(m,'STATE',tmp_path)
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN','test-not-real')
    monkeypatch.setenv('TELEGRAM_CHAT_ID','123')
    monkeypatch.setenv('API_FOOTBALL_KEY','test-not-real')
    con=m.db_open();yield con;con.close()

def test_send_once_atomic_and_suppressed(store):
    class Receipt:
        def __enter__(self):return self
        def __exit__(self,*_):pass
        def read(self,*_):return b'{"ok":true,"result":{"message_id":88}}'
    with patch.object(m.urllib.request,'urlopen',return_value=Receipt()) as send:
        assert m.send_once(store,'day:1','test')['message_id']==88
        assert m.send_once(store,'day:1','changed')['status']=='skipped_existing'
        assert send.call_count==1
    row=store.execute('SELECT status,body,sha256 FROM deliveries').fetchone()
    assert row==('accepted','test',m.digest('test'))

def test_uncertain_delivery_not_automatically_retried(store):
    with patch.object(m.urllib.request,'urlopen',side_effect=TimeoutError()) as send:
        assert m.send_once(store,'one','test')['status']=='uncertain'
        assert m.send_once(store,'one','test')['status']=='skipped_existing'
        assert send.call_count==1

def test_reject_oversized_complete_message_before_attempt(store):
    with pytest.raises(ValueError):m.send_once(store,'huge','x'*3901)
    assert store.execute('SELECT COUNT(*) FROM deliveries').fetchone()[0]==0

def test_only_same_bookmaker_complete_line():
    def row(book,side,odd):return {'bookmaker_id':book,'bookmaker_name':str(book),'market_code':'HDC','line_convention':'team-v2','selection':side,'decimal_odds':odd}
    assert m.limit_odds([row(8,'Home -0.75',1.9),row(7,'Away +0.75',1.9)])==[]
    rows=m.limit_odds([row(8,'Home -0.75',1.9),row(8,'Away +0.75',2.0)])
    assert len(rows)==2 and {r['bookmaker_id'] for r in rows}=={8}

def test_primary_snapshot_sha_is_immutable(store):
    p={'fixture_id':7,'home':0.4,'draw':0.3,'away':0.3}
    args=(7,'2026-11-08T00:00:00+00:00','2026-11-09T00:00:00+00:00',m.canonical(p),m.digest(p))
    store.execute('INSERT INTO predictions VALUES(?,?,?,?,?)',args)
    store.execute('INSERT OR IGNORE INTO predictions VALUES(?,?,?,?,?)',args[:-2]+('changed','x'))
    assert store.execute('SELECT body,sha256 FROM predictions').fetchone()==args[-2:]

def test_api_budget_stops_before_network(store):
    store.execute('INSERT INTO api_usage VALUES(?,6000)',(m.now().date().isoformat(),));store.commit()
    client=m.CachedClient('test',store)
    with patch.object(m.ApiFootballClient,'_get') as network:
        with pytest.raises(RuntimeError,match='BUDGET'):client._get('fixtures',id=17)
        network.assert_not_called()

def test_unaccepted_lock_not_settled(store):
    fixture={'home_win_probability':0.4,'draw_probability':0.3,'away_win_probability':0.3}
    store.execute('INSERT INTO locked_forecasts VALUES(?,?,?,?,?)',(7,'uncertain',m.canonical(fixture),m.digest(fixture),'2026-01-01T00:00:00+00:00'))
    store.execute('INSERT INTO deliveries(k,status,prepared_at,body,sha256) VALUES(?,?,?,?,?)',('uncertain','uncertain','2026-01-01T00:00:00+00:00','test','hash'));store.commit()
    with patch.object(m.CachedClient,'_get') as get:
        m.settle(store)
        get.assert_not_called()

def test_atomic_state_permissions(tmp_path):
    p=tmp_path/'state.json';m.atomic(p,{'schema_version':1})
    assert json.loads(p.read_text())=={'schema_version':1}
    assert p.stat().st_mode&0o777==0o640


def test_48h_window_includes_partial_third_utc_date():
    assert m.forecast_window_dates(m.dt.datetime(2026,11,8,3,0,tzinfo=m.dt.timezone.utc)) == ['2026-11-08','2026-11-09','2026-11-10']
    assert m.forecast_window_dates(m.dt.datetime(2026,11,8,0,0,tzinfo=m.dt.timezone.utc)) == ['2026-11-08','2026-11-09']

def test_odds_history_keeps_only_real_hour_capture_rows(store):
    t=m.dt.datetime(2026,11,8,3,0,tzinfo=m.dt.timezone.utc)
    def raw(age):
        return {'api_fixture_id':7,'bookmaker_id':8,'bookmaker_name':'Bet365','market_code':'HDC','line_convention':'team-v2','market_name':'Asian Handicap [team-v2]','selection':'Home -0.5','decimal_odds':1.91,'captured_at':(t-m.dt.timedelta(minutes=age)).isoformat(),'source_updated_at':(t-m.dt.timedelta(minutes=age+2)).isoformat()}
    for age in [10,40,70]:
        row=raw(age);store.execute('INSERT INTO odds_rows(k,fixture_id,captured_at,body) VALUES(?,?,?,?)',(m.digest(row),7,row['captured_at'],m.canonical(row)))
    got=m.projected_odds_history(store,t)
    assert len(got)==2
    assert all(r['provider_updated_at'] for r in got)


def test_actual_api_home_reference_converted_before_complete_pairing():
    raw=[{'update':'2026-11-08T00:57:00Z','bookmakers':[{'id':8,'name':'Bet365','bets':[{'name':'Asian Handicap','values':[
        {'value':'Home -1.25','odd':'5.50'}, {'value':'Away -1.25','odd':'1.15'},
        {'value':'Home +1.25','odd':'1.23'}, {'value':'Away +1.25','odd':'4.00'},
        {'value':'Home +0.25','odd':'1.78'}, {'value':'Away +0.25','odd':'2.02'}]}]}]}]
    rows=m.normalize_odds(raw,{'api_fixture_id':7},m.dt.datetime(2026,11,8,3,0,tzinfo=m.dt.timezone.utc))
    assert next(r for r in rows if r['provider_selection']=='Away -1.25')['selection']=='Away +1.25'
    chosen=m.limit_odds(rows)
    assert [(r['selection'],r['decimal_odds']) for r in chosen]==[('Home +0.25',1.78),('Away -0.25',2.02)]
    assert all(r['market_type']=='HDC2 | Bet365' for r in m.odds_to_existing_schema(chosen))

def test_mismatched_underround_pair_never_becomes_quote():
    rows=[{'bookmaker_id':8,'bookmaker_name':'Bet365','market_code':'HDC','line_convention':'team-v2','selection':side,'decimal_odds':odd} for side,odd in [('Home -1.25',5.5),('Away +1.25',4.0)]]
    assert m.limit_odds(rows)==[]


def test_history_keeps_three_way_hda_in_same_capture(store):
    t=m.dt.datetime(2026,11,8,4,tzinfo=m.dt.timezone.utc)
    for side,odd in [('Home',2.2),('Draw',3.2),('Away',3.1)]:
        raw={'api_fixture_id':7,'bookmaker_id':8,'bookmaker_name':'Bet365','market_code':'HDA','selection':side,'decimal_odds':odd,'captured_at':t.isoformat(),'source_updated_at':t.isoformat()}
        store.execute('INSERT INTO odds_rows(k,fixture_id,captured_at,body) VALUES(?,?,?,?)',(m.digest(raw),7,t.isoformat(),m.canonical(raw)))
    rows=m.projected_odds_history(store,t)
    assert len(rows)==1
    assert (rows[0]['home_odds'],rows[0]['draw_odds'],rows[0]['away_odds'])==(2.2,3.2,3.1)
    assert rows[0]['provider_updated_at']==t.isoformat()
