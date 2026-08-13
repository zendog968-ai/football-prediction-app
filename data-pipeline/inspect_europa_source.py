#!/usr/bin/env python3
"""Inspect Europa League coverage in the public results parquet without modifying data."""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect Europa League source coverage")
    parser.add_argument("--source", required=True, help="Path to games.parquet")
    args = parser.parse_args()

    games = pd.read_parquet(Path(args.source), columns=["competition", "level", "date", "home", "away", "gh", "ga"])
    games["date"] = pd.to_datetime(games["date"], errors="coerce")
    candidate_names = sorted(
        name for name in games["competition"].dropna().unique()
        if "europa" in str(name).lower() or str(name).strip() == "UEFA EL"
    )
    print("Europa League candidate competitions:")
    for name in candidate_names:
        subset = games[(games["competition"] == name) & games["date"].notna() & games["gh"].notna() & games["ga"].notna()].copy()
        print(f"{name} | matches={len(subset):,} | first={subset['date'].min().date()} | last={subset['date'].max().date()}")
        if not subset.empty:
            for row in subset.sort_values("date").tail(5).itertuples(index=False):
                print(f"  {row.date.date()} | {row.home} {int(row.gh)}-{int(row.ga)} {row.away}")

    international = sorted(games.loc[games["level"] == "international", "competition"].dropna().unique())
    print("International competition labels:")
    for name in international:
        print(f"  {name}")


if __name__ == "__main__":
    main()
