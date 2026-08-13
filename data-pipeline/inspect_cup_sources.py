#!/usr/bin/env python3
"""List exact public-dataset competition labels and coverage for new cup scopes."""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


KEYWORDS = ("sudamericana", "leagues cup", "copa sud", "concacaf")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parquet", type=Path, required=True)
    args = parser.parse_args()
    games = pd.read_parquet(args.parquet, columns=["competition", "date", "home", "away", "gh", "ga"])
    games["date"] = pd.to_datetime(games["date"], errors="coerce")
    labels = sorted(
        value for value in games["competition"].dropna().unique()
        if any(keyword in str(value).casefold() for keyword in KEYWORDS)
    )
    for label in labels:
        subset = games[games["competition"] == label].dropna(subset=["date", "gh", "ga"])
        print({
            "competition": label,
            "matches": int(len(subset)),
            "first_date": subset["date"].min().date().isoformat() if not subset.empty else None,
            "last_date": subset["date"].max().date().isoformat() if not subset.empty else None,
            "teams": int(len(set(subset["home"]).union(subset["away"]))) if not subset.empty else 0,
        })
        if label == "Copa Sud" and not subset.empty:
            by_year = subset.assign(year=subset["date"].dt.year).groupby("year").size()
            recent = subset[subset["date"].dt.year >= 2024]
            recent_teams = {str(team) for team in pd.concat([recent["home"], recent["away"]]).dropna()}
            print({
                "competition": label,
                "years_2002_plus": {str(year): int(count) for year, count in by_year[by_year.index >= 2002].items()},
                "sample_recent_teams": sorted(recent_teams)[:20],
            })
        if label == "CONCACAF L" and not subset.empty:
            by_year = subset.assign(year=subset["date"].dt.year).groupby("year").size()
            recent_matches = subset.sort_values("date", ascending=False).head(8)
            print({
                "competition": label,
                "years": {str(year): int(count) for year, count in by_year.items()},
                "recent_matches": [
                    {"date": row.date.date().isoformat(), "home": str(row.home), "away": str(row.away), "score": f"{int(row.gh)}:{int(row.ga)}"}
                    for row in recent_matches.itertuples(index=False)
                ],
            })


if __name__ == "__main__":
    main()
