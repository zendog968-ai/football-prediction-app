#!/usr/bin/env python3
"""Generate a compact, frontend-safe dashboard payload from real OOF predictions."""

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


def safe_number(value: float, digits: int = 6) -> float | None:
    if pd.isna(value) or not math.isfinite(float(value)):
        return None
    return round(float(value), digits)


def calibration_points(frame: pd.DataFrame, probability_column: str, class_id: int, bins: int = 10) -> list[dict]:
    working = frame[[probability_column, "actual_class_id"]].copy()
    working["bin"] = pd.cut(working[probability_column], bins=bins, include_lowest=True, labels=False)
    grouped = working.dropna().groupby("bin", observed=True)
    points: list[dict] = []
    for bin_index, values in grouped:
        count = len(values)
        if count < 20:
            continue
        points.append({
            "bin": int(bin_index),
            "predicted": safe_number(values[probability_column].mean(), 4),
            "observed": safe_number((values["actual_class_id"] == class_id).mean(), 4),
            "count": int(count),
        })
    return points


def main() -> None:
    parser = argparse.ArgumentParser(description="Build model performance dashboard payload")
    parser.add_argument("--metrics", required=True, type=Path)
    parser.add_argument("--oof", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    metrics = pd.read_csv(args.metrics)
    oof = pd.read_csv(args.oof)
    oof["match_datetime"] = pd.to_datetime(oof["match_datetime"])

    probability_columns = [item[3] for item in CLASS_META]
    probability_matrix = oof[probability_columns].clip(lower=1e-15, upper=1.0)
    true_column_probabilities = probability_matrix.to_numpy()[range(len(oof)), oof["actual_class_id"].astype(int).to_numpy()]
    log_loss = float((-pd.Series(true_column_probabilities).map(math.log)).mean())
    accuracy = float((oof["actual_class_id"] == oof["predicted_class_id"]).mean())

    confusion = (
        pd.crosstab(oof["actual_class_id"], oof["predicted_class_id"])
        .reindex(index=[0, 1, 2], columns=[0, 1, 2], fill_value=0)
    )
    calibration = []
    class_distribution = []
    for class_id, code, label, probability_column in CLASS_META:
        actual_rate = float((oof["actual_class_id"] == class_id).mean())
        mean_probability = float(oof[probability_column].mean())
        class_distribution.append({
            "code": code,
            "label": label,
            "actualRate": safe_number(actual_rate, 4),
            "meanPredictedRate": safe_number(mean_probability, 4),
        })
        calibration.append({
            "code": code,
            "label": label,
            "points": calibration_points(oof, probability_column, class_id),
        })

    payload = {
        "summary": {
            "validationMatches": int(len(oof)),
            "accuracy": safe_number(accuracy, 6),
            "logLoss": safe_number(log_loss, 6),
            "folds": int(len(metrics)),
            "validationStart": oof["match_datetime"].min().strftime("%Y-%m-%d"),
            "validationEnd": oof["match_datetime"].max().strftime("%Y-%m-%d"),
        },
        "foldMetrics": [
            {
                "fold": int(row.fold),
                "accuracy": safe_number(row.accuracy, 6),
                "logLoss": safe_number(row.log_loss, 6),
                "validationRows": int(row.validation_rows),
                "validationStart": str(row.validation_start)[:10],
                "validationEnd": str(row.validation_end)[:10],
            }
            for row in metrics.itertuples(index=False)
        ],
        "confusionMatrix": {
            "labels": ["主勝", "和局", "客勝"],
            "rows": [
                {"actual": label, "values": [int(value) for value in confusion.loc[class_id].tolist()]}
                for class_id, _, label, _ in CLASS_META
            ],
        },
        "calibration": calibration,
        "classDistribution": class_distribution,
        "method": "擴張式時間序列交叉驗證；所有圖表僅使用未被各折訓練集看見的折外預測。",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.output} with {len(oof)} OOF predictions")


if __name__ == "__main__":
    main()
