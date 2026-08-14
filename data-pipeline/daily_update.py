#!/usr/bin/env python3
"""Reconcile the ODC-BY open-results snapshot into an Aurelia candidate database.

The daily GitHub workflow downloads ``games.parquet`` once, then builds all
candidate tables from it. This program adds a separate, auditable result-sync
step: it fingerprints that immutable input, checks only completed results from
the supported 14 scopes, and records which rows matched the candidate database.
It fails closed on source/schema errors and never replaces a conflicting score.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from build_expanded_leagues_db import TARGETS, allowed_date, season_label


SOURCE_URL = "https://raw.githubusercontent.com/schochastics/football-data/master/data/results/games.parquet"
SOURCE_LABEL = "schochastics/football-data games.parquet (ODC-BY)"
INTERNATIONAL_TARGETS = {"UEFA EL": ("UEL", "UEFA Europa League", "split")}
STOP_WORDS = {"fc", "cf", "afc", "pfc", "sc", "club", "the"}
DEFAULT_MAX_UNMATCHED_RATIO = 0.04


class ResultSyncError(RuntimeError):
    """Raised when a candidate release lacks a trustworthy completed-result input."""


@dataclass(frozen=True)
class SourceResult:
    league_code: str
    match_date: str
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    source_competition: str


def canonical_name(value: str) -> str:
    import re

    tokens = re.sub(r"[^a-z0-9]+", " ", value.casefold()).split()
    return " ".join(token for token in tokens if token not in STOP_WORDS)


def result_code(home_goals: int, away_goals: int) -> str:
    return "H" if home_goals > away_goals else "A" if away_goals > home_goals else "D"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_completed_results(parquet: Path, as_of: date) -> list[SourceResult]:
    if not parquet.exists() or parquet.stat().st_size < 1_000_000:
        raise ResultSyncError(f"公開賽果檔案不存在或異常過小：{parquet}")
    try:
        games = pd.read_parquet(parquet, columns=["home", "away", "date", "gh", "ga", "full_time", "competition"])
    except Exception as exc:
        raise ResultSyncError(f"無法讀取公開賽果Parquet：{exc}") from exc
    games["date"] = pd.to_datetime(games["date"], errors="coerce")
    targets = {**TARGETS, **INTERNATIONAL_TARGETS}
    records: list[SourceResult] = []
    seen: set[tuple[str, str, str, str, int, int]] = set()
    for source_competition, (league_code, _league_name, mode) in targets.items():
        subset = games[games["competition"] == source_competition].copy()
        subset = subset.dropna(subset=["date", "home", "away", "gh", "ga"])
        subset = subset[subset["date"].map(lambda value: allowed_date(value, mode, as_of))]
        for row in subset.itertuples(index=False):
            match_date = pd.Timestamp(row.date).date()
            if match_date > as_of:
                continue
            home_team, away_team = " ".join(str(row.home).split()), " ".join(str(row.away).split())
            try:
                home_goals, away_goals = int(row.gh), int(row.ga)
            except (TypeError, ValueError):
                continue
            if not home_team or not away_team or home_team == away_team or min(home_goals, away_goals) < 0:
                continue
            key = (league_code, match_date.isoformat(), canonical_name(home_team), canonical_name(away_team), home_goals, away_goals)
            if key in seen:
                continue
            seen.add(key)
            records.append(SourceResult(league_code, match_date.isoformat(), home_team, away_team, home_goals, away_goals, source_competition))
    if not records:
        raise ResultSyncError("公開賽果快照未提供任何已完成的受支援範圍比賽")
    return records


def ensure_sync_schema(connection: sqlite3.Connection) -> None:
    columns = {row[1] for row in connection.execute("PRAGMA table_info(matches)")}
    additions = {
        "result_status": "TEXT NOT NULL DEFAULT 'Finished'",
        "result_source": "TEXT",
        "result_source_event_key": "TEXT",
        "result_source_snapshot_sha256": "TEXT",
        "result_synced_at": "TEXT",
    }
    for column, definition in additions.items():
        if column not in columns:
            connection.execute(f"ALTER TABLE matches ADD COLUMN {column} {definition}")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS result_sync_audit (
          audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
          synced_at TEXT NOT NULL,
          source_label TEXT NOT NULL,
          source_snapshot_sha256 TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT,
          candidate_match_id TEXT,
          source_payload_json TEXT NOT NULL
        )
        """
    )


def find_candidate(connection: sqlite3.Connection, record: SourceResult) -> list[sqlite3.Row]:
    connection.row_factory = sqlite3.Row
    match_date = date.fromisoformat(record.match_date)
    rows = connection.execute(
        """
        SELECT match_id, home_team, away_team, home_goals, away_goals
        FROM matches
        WHERE league_code = ? AND match_date BETWEEN ? AND ?
        """,
        (record.league_code, (match_date - timedelta(days=1)).isoformat(), (match_date + timedelta(days=1)).isoformat()),
    ).fetchall()
    return [
        row for row in rows
        if canonical_name(row["home_team"]) == canonical_name(record.home_team)
        and canonical_name(row["away_team"]) == canonical_name(record.away_team)
    ]


