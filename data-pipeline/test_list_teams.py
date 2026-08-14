#!/usr/bin/env python3
"""Metadata contract tests for transparent data-cutoff cards."""

from __future__ import annotations

import sqlite3
import sys
import unittest
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE_DIR.parent / "scripts"))
from list_teams import build_payload  # noqa: E402


class LeagueMetadataTests(unittest.TestCase):
    def test_payload_counts_completed_results_and_excludes_unfinished_dates_from_cutoff(self) -> None:
        with sqlite3.connect(":memory:") as connection:
            connection.execute(
                """
                CREATE TABLE matches (
                  league_code TEXT, league_name TEXT, match_date TEXT,
                  home_team TEXT, away_team TEXT, home_goals INTEGER,
                  away_goals INTEGER, fetched_at TEXT
                )
                """
            )
            connection.executemany(
                "INSERT INTO matches VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    ("LCUP", "Leagues Cup", "2026-08-10", "Chicago Fire", "Necaxa", 2, 0, "2026-08-11T00:00:00Z"),
                    ("LCUP", "Leagues Cup", "2026-08-20", "Chicago Fire", "Cruz Azul", None, None, "2026-08-11T00:00:00Z"),
                ],
            )
            payload = build_payload(connection, "LCUP")

        league = payload["leagues"][0]
        coverage = payload["coverage"]
        self.assertEqual(league["match_count"], 2)
        self.assertEqual(league["completed_match_count"], 1)
        self.assertEqual(league["cutoff_date"], "2026-08-10")
        self.assertEqual(coverage["totalCompletedMatches"], 1)
        self.assertEqual(payload["teams"], ["Chicago Fire", "Cruz Azul", "Necaxa"])
