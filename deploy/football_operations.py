#!/usr/bin/env python3
"""Home-owned bounded refresh + immutable forward ledger. No wagering advice."""
from __future__ import annotations
import requests
import argparse, collections, contextlib, datetime as dt, fcntl, hashlib, json, math, os, pathlib, shlex, sqlite3, tempfile, time, urllib.request, urllib.error, urllib.parse
from zoneinfo import ZoneInfo
import sys
ROOT = pathlib.Path(os.getenv('FOOTBALL_PROJECT_ROOT', str(pathlib.Path(__file__).resolve().parents[1])))
sys.path.insert(0, str(ROOT / 'supabase-sync'))
from football_sync.api_football import ApiFootballClient, normalize_fixture, normalize_odds
from football_sync.supabase_store import SupabaseStore, fixture_to_existing_schema, prediction_to_existing_schema, odds_to_existing_schema
from football_sync.config import Settings, POPULAR_LEAGUE_IDS
from football_sync.poisson import predict_fixture, InsufficientHistory
HKT = ZoneInfo('Asia/Hong_Kong')
STATE = pathlib.Path(os.getenv('FOOTBALL_OPERATIONS_DIR', '/var/lib/aurelia-operations'))
RESEARCH_IDS = POPULAR_LEAGUE_IDS | {88, 103, 79}

def canonical(x): return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
def digest(x): return hashlib.sha256(canonical(x).encode()).hexdigest()
def now(): return dt.datetime.now(dt.timezone.utc)
def timestamp(x): return dt.datetime.fromisoformat(x.replace('Z','+00:00'))
def atomic(path, value):
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.atomic-')
    try:
        os.fchmod(fd, 0o640)
        with os.fdopen(fd, 'w') as f: f.write(canonical(value)+'\n'); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
def env_load(path):
    for line in pathlib.Path(path).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1); os.environ[k.strip()]=' '.join(shlex.split(v))
    if not os.getenv('TELEGRAM_CHAT_ID'): os.environ['TELEGRAM_CHAT_ID']=os.getenv('TELEGRAM_ADMIN_CHAT_ID','')

def db_open():
    con=sqlite3.connect(STATE/'operations.sqlite',timeout=10)
    con.execute('PRAGMA journal_mode=WAL');con.execute('PRAGMA synchronous=FULL')
    con.executescript('''
    CREATE TABLE IF NOT EXISTS cached_api(k TEXT PRIMARY KEY, saved_at REAL NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS api_usage(day TEXT PRIMARY KEY,n INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS predictions(fixture_id INTEGER NOT NULL, generated_at TEXT NOT NULL, kickoff TEXT NOT NULL, body TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(fixture_id,generated_at));
    CREATE TABLE IF NOT EXISTS deliveries(k TEXT PRIMARY KEY, status TEXT NOT NULL, prepared_at TEXT NOT NULL, body TEXT NOT NULL, sha256 TEXT NOT NULL, message_id INTEGER, accepted_at TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS locked_forecasts(fixture_id INTEGER NOT NULL, delivery_key TEXT NOT NULL, body TEXT NOT NULL, sha256 TEXT NOT NULL, kickoff TEXT NOT NULL, PRIMARY KEY(fixture_id,delivery_key));
    CREATE TABLE IF NOT EXISTS outcomes(fixture_id INTEGER PRIMARY KEY, observed_at TEXT NOT NULL, body TEXT NOT NULL, sha256 TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS odds_rows(k TEXT PRIMARY KEY, fixture_id INTEGER NOT NULL,captured_at TEXT NOT NULL,body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS odds_fixture_time ON odds_rows(fixture_id,captured_at DESC);
    ''');con.commit();return con