def write_audit(connection: sqlite3.Connection, record: SourceResult, snapshot_sha: str, action: str, reason: str | None, candidate_match_id: str | None, synced_at: str) -> None:
    connection.execute(
        """
        INSERT INTO result_sync_audit (
          synced_at, source_label, source_snapshot_sha256, action, reason, candidate_match_id, source_payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (synced_at, SOURCE_LABEL, snapshot_sha, action, reason, candidate_match_id, json.dumps(asdict(record), ensure_ascii=False, sort_keys=True)),
    )


def reconcile(connection: sqlite3.Connection, records: list[SourceResult], snapshot_sha: str, dry_run: bool) -> dict[str, int]:
    stats = {"source_finished": len(records), "confirmed": 0, "updated": 0, "unmatched": 0, "ambiguous": 0, "conflict": 0}
    synced_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for record in records:
        candidates = find_candidate(connection, record)
        if not candidates:
            stats["unmatched"] += 1
            if not dry_run:
                write_audit(connection, record, snapshot_sha, "unmatched", "No existing same-scope match within ±1 day", None, synced_at)
            continue
        if len(candidates) != 1:
            stats["ambiguous"] += 1
            if not dry_run:
                write_audit(connection, record, snapshot_sha, "ambiguous", f"{len(candidates)} candidate matches", None, synced_at)
            continue
        candidate = candidates[0]
        existing_home, existing_away = candidate["home_goals"], candidate["away_goals"]
        if existing_home is not None and existing_away is not None and (existing_home != record.home_goals or existing_away != record.away_goals):
            stats["conflict"] += 1
            if not dry_run:
                write_audit(connection, record, snapshot_sha, "conflict", f"Database {existing_home}:{existing_away}, source {record.home_goals}:{record.away_goals}", candidate["match_id"], synced_at)
            continue
        action = "confirmed" if existing_home is not None and existing_away is not None else "updated"
        stats[action] += 1
        if dry_run:
            continue
        connection.execute(
            """
            UPDATE matches SET home_goals = ?, away_goals = ?, result = ?, result_status = 'Finished',
              result_source = ?, result_source_event_key = ?, result_source_snapshot_sha256 = ?, result_synced_at = ?
            WHERE match_id = ?
            """,
            (record.home_goals, record.away_goals, result_code(record.home_goals, record.away_goals), SOURCE_LABEL,
             f"{record.source_competition}:{record.match_date}:{record.home_team}:{record.away_team}", snapshot_sha, synced_at, candidate["match_id"]),
        )
        write_audit(connection, record, snapshot_sha, action, None, candidate["match_id"], synced_at)
    return stats


def evaluate_quality_gate(stats: dict[str, int], max_unmatched_ratio: float = DEFAULT_MAX_UNMATCHED_RATIO) -> dict[str, Any]:
    """Return an auditable pass/fail decision before model rebuild or release."""
    source_finished = stats.get("source_finished", 0)
    unmatched = stats.get("unmatched", 0)
    ambiguous = stats.get("ambiguous", 0)
    conflict = stats.get("conflict", 0)
    matched = stats.get("confirmed", 0) + stats.get("updated", 0)
    accounted = matched + unmatched + ambiguous + conflict
    unmatched_ratio = unmatched / source_finished if source_finished else 1.0
    failures: list[str] = []
    if source_finished <= 0:
        failures.append("source_finished 必須大於0")
    if accounted != source_finished:
        failures.append(f"稽核計數不守恆：accounted={accounted}, source_finished={source_finished}")
    if matched <= 0:
        failures.append("沒有任何已確認或更新的已完成賽果")
    if ambiguous:
        failures.append(f"存在{ambiguous}筆歧義對齊")
    if conflict:
        failures.append(f"存在{conflict}筆比分衝突")
    if unmatched_ratio > max_unmatched_ratio:
        failures.append(f"未對齊比例{unmatched_ratio:.4%}超過門檻{max_unmatched_ratio:.4%}")
    return {
        "passed": not failures,
        "max_unmatched_ratio": max_unmatched_ratio,
        "unmatched_ratio": unmatched_ratio,
        "matched": matched,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync ODC-BY public completed results into an Aurelia candidate SQLite database")
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--input-parquet", type=Path, required=True)
    parser.add_argument("--as-of", help="UTC cutoff YYYY-MM-DD; defaults to today")
    parser.add_argument("--report-out", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-unmatched-ratio", type=float, default=DEFAULT_MAX_UNMATCHED_RATIO)
    args = parser.parse_args()
    if not 0 <= args.max_unmatched_ratio < 1:
        raise ResultSyncError("max-unmatched-ratio 必須介乎0（含）與1（不含）")
    if not args.database.exists():
        raise ResultSyncError(f"找不到候選資料庫：{args.database}")
    as_of = date.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc).date()
    records = load_completed_results(args.input_parquet, as_of)
    snapshot_sha = sha256_file(args.input_parquet)
    with sqlite3.connect(args.database) as connection:
        ensure_sync_schema(connection)
        stats = reconcile(connection, records, snapshot_sha, args.dry_run)
        if not args.dry_run:
            connection.commit()
    quality_gate = evaluate_quality_gate(stats, args.max_unmatched_ratio)
    report = {
        "source": SOURCE_LABEL,
        "source_url": SOURCE_URL,
        "snapshot_sha256": snapshot_sha,
        "as_of": as_of.isoformat(),
        "dry_run": args.dry_run,
        "stats": stats,
        "quality_gate": quality_gate,
    }
    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not quality_gate["passed"]:
        raise ResultSyncError(f"每日結果同步品質閘門失敗：{'；'.join(quality_gate['failures'])}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ResultSyncError as exc:
        print(f"Daily results sync failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
