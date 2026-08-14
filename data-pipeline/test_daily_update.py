#!/usr/bin/env python3
"""Unit tests for the ODC-BY completed-result reconciliation contract."""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE_DIR))
from daily_update import SOURCE_LABEL, SourceResult, ensure_sync_schema, evaluate_quality_gate, reconcile  # noqa: E402


def build_database() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.execute(
        """
        CREATE TABLE matches (
          match_id TEXT PRIMARY KEY,
          league_code TEXT NOT NULL,
          match_date TEXT NOT NULL,
          home_team TEXT NOT NULL,
          away_team TEXT NOT NULL,
          home_goals INTEGER,
          away_goals INTEGER,
          result TEXT
        )
        """
    )
    return connection


class DailyResultSyncTests(unittest.TestCase):
    def test_matching_completed_result_is_confirmed_and_audited(self) -> None:
        with build_database() as connection:
            connection.execute(
                "INSERT INTO matches VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("m1", "UEL", "2026-08-14", "PFC CSKA Sofia", "Maccabi Tel Aviv", 0, 1, "A"),
            )
            ensure_sync_schema(connection)
            stats = reconcile(
                connection,
                [SourceResult("UEL", "2026-08-14", "CSKA Sofia", "Maccabi Tel Aviv", 0, 1, "UEFA EL")],
                "snapshot-sha",
                dry_run=False,
            )
            row = connection.execute(
                "SELECT result_status, result_source, result_source_snapshot_sha256 FROM matches WHERE match_id = 'm1'"
            ).fetchone()
            audit = connection.execute("SELECT action, candidate_match_id FROM result_sync_audit").fetchone()
        self.assertEqual(stats["confirmed"], 1)
        self.assertEqual(stats["conflict"], 0)
        self.assertEqual(tuple(row), ("Finished", SOURCE_LABEL, "snapshot-sha"))
        self.assertEqual(tuple(audit), ("confirmed", "m1"))

    def test_conflicting_score_is_audited_without_overwriting_database(self) -> None:
        with build_database() as connection:
            connection.execute(
                "INSERT INTO matches VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("m1", "UEL", "2026-08-14", "CSKA Sofia", "Maccabi Tel Aviv", 0, 1, "A"),
            )
            ensure_sync_schema(connection)
            stats = reconcile(
                connection,
                [SourceResult("UEL", "2026-08-14", "CSKA Sofia", "Maccabi Tel Aviv", 2, 1, "UEFA EL")],
                "snapshot-sha",
                dry_run=False,
            )
            score = connection.execute("SELECT home_goals, away_goals, result FROM matches WHERE match_id = 'm1'").fetchone()
            audit = connection.execute("SELECT action FROM result_sync_audit").fetchone()
        self.assertEqual(stats["conflict"], 1)
        self.assertEqual(tuple(score), (0, 1, "A"))
        self.assertEqual(tuple(audit), ("conflict",))

    def test_unmatched_result_stays_outside_model_database(self) -> None:
        with build_database() as connection:
            ensure_sync_schema(connection)
            stats = reconcile(
                connection,
                [SourceResult("UEL", "2026-08-14", "Unknown Home", "Unknown Away", 1, 0, "UEFA EL")],
                "snapshot-sha",
                dry_run=False,
            )
            matches = connection.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
            audit = connection.execute("SELECT action FROM result_sync_audit").fetchone()
        self.assertEqual(stats["unmatched"], 1)
        self.assertEqual(matches, 0)
        self.assertEqual(tuple(audit), ("unmatched",))

    def test_quality_gate_allows_the_verified_unmatched_tolerance(self) -> None:
        decision = evaluate_quality_gate({
            "source_finished": 100,
            "confirmed": 96,
            "updated": 0,
            "unmatched": 4,
            "ambiguous": 0,
            "conflict": 0,
        })
        self.assertTrue(decision["passed"])
        self.assertEqual(decision["unmatched_ratio"], 0.04)

    def test_quality_gate_blocks_conflict_ambiguity_and_excess_unmatched_rows(self) -> None:
        decision = evaluate_quality_gate({
            "source_finished": 100,
            "confirmed": 93,
            "updated": 0,
            "unmatched": 5,
            "ambiguous": 1,
            "conflict": 1,
        })
        self.assertFalse(decision["passed"])
        self.assertTrue(any("歧義" in failure for failure in decision["failures"]))
        self.assertTrue(any("衝突" in failure for failure in decision["failures"]))
        self.assertTrue(any("未對齊比例" in failure for failure in decision["failures"]))


if __name__ == "__main__":
    unittest.main()