class CachedClient(ApiFootballClient):
    def __init__(self,key,con): super().__init__(key,timeout=10);self.con=con;self.calls=0
    def _get(self,path,**params):
        ttl=14400 if 'league' in params and 'season' in params else 600 if 'date' in params else 0
        k=canonical([path,params]);row=self.con.execute('SELECT saved_at,body FROM cached_api WHERE k=?',(k,)).fetchone()
        if row and time.time()-row[0]<ttl: return json.loads(row[1])
        day=now().date().isoformat();used=self.con.execute('SELECT n FROM api_usage WHERE day=?',(day,)).fetchone()
        if used and used[0]>=6000: raise RuntimeError('LOCAL_API_BUDGET_6000_EXCEEDED')
        self.con.execute('INSERT INTO api_usage VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1',(day,));self.con.commit();self.calls+=1
        result=super()._get(path,**params)
        if ttl: self.con.execute('INSERT OR REPLACE INTO cached_api VALUES(?,?,?)',(k,time.time(),canonical(result)));self.con.commit()
        return result

def limit_odds(rows):
    """One primary real bookmaker, 1X2+2.5 and one complete opposite AH line."""
    books=collections.defaultdict(list)
    for row in rows: books[(row['bookmaker_id'],row['bookmaker_name'])].append(row)
    for _,group in sorted(books.items(),key=lambda kv:(0 if kv[0][0]==8 else 1,kv[0][0])):
        hdc=[r for r in group if r['market_code']=='HDC' and r.get('line_convention')=='team-v2']
        pairs=[]
        chosen=[]
        for h in hdc:
            try: side,line=h['selection'].split();line=float(line)
            except (ValueError,AttributeError):continue
            if side.lower()!='home':continue
            away=next((a for a in hdc if a['selection'].lower().startswith('away ') and abs(float(a['selection'].split()[1])+line)<1e-8),None)
            if away and 0.98 <= 1/float(h['decimal_odds'])+1/float(away['decimal_odds']) <= 1.35:
                pairs.append([h,away])
        if pairs:
            chosen=min(pairs,key=lambda p:abs(math.log(float(p[0]['decimal_odds'])/float(p[1]['decimal_odds']))))
        totals=[r for r in group if r['market_code']=='TOTALS' and r['selection'] in ('Over 2.5','Under 2.5')]
        hda=[r for r in group if r['market_code']=='HDA' and r['selection'] in ('Home','Draw','Away')]
        if chosen:return hda+totals+chosen
    if not books:return []
    group=next(iter(books.values()))
    return [r for r in group if r['market_code']=='HDA' or r['market_code']=='TOTALS' and r['selection'] in ('Over 2.5','Under 2.5')]

def local_odds_mirror(rows,fixtures):
    """Append only verified licensed rows to existing local trend source (UTC driver)."""
    import pymysql
    url=urllib.parse.urlparse(os.environ['DATABASE_URL']); by={f['api_fixture_id']:f for f in fixtures}
    conn=pymysql.connect(host=url.hostname,port=url.port or 3306,user=urllib.parse.unquote(url.username or ''),password=urllib.parse.unquote(url.password or ''),database=url.path.lstrip('/'),autocommit=False)
    try:
        with conn.cursor() as c:
            c.execute("SET time_zone='+00:00'")
            for r in rows:
                f=by[r['api_fixture_id']]
                c.execute('''INSERT INTO odds_snapshots (apiFixtureId,fixtureKickoffAt,leagueCode,apiLeagueId,homeTeamName,awayTeamName,bookmakerId,bookmakerName,marketName,selection,decimalOdds,sourceUpdatedAt,capturedAt)
                SELECT %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s WHERE NOT EXISTS (SELECT 1 FROM odds_snapshots WHERE apiFixtureId=%s AND bookmakerId=%s AND marketName=%s AND selection=%s AND capturedAt=%s)''',
                (r['api_fixture_id'],timestamp(f['kickoff_at']).replace(tzinfo=None),{39:'EPL',40:'CHAMP',61:'L1',71:'BRA1',78:'BL',79:'GER2',88:'NED1',94:'POR1',98:'J1',103:'NOR1',135:'SA',140:'LL',169:'CHN1',188:'AUS1',253:'MLS',262:'MEX1',292:'KOR1',2:'UCL',3:'UEL',11:'SUD',13:'LCUP',48:'EFL'}.get(f['league_id'],'OTHER'),f['league_id'],f['home_team'],f['away_team'],r['bookmaker_id'],r['bookmaker_name'],r['market_name'],r['selection'],r['decimal_odds'],timestamp(r['source_updated_at']).replace(tzinfo=None) if r.get('source_updated_at') else None,timestamp(r['captured_at']).replace(tzinfo=None),r['api_fixture_id'],r['bookmaker_id'],r['market_name'],r['selection'],timestamp(r['captured_at']).replace(tzinfo=None)))
        conn.commit()
    finally:conn.close()

