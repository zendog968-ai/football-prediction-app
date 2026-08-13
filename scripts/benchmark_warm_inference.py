#!/usr/bin/env python3
"""Measure in-process, warm-cache prediction latency without fabricating an SLO."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from predict_upcoming import (
    ELO_DEFAULT_HOME_ADVANTAGE,
    ELO_DEFAULT_K,
    build_pre_match_features,
    fetch_league_matches,
    ordered_probabilities,
    resolve_team,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure warm in-process football inference latency")
    parser.add_argument("--home", required=True)
    parser.add_argument("--away", required=True)
    parser.add_argument("--league", required=True)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--iterations", type=int, default=5)
    args = parser.parse_args()

    if args.iterations < 2:
        parser.error("--iterations must be at least 2")

    load_started = time.perf_counter()
    matches = fetch_league_matches(args.database, args.league.upper())
    package = joblib.load(args.model)
    load_ms = (time.perf_counter() - load_started) * 1000

    candidates = sorted(set(matches["home_team"]) | set(matches["away_team"]))
    home = resolve_team(args.home, candidates)
    away = resolve_team(args.away, candidates)
    as_of = matches["match_datetime"].max() + pd.Timedelta(seconds=1)
    latencies: list[float] = []

    for _ in range(args.iterations):
        started = time.perf_counter()
        features, _ = build_pre_match_features(matches, home, away, as_of, ELO_DEFAULT_K, ELO_DEFAULT_HOME_ADVANTAGE)
        frame = pd.DataFrame([{column: features.get(column, np.nan) for column in package["feature_columns"]}])
        ordered_probabilities(package["model"], frame, package["class_to_id"])
        latencies.append((time.perf_counter() - started) * 1000)

    payload = {
        "scope": "warm in-process; excludes Python startup and initial SQLite/model load",
        "league": args.league.upper(),
        "iterations": args.iterations,
        "initial_load_ms": round(load_ms, 2),
        "warm_latency_ms": [round(value, 2) for value in latencies],
        "warm_median_ms": round(float(np.median(latencies)), 2),
        "warm_p95_ms": round(float(np.percentile(latencies, 95)), 2),
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
