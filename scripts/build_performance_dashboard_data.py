#!/usr/bin/env python3
"""Generate server-side filterable performance segments from real OOF predictions."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd


CLASS_META = [
    (0, "H", "主勝", "prob_home_win"),
    (1, "D", "和局", "prob_draw"),
    (2, "A", "客勝", "prob_away_win"),
]
LEAGUE_LABELS = {"BRA1": "巴甲", "EPL": "英超", "LL": "西甲", "BL": "德甲", "SA": "義甲", "L1": "法甲"}
OUTCOME_OPTIONS = [
    {"code": "all", "label": "全部賽果"},
    {"code": "H", "label": "主隊勝出"},
    {"code": "D", "label": "和局"},
    {"code": "A", "label": "客隊勝出"},
]


def safe_number(value: float, digits: int = 6) -> float | None:
    if pd.isna(value) or not math.isfinite(float(value)):
        return None
    return round(float(value), digits)


def log_loss(frame: pd.DataFrame) -> float:
    probabilities = frame[[item[3] for item in CLASS_META]].clip(lower=1e-15, upper=1.0).to_numpy()
    correct = probabilities[range(len(frame)), frame["actual_class_id"].astype(int).to_numpy()]
    return float((-pd.Series(correct).map(math.log)).mean())


def calibration_points(frame: pd.DataFrame, probability_column: str, class_id: int, bins: int = 10) -> list[dict]:
    working = frame[[probability_column, "actual_class_id"]].copy()
    working["bin"] = pd.cut(working[probability_column], bins=bins, include_lowest=True, labels=False)
    points: list[dict] = []
    for bin_index, values in working.dropna().groupby("bin", observed=True):
        if len(values) < 10:
            continue
        points.append({
            "bin": int(bin_index),
            "predicted": safe_number(values[probability_column].mean(), 4),
            "observed": safe_number((values["actual_class_id"] == class_id).mean(), 4),
            "count": int(len(values)),
        })
    return points


def build_segment(frame: pd.DataFrame) -> dict:
    if frame.empty:
        raise ValueError("Cannot build a performance segment from zero rows")
    matrix = pd.crosstab(frame["actual_class_id"], frame["predicted_class_id"]).reindex(index=[0, 1, 2], columns=[0, 1, 2], fill_value=0)
    calibration = []
    distribution = []
    for class_id, code, label, probability_column in CLASS_META:
        distribution.append({
            "code": code,
            "label": label,
            "actualRate": safe_number((frame["actual_class_id"] == class_id).mean(), 4),
            "meanPredictedRate": safe_number(frame[probability_column].mean(), 4),
        })
        calibration.append({"code": code, "label": label, "points": calibration_points(frame, probability_column, class_id)})

    fold_metrics = []
    for fold, values in frame.groupby("fold", sort=True):
        fold_metrics.append({
            "fold": int(fold),
            "accuracy": safe_number((values["actual_class_id"] == values["predicted_class_id"]).mean()),
            "logLoss": safe_number(log_loss(values)),
            "validationRows": int(len(values)),
            "validationStart": values["match_datetime"].min().strftime("%Y-%m-%d"),
            "validationEnd": values["match_datetime"].max().strftime("%Y-%m-%d"),
        })

    return {
        "summary": {
            "validationMatches": int(len(frame)),
            "accuracy": safe_number((frame["actual_class_id"] == frame["predicted_class_id"]).mean()),
            "logLoss": safe_number(log_loss(frame)),
            "folds": int(frame["fold"].nunique()),
            "validationStart": frame["match_datetime"].min().strftime("%Y-%m-%d"),
            "validationEnd": frame["match_datetime"].max().strftime("%Y-%m-%d"),
        },
        "foldMetrics": fold_metrics,
        "confusionMatrix": {
            "labels": ["主勝", "和局", "客勝"],
            "rows": [{"actual": label, "values": [int(value) for value in matrix.loc[class_id].tolist()]} for class_id, _, label, _ in CLASS_META],
        },
        "calibration": calibration,
        "classDistribution": distribution,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build filterable performance dashboard payload")
    parser.add_argument("--metrics", required=True, type=Path)
    parser.add_argument("--oof", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    oof = pd.read_csv(args.oof)
    oof["match_datetime"] = pd.to_datetime(oof["match_datetime"])
    leagues = sorted(oof["league_code"].unique(), key=lambda value: list(LEAGUE_LABELS).index(value))
    seasons = sorted(oof["season"].unique())
    segments: dict[str, dict] = {}

    for league_code in ["all", *leagues]:
        league_frame = oof if league_code == "all" else oof[oof["league_code"] == league_code]
        for season in ["all", *seasons]:
            season_frame = league_frame if season == "all" else league_frame[league_frame["season"] == season]
            if season_frame.empty:
                continue
            for outcome in [option["code"] for option in OUTCOME_OPTIONS]:
                outcome_frame = season_frame if outcome == "all" else season_frame[season_frame["result"] == outcome]
                if outcome_frame.empty:
                    continue
                segments[f"{league_code}|{season}|{outcome}"] = build_segment(outcome_frame)

    payload = {
        "filters": {
            "leagues": [{"code": "all", "label": "全部聯賽"}, *[{"code": code, "label": LEAGUE_LABELS[code]} for code in leagues]],
            "seasons": [{"code": "all", "label": "全部賽季"}, *[{"code": season, "label": season} for season in seasons]],
            "outcomes": OUTCOME_OPTIONS,
        },
        "segments": segments,
        "method": "擴張式時間序列交叉驗證；所有分組僅使用未被該折訓練集看見的折外預測。主客場篩選依實際賽果切分為主隊勝出、和局或客隊勝出樣本。",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {args.output} with {len(segments)} filterable segments")


if __name__ == "__main__":
    main()