def forecast_window_dates(t):
    t=t.astimezone(dt.timezone.utc)
    end=t+dt.timedelta(hours=48)-dt.timedelta(microseconds=1)
    return [(t.date()+dt.timedelta(days=i)).isoformat() for i in range((end.date()-t.date()).days+1)]

def projected_odds_history(con,t):
    # Raw, source-timestamped immutable captures, not synthesized trend points.
    rows=con.execute('SELECT body FROM odds_rows WHERE captured_at>=? ORDER BY captured_at DESC LIMIT 2500',((t-dt.timedelta(hours=1)).isoformat(),)).fetchall()
    projected=[]
    for body, in rows:
        raw=json.loads(body)
        if raw['market_code']=='HDC' and raw.get('line_convention')!='team-v2':continue
        projected.extend({**p,'provider_updated_at':raw.get('source_updated_at')} for p in odds_to_existing_schema([raw]))
    return projected

def refresh(con):
    response=requests.get('https://v3.football.api-sports.io/status',headers={'x-apisports-key':os.environ['API_FOOTBALL_KEY']},timeout=15)
    response.raise_for_status(); status=response.json()
    account=status.get('response') or {}; quota=account.get('requests') or {}
    if status.get('errors') or account.get('subscription',{}).get('active') is not True: raise RuntimeError('PROVIDER_ACCOUNT_NOT_READY')
    if int(quota.get('limit_day',0))-int(quota.get('current',0)) < 500: raise RuntimeError('PROVIDER_QUOTA_RESERVE')
    settings=Settings.from_env();client=CachedClient(settings.api_football_key,con);store=SupabaseStore.from_settings(settings)
    t=now(); dates=forecast_window_dates(t)
    raw=[]
    for date in dates:raw.extend(client.fixtures_by_date(date))
    raw=list({r['fixture']['id']:r for r in raw}.values())
    raw=[r for r in raw if r.get('league',{}).get('id') in RESEARCH_IDS]
    fixture_rows=[normalize_fixture(r,t) for r in raw]
    # Do not rewrite completed rows as future. Stable competition and team IDs retained locally.
    if fixture_rows:store.upsert_fixtures(fixture_rows)
    warnings=[];predictions=[];odds=[];raw_odds=[];statuses={};league_history={}
    future=sorted([f for f in fixture_rows if f['status']=='NS' and t < timestamp(f['kickoff_at']) < t+dt.timedelta(hours=48)],key=lambda x:x['kickoff_at'])
    near=[f for f in future if timestamp(f['kickoff_at']) < t+dt.timedelta(hours=12)]
    # Rotate overflow fairly; no single busy league can monopolise the near-match cap.
    last={int(fid):capt for fid,capt in con.execute('SELECT fixture_id,MAX(captured_at) FROM odds_rows GROUP BY fixture_id')}
    odds_ids={f['api_fixture_id'] for f in sorted(near,key=lambda f:(last.get(f['api_fixture_id'],''),f['kickoff_at']))[:48]}
    for f in future:
        fid=f['api_fixture_id'];key=(f['league_id'],f['season'])
        try:
            if key not in league_history:league_history[key]=client._get('fixtures',league=key[0],season=key[1],timezone='UTC')
            history=[x for x in league_history[key] if (x.get('fixture') or {}).get('date') and timestamp(x['fixture']['date']) < t]
            home=[x for x in history if f['home_team_id'] in (x.get('teams',{}).get('home',{}).get('id'),x.get('teams',{}).get('away',{}).get('id'))]
            away=[x for x in history if f['away_team_id'] in (x.get('teams',{}).get('home',{}).get('id'),x.get('teams',{}).get('away',{}).get('id'))]
            p=predict_fixture(f,home,away,t,league_history=history).to_row()
            con.execute('INSERT OR IGNORE INTO predictions VALUES(?,?,?,?,?)',(fid,p['generated_at'],f['kickoff_at'],canonical(p),digest(p)))
            predictions.append({**prediction_to_existing_schema(p),'prediction_as_of':t.isoformat()})
        except InsufficientHistory: warnings.append('INSUFFICIENT_HISTORY:'+str(fid))
        except Exception as e:warnings.append('PREDICTION_QUERY_FAILED:'+str(fid)+':'+type(e).__name__)
        if fid in odds_ids:
            try:
                r=limit_odds(normalize_odds(client.fixture_odds(fid),f,t));raw_odds+=r; mapped=odds_to_existing_schema(r)
                provider_update = r[0].get('source_updated_at') if r else None
                odds += [{**row,'provider_updated_at':provider_update} for row in mapped]
                statuses[str(fid)]='verified' if any(x['market_code']=='HDC' for x in r) else 'not_available'
                for row in r:con.execute('INSERT OR IGNORE INTO odds_rows VALUES(?,?,?,?)',(digest(row),fid,row['captured_at'],canonical(row)))
            except Exception as e:statuses[str(fid)]='query_failed';warnings.append('ODDS_QUERY_FAILED:'+str(fid)+':'+type(e).__name__)
        else:statuses[str(fid)]='outside_near_window'
    con.commit()
    # Exact Poisson parameters remain in q4; precision is not falsely restored from rounded stored 1X2.
    if predictions:
        for i in range(0,len(predictions),100):store.client.table('ai_predictions').upsert([{k:v for k,v in row.items() if k!='prediction_as_of'} for row in predictions[i:i+100]],on_conflict='fixture_id').execute()
    if odds:store.client.table('odds_snapshots').insert([{k:v for k,v in row.items() if k!='provider_updated_at'} for row in odds],returning='minimal').execute()
    if raw_odds:
        try:local_odds_mirror(raw_odds,fixture_rows)
        except Exception as e:warnings.append('LOCAL_TREND_MIRROR_FAILED:'+type(e).__name__)
    payload={'schema_version':1,'generated_at':t.isoformat(),'fixtures':[{**fixture_to_existing_schema(f),'league_id':f['league_id'],'season':f['season'],'home_team_id':f['home_team_id'],'away_team_id':f['away_team_id']} for f in future], 'predictions':predictions,'odds':projected_odds_history(con,t),'odds_status':statuses,
             'counts':{'fixtures':len(future),'predictions':len(predictions),'odds_rows':len(odds),'api_calls':client.calls},'warnings':warnings}
    atomic(STATE/'latest.json',payload)
    con.execute('DELETE FROM cached_api WHERE saved_at<?',(time.time()-7*86400,));con.commit()
    print(canonical({'refresh':payload['counts'],'warnings':len(warnings),'generated_at':payload['generated_at']}))
    return payload

