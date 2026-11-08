import importlib.util, pathlib, sqlite3, sys, unittest
import pandas as pd
p=pathlib.Path(__file__).with_name('build_football_db.py')
spec=importlib.util.spec_from_file_location('football_builder',p)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)

class InsertIdempotencyTests(unittest.TestCase):
    def setUp(self):
        self.con=sqlite3.connect(':memory:');m.create_schema(self.con)
        self.row=m.extract_matches(pd.DataFrame([{'Date':'01/09/2026','HomeTeam':'Alpha','AwayTeam':'Beta','FTHG':1,'FTAG':0,'FTR':'H'}]),'E0','Premier League','2627','https://example.test/official.csv')[0]
    def tearDown(self):self.con.close()
    def count(self):return self.con.execute('SELECT COUNT(*) FROM matches').fetchone()[0]
    def test_repeated_snapshot_import_preserves_original(self):
        m.insert_matches(self.con,[self.row]);m.insert_matches(self.con,[{**self.row,'source_url':'second-source','match_id':'alternative-id'}])
        self.assertEqual(self.count(),1)
        self.assertEqual(self.con.execute('SELECT source_url FROM matches').fetchone()[0],self.row['source_url'])
    def test_identical_rows_in_batch(self):
        m.insert_matches(self.con,[self.row,self.row]);self.assertEqual(self.count(),1)
    def test_incompatible_primary_id_fails_closed(self):
        m.insert_matches(self.con,[self.row])
        with self.assertRaisesRegex(ValueError,'collision'):m.insert_matches(self.con,[{**self.row,'away_team':'Other'}])
        self.assertEqual(self.count(),1)
    def test_same_score_inconsistent_outcome_fails_closed(self):
        m.insert_matches(self.con,[self.row])
        with self.assertRaisesRegex(ValueError,'inconsistent'):m.insert_matches(self.con,[{**self.row,'result':'A'}])
    def test_distinct_events_remain_distinct(self):
        m.insert_matches(self.con,[self.row,{**self.row,'match_id':'other','match_date':'2026-09-02'}]);self.assertEqual(self.count(),2)

    def test_same_event_id_accent_only_preserves_original(self):
        m.insert_matches(self.con,[self.row])
        m.insert_matches(self.con,[{**self.row,'home_team':'Álpha','away_team':'Béta'}])
        self.assertEqual(self.count(),1)
        self.assertEqual(self.con.execute('SELECT home_team FROM matches').fetchone()[0],'Alpha')
    def test_accent_alias_must_not_hide_changed_score(self):
        m.insert_matches(self.con,[self.row])
        with self.assertRaisesRegex(ValueError,'collision'):
            m.insert_matches(self.con,[{**self.row,'home_team':'Álpha','home_goals':2}])

if __name__=='__main__':unittest.main()
