#!/usr/bin/env python3
"""Chronological paired regression replay, no API calls or production writes."""
from __future__ import annotations
import argparse, importlib.util, json, math, sqlite3, sys, hashlib
from collections import defaultdict
from datetime import datetime, UTC
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'supabase-sync'))
from football_sync.poisson import predict_fixture, InsufficientHistory


def main():
    p=argparse.ArgumentParser(); p.add_argument('--database',required=True); p.add_argument('--baseline',required=True); p.add_argument('--output',required=True); args=p.parse_args()
    spec=importlib.util.spec_from_file_location('baseline_poisson', args.baseline)
    old=importlib.util.module_from_spec(spec); sys.modules[spec.name]=old; spec.loader.exec_module(old)
    codes={'J1':98,'KOR1':292,'MEX1':262}; results={}
    db=sqlite3.connect(f'file:{Path(args.database).resolve()}?mode=ro',uri=True); db.row_factory=sqlite3.Row
    for code,lid in codes.items():
        rows=db.execute('select * from matches where league_code=? order by match_date,match_id',(code,)).fetchall()
        teams={t:i+1 for i,t in enumerate(sorted({r[k] for r in rows for k in ('home_team','away_team')}))}
        histories=defaultdict(list); league_hist=defaultdict(list); paired=[]; skipped=0
        # Same-date rows are all predicted first, then added: no same-day leakage.
        groups=defaultdict(list)
        for r in rows: groups[r['match_date']].append(r)
        for date,batch in sorted(groups.items()):
            now=datetime.fromisoformat(date[:10]).replace(tzinfo=UTC)
            for r in batch:
                season=str(r['season']); season_key=int(hashlib.sha256(season.encode()).hexdigest()[:7],16)
                hi,ai=teams[r['home_team']],teams[r['away_team']]
                home=histories[(season,hi)][-10:]; away=histories[(season,ai)][-10:]; league=league_hist[season][-200:]
                f={'api_fixture_id':1,'home_team_id':hi,'away_team_id':ai,'league_id':lid,'season':season_key,'kickoff_at':now.replace(hour=23).isoformat(),'status':'NS'}
                if date<'2024-01-01': continue
                try:
                    b=predict_fixture(f,home,away,now,league_history=league)
                    a=old.predict_fixture(f,home,away,now,league_history=league)
                except InsufficientHistory: skipped+=1; continue
                y=0 if r['home_goals']>r['away_goals'] else 1 if r['home_goals']==r['away_goals'] else 2
                get=lambda x:[x.home_win_probability,x.draw_probability,x.away_win_probability]
                paired.append({'date':date,'y':y,'old':get(a),'new':get(b)})
            for r in batch:
                season=str(r['season']); sk=int(hashlib.sha256(season.encode()).hexdigest()[:7],16); hi,ai=teams[r['home_team']],teams[r['away_team']]
                item={'fixture':{'id':r['match_id'],'date':now.isoformat(),'status':{'short':'FT'}},'league':{'id':lid,'season':sk},'teams':{'home':{'id':hi},'away':{'id':ai}},'goals':{'home':r['home_goals'],'away':r['away_goals']}}
                histories[(season,hi)].append(item); histories[(season,ai)].append(item); league_hist[season].append(item)
        def metrics(key):
            n=len(paired)
            return {'accuracy':sum(max(range(3),key=lambda i:r[key][i])==r['y'] for r in paired)/n,'log_loss':sum(-math.log(max(r[key][r['y']],1e-15)) for r in paired)/n,'multiclass_brier':sum(sum((v-(i==r['y']))**2 for i,v in enumerate(r[key])) for r in paired)/n,'mean_max_probability':sum(max(r[key]) for r in paired)/n}
        results[code]={'n':len(paired),'skipped':skipped,'start':paired[0]['date'] if paired else None,'end':paired[-1]['date'] if paired else None,'baseline':metrics('old') if paired else None,'candidate':metrics('new') if paired else None}
    out={'model_version':'poisson-v4-shrink10-research','prior_matches_fixed_before_replay':10,'test_type':'paired chronological historical regression, not untouched prospective OOT','scope':'same league/season, 5/5/20 minimum, max 365 days, same-day batched, regular-time FT only; no market/lineup inputs','database_sha256':hashlib.sha256(Path(args.database).read_bytes()).hexdigest(),'leagues':results}
    Path(args.output).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n'); print(json.dumps(out,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