def send_once(con,key,text):
    existing=con.execute('SELECT status FROM deliveries WHERE k=?',(key,)).fetchone()
    if existing:return {'status':'skipped_existing','previous_status':existing[0]}
    if not isinstance(text,str) or not text or len(text)>3900:raise ValueError('Telegram message exceeds complete-message limit')
    con.execute('INSERT INTO deliveries(k,status,prepared_at,body,sha256) VALUES(?,?,?,?,?)',(key,'attempting',now().isoformat(),text,digest(text)));con.commit()
    request=urllib.request.Request('https://api.telegram.org/bot'+os.environ['TELEGRAM_BOT_TOKEN']+'/sendMessage',data=json.dumps({'chat_id':os.environ['TELEGRAM_CHAT_ID'],'text':text,'disable_web_page_preview':True}).encode(),headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=15) as r:data=json.load(r)
        mid=data.get('result',{}).get('message_id')
        if data.get('ok') is not True or type(mid) is not int:raise ValueError('Invalid Telegram receipt')
        con.execute('UPDATE deliveries SET status=?,message_id=?,accepted_at=? WHERE k=?',('accepted',mid,now().isoformat(),key));con.commit()
        return {'status':'accepted','message_id':mid}
    except urllib.error.HTTPError as e:
        con.execute('UPDATE deliveries SET status=?,error=? WHERE k=?',('rejected','HTTP_'+str(e.code),key));con.commit();return {'status':'rejected','http':e.code}
    except Exception as e:
        con.execute('UPDATE deliveries SET status=?,error=? WHERE k=?',('uncertain',type(e).__name__,key));con.commit();return {'status':'uncertain'}

def ensure_accepted(receipt):
    if receipt.get('status') == 'accepted' or receipt.get('status') == 'skipped_existing' and receipt.get('previous_status') == 'accepted':return
    raise RuntimeError('TELEGRAM_DELIVERY_NOT_ACCEPTED')

def research_notifications_enabled():
    import pymysql
    url=urllib.parse.urlparse(os.environ['DATABASE_URL'])
    conn=pymysql.connect(host=url.hostname,port=url.port or 3306,user=urllib.parse.unquote(url.username or ''),password=urllib.parse.unquote(url.password or ''),database=url.path.lstrip('/'),autocommit=False)
    try:
        with conn.cursor() as c:
            c.execute("SET SESSION TRANSACTION READ ONLY");c.execute("START TRANSACTION READ ONLY")
            c.execute("SELECT isActive FROM telegram_subscriptions WHERE chatId=%s LIMIT 1",(os.environ['TELEGRAM_CHAT_ID'],))
            row=c.fetchone();return row is None or bool(row[0])
    finally:conn.close()

def preview():
    op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with op.open('http://127.0.0.1:3100/api/trpc/prediction.researchPreview',timeout=25) as r:body=json.load(r)
    payload=body['result']['data'];return payload.get('json',payload)

def notify(con,kind,manual=False):
    if not manual and not research_notifications_enabled():print('skipped_subscription_disabled');return
    t=now().astimezone(HKT); key=(kind+':'+t.date().isoformat()) if not manual else 'verification:20261108'
    if con.execute('SELECT 1 FROM deliveries WHERE k=?',(key,)).fetchone():return
    data=preview();cards=data.get('cards',[])
    if not cards:
        print(canonical({'notification':'no_valid_research_no_send','kind':kind}));return
    ids=data['fixtureIds'][:1] if manual else data['fixtureIds'][:3]
    for i,(fid,card) in enumerate(zip(ids,cards)):
        dk=key+':'+str(fid)
        row=con.execute('SELECT body,kickoff,sha256 FROM predictions WHERE fixture_id=? ORDER BY generated_at DESC LIMIT 1',(fid,)).fetchone()
        if not row or timestamp(row[1])<=now():continue
        con.execute('INSERT OR IGNORE INTO locked_forecasts VALUES(?,?,?,?,?)',(fid,dk,row[0],row[2],row[1]));con.commit()
        title='Aurelia Football｜'+('正式格式驗證' if manual else '每日賽前研究' if kind=='day' else '晚間賽前研究')
        result=send_once(con,dk,title+'\n'+t.strftime('%Y-%m-%d %H:%M (HKT)')+'\n\n'+card)
        print(canonical({'notification':result,'fixture_id':fid}))
        ensure_accepted(result)
    # Bundle marker is durable; per-card receipts prevent repeats on process crash.
    con.execute('INSERT OR IGNORE INTO deliveries(k,status,prepared_at,body,sha256) VALUES(?,?,?,?,?)',(key,'bundle_complete',now().isoformat(),canonical(ids),digest(ids)));con.commit()

def settle(con):
    client=CachedClient(os.environ['API_FOOTBALL_KEY'],con);t=now()
    pending=con.execute("SELECT DISTINCT f.fixture_id,f.kickoff FROM locked_forecasts f JOIN deliveries d ON d.k=f.delivery_key WHERE d.status='accepted' AND f.fixture_id NOT IN (SELECT fixture_id FROM outcomes)").fetchall()
    new=[]
    for fid,kickoff in pending[:30]:
        if t < timestamp(kickoff)+dt.timedelta(hours=3):continue
        rows=client._get('fixtures',id=fid)
        if not rows or rows[0].get('fixture',{}).get('status',{}).get('short')!='FT':continue
        r=rows[0];h=r.get('goals',{}).get('home');a=r.get('goals',{}).get('away')
        if type(h) is not int or type(a) is not int:continue
        evidence={'source':'API-Football','fixture_id':fid,'status':'FT','home':h,'away':a,'observed_at':t.isoformat()}
        con.execute('INSERT OR IGNORE INTO outcomes VALUES(?,?,?,?)',(fid,t.isoformat(),canonical(evidence),digest(evidence)));new.append(evidence)
    con.commit()
    if new and research_notifications_enabled():
        text='Aurelia Football｜賽後研究結算\n'+t.astimezone(HKT).strftime('%Y-%m-%d %H:%M (HKT)')+'\n僅結算已在開賽前鎖定並發送的研究卡；不是投注勝率。\n'+'\n'.join(f"Fixture {r['fixture_id']}：{r['home']}-{r['away']}（官方FT）" for r in new)
        ensure_accepted(send_once(con,'settlement:'+digest(new),text))
    print(canonical({'new_official_settlements':len(new)}))

def weekly(con):
    if not research_notifications_enabled():print('skipped_subscription_disabled');return
    date=now().astimezone(HKT).date(); key='weekly:'+date.isoformat()
    n=con.execute('SELECT COUNT(DISTINCT f.fixture_id) FROM locked_forecasts f JOIN outcomes o USING(fixture_id)').fetchone()[0]
    text='Aurelia Football｜每週模型資料品質\n'+str(date)+' (HKT)\n研究引擎：poisson-v4-shrink10-research；未校準\n已鎖定且有官方賽果的前瞻樣本：'+str(n)+'場\n前瞻校準：收集中，不自動晉升已校準。\nxG來源：未提供（不以Poisson預期入球冒充觀測xG）\nElo／休息天數：本研究引擎未使用，不宣稱完整特徵。\n模型漂移：前瞻樣本不足時不作判定。\n高信心、EV與投注建議保持停用。'
    ensure_accepted(send_once(con,key,text))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--env-file',default='/etc/aurelia-football.env');parser.add_argument('--mode',choices=['refresh','settle','day','evening','weekly','verify'],default='refresh');a=parser.parse_args()
    env_load(a.env_file);STATE.mkdir(parents=True,exist_ok=True)
    with (STATE/'worker.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:print('skipped_locked');return
        with contextlib.closing(db_open()) as con:
            try:
                if a.mode=='refresh':refresh(con);settle(con)
                elif a.mode=='settle':settle(con)
                elif a.mode=='weekly':weekly(con)
                else:notify(con,a.mode,manual=a.mode=='verify')
            except Exception as e:
                atomic(STATE/'last-error.json',{'at':now().isoformat(),'type':type(e).__name__})
                print(canonical({'status':'failed','error_type':type(e).__name__}))
                try:send_once(con,'ops-failure:'+now().astimezone(HKT).date().isoformat()+':'+a.mode+':'+type(e).__name__,'Aurelia Football｜營運錯誤\n模式：'+a.mode+'\n錯誤類別：'+type(e).__name__+'\n香港時間：'+now().astimezone(HKT).isoformat()+'\n請檢查Home日誌；不自動重送不確定的通知。')
                except Exception:pass
                raise SystemExit(1)
if __name__=='__main__':main()
