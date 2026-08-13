#!/usr/bin/env python3
"""訓練、校準並驗證足球勝平負三分類模型。

輸入：training_features.csv（逐場賽前特徵）
輸出：
- soccer_predict_model.pkl：以完整歷史資料訓練並校準後的模型包
- cross_validation_metrics.csv：每個時間序列驗證折的Log-Loss與Accuracy
- oof_predictions.csv：交叉驗證的折外機率預測
- confusion_matrix.png：折外預測的混淆矩陣圖
- model_report_zh-TW.md：評估與方法說明

重要：資料按match_datetime排序；外層及校準內層均以「開賽時間」為群組進行擴張式
時間序列切分，避免未來比賽或同時開賽比賽的標籤落入訓練集。
"""

from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path
from typing import Iterator

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, confusion_matrix, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBClassifier

warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")

CLASS_TO_ID = {"H": 0, "D": 1, "A": 2}
ID_TO_CLASS = {value: key for key, value in CLASS_TO_ID.items()}
CLASS_LABELS = ["H", "D", "A"]
CLASS_DISPLAY = ["主勝（H）", "和局（D）", "客勝（A）"]

ID_COLUMNS = {
    "match_id", "league_name", "season", "match_date", "match_time", "match_datetime",
    "home_team", "away_team",
}
LEAKAGE_COLUMNS = {
    "home_goals", "away_goals", "result", "target_home_win", "target_draw", "target_away_win",
}
CATEGORICAL_COLUMNS = ["league_code"]


def make_expanding_time_splits(timestamps: pd.Series, n_splits: int) -> list[tuple[np.ndarray, np.ndarray]]:
    """依唯一開賽時間建立擴張式切分，防止同時間比賽在訓練與驗證間交錯。"""
    ordered = pd.to_datetime(timestamps).reset_index(drop=True)
    unique_times = np.array(sorted(ordered.unique()))
    if len(unique_times) <= n_splits:
        raise ValueError(f"唯一開賽時間僅{len(unique_times)}個，無法進行{n_splits}折時間序列切分")

    # 類似TimeSeriesSplit：前段為初始訓練期，後續依序成為測試折。
    boundaries = np.linspace(0, len(unique_times), n_splits + 2, dtype=int)
    splits: list[tuple[np.ndarray, np.ndarray]] = []
    timestamp_values = ordered.to_numpy()
    for fold in range(n_splits):
        train_end = boundaries[fold + 1]
        test_end = boundaries[fold + 2]
        train_times = unique_times[:train_end]
        test_times = unique_times[train_end:test_end]
        train_indices = np.flatnonzero(np.isin(timestamp_values, train_times))
        test_indices = np.flatnonzero(np.isin(timestamp_values, test_times))
        if len(train_indices) == 0 or len(test_indices) == 0:
            raise ValueError("時間序列切分產生空訓練集或驗證集")
        if timestamps.iloc[train_indices].max() >= timestamps.iloc[test_indices].min():
            raise RuntimeError("時間序列切分不符合嚴格訓練早於驗證的規則")
        splits.append((train_indices, test_indices))
    return splits


def select_features(data: pd.DataFrame) -> tuple[pd.DataFrame, list[str], list[str]]:
    """只保留在開賽前即可取得的特徵；移除識別、時間及結果欄位。"""
    excluded = ID_COLUMNS | LEAKAGE_COLUMNS
    feature_columns = [column for column in data.columns if column not in excluded]
    if "league_code" not in feature_columns:
        raise KeyError("缺少league_code，無法建立聯賽條件化模型")
    numerical_columns = [column for column in feature_columns if column not in CATEGORICAL_COLUMNS]
    if not numerical_columns:
        raise RuntimeError("沒有數值特徵可供模型使用")
    return data[feature_columns].copy(), numerical_columns, CATEGORICAL_COLUMNS.copy()


def make_base_estimator(numerical_columns: list[str], categorical_columns: list[str], random_state: int) -> Pipeline:
    """建立含中位數補值、聯賽獨熱編碼及XGBoost的可複製管線。"""
    preprocessor = ColumnTransformer(
        transformers=[
            (
                "numeric",
                SimpleImputer(strategy="median", add_indicator=True),
                numerical_columns,
            ),
            (
                "categorical",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("encoder", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_columns,
            ),
        ],
        remainder="drop",
    )
    model = XGBClassifier(
        objective="multi:softprob",
        num_class=3,
        n_estimators=300,
        learning_rate=0.035,
        max_depth=3,
        min_child_weight=5,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_lambda=4.0,
        reg_alpha=0.10,
        eval_metric="mlogloss",
        tree_method="hist",
        n_jobs=2,
        random_state=random_state,
    )
    return Pipeline(steps=[("preprocessor", preprocessor), ("xgboost", model)])


def make_calibrated_model(
    timestamps: pd.Series,
    numerical_columns: list[str],
    categorical_columns: list[str],
    random_state: int,
    calibration_splits: int,
) -> CalibratedClassifierCV:
    """以時間序列內部切分做sigmoid機率校準，避免隨機校準造成未來洩漏。"""
    inner_splits = make_expanding_time_splits(timestamps.reset_index(drop=True), calibration_splits)
    base_estimator = make_base_estimator(numerical_columns, categorical_columns, random_state)
    return CalibratedClassifierCV(
        estimator=base_estimator,
        method="sigmoid",
        cv=inner_splits,
        ensemble=True,
    )


def model_probabilities(model: CalibratedClassifierCV, features: pd.DataFrame) -> np.ndarray:
    """依H/D/A固定順序輸出校準後機率，避免分類器classes_順序的隱式依賴。"""
    raw_probabilities = model.predict_proba(features)
    classes = [int(value) for value in model.classes_]
    ordered = np.zeros((len(features), 3), dtype=float)
    for target_id in range(3):
        ordered[:, target_id] = raw_probabilities[:, classes.index(target_id)]
    if not np.allclose(ordered.sum(axis=1), 1.0, rtol=0.0, atol=1e-8):
        raise RuntimeError("校準模型輸出的三類機率未加總為1")
    return ordered


def plot_confusion_matrix(matrix: np.ndarray, output_path: Path) -> None:
    fig, axis = plt.subplots(figsize=(7.2, 5.8), dpi=160)
    image = axis.imshow(matrix, interpolation="nearest", cmap="Blues")
    fig.colorbar(image, ax=axis, fraction=0.046, pad=0.04)
    axis.set(
        xticks=np.arange(3),
        yticks=np.arange(3),
        xticklabels=CLASS_DISPLAY,
        yticklabels=CLASS_DISPLAY,
        xlabel="預測類別",
        ylabel="實際類別",
        title="時間序列交叉驗證：校準後 XGBoost 混淆矩陣",
    )
    axis.tick_params(axis="x", rotation=20)
    threshold = matrix.max() / 2.0 if matrix.max() else 0
    for row in range(matrix.shape[0]):
        for column in range(matrix.shape[1]):
            axis.text(
                column,
                row,
                f"{matrix[row, column]:,}",
                ha="center",
                va="center",
                color="white" if matrix[row, column] > threshold else "black",
                fontsize=11,
                fontweight="bold",
            )
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)


def markdown_report(
    report_path: Path,
    input_path: Path,
    metrics: pd.DataFrame,
    overall_log_loss: float,
    overall_accuracy: float,
    confusion: np.ndarray,
    final_training_rows: int,
    feature_columns: list[str],
) -> None:
    fold_table = metrics.to_markdown(index=False, floatfmt=".5f")
    matrix_table = pd.DataFrame(confusion, index=CLASS_DISPLAY, columns=CLASS_DISPLAY).to_markdown()
    content = f"""# 校準後XGBoost勝平負模型報告

**輸入特徵檔：** `{input_path.name}`  
**模型：** `soccer_predict_model.pkl`  
**評估方式：** 五折擴張式時間序列交叉驗證，且每個外層訓練折內再以三折時間序列切分做 sigmoid 機率校準。

> **資料洩漏控制：** 所有驗證折嚴格晚於相應訓練折；校準資料亦只來自外層訓練期的較晚時間區段。特徵工程檔本身已保證逐場特徵在開賽前計算。

## 整體折外績效

| 指標 | 結果 |
|---|---:|
| 折外 Log-Loss | **{overall_log_loss:.5f}** |
| 折外 Accuracy | **{overall_accuracy:.2%}** |
| 外層驗證折數 | 5 |
| 模型訓練列數 | {final_training_rows:,} |
| 輸入特徵欄位數 | {len(feature_columns)} |

Log-Loss使用校準後的三類預測機率計算；數值越低代表預測機率與實際賽果越一致。Accuracy僅反映最大機率類別是否命中，應與Log-Loss一併解讀。

## 每折時間序列交叉驗證結果

{fold_table}

## 折外混淆矩陣

列為實際類別、欄為預測類別。對應圖檔為 `confusion_matrix.png`。

{matrix_table}

## 特徵與模型範圍

模型輸入只包含賽前特徵，包括聯賽代碼、Elo、近期五場指標、主客場近況與Dixon–Coles強度／機率。比賽結果、進球數、隊名、日期時間及唯一識別欄均已移除，避免直接或間接使用賽後資訊。

最終保存的模型以全部歷史資料重新訓練，並採同樣的三折時間序列校準機制。部署時，請以完全相同的欄位與名稱提供「下一場比賽開踢前」的特徵列，再使用模型包中的 `model.predict_proba(features)` 取得H/D/A校準後機率。
"""
    report_path.write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="訓練並校準足球勝平負XGBoost模型")
    parser.add_argument("--input", default="training_features.csv", help="賽前特徵CSV路徑")
    parser.add_argument("--output-dir", default=".", help="模型及報告輸出資料夾")
    parser.add_argument("--outer-splits", type=int, default=5, help="外層時間序列驗證折數")
    parser.add_argument("--calibration-splits", type=int, default=3, help="內層時間序列機率校準折數")
    parser.add_argument("--random-state", type=int, default=42, help="模型隨機種子")
    args = parser.parse_args()

    if args.outer_splits < 2 or args.calibration_splits < 2:
        parser.error("外層與校準折數均必須至少為2")

    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if not input_path.exists():
        raise FileNotFoundError(f"找不到輸入特徵檔：{input_path}")

    data = pd.read_csv(input_path, parse_dates=["match_datetime"])
    if data["match_datetime"].isna().any():
        raise RuntimeError("match_datetime有無法解析值，無法安全執行時間序列驗證")
    data = data.sort_values(["match_datetime", "match_id"]).reset_index(drop=True)
    if not data["match_datetime"].is_monotonic_increasing:
        raise RuntimeError("輸入資料必須按時間遞增排序")
    if not set(data["result"].unique()).issubset(CLASS_TO_ID):
        raise RuntimeError("result欄位只允許H、D或A")

    features, numerical_columns, categorical_columns = select_features(data)
    targets = data["result"].map(CLASS_TO_ID).astype(int).to_numpy()
    outer_splits = make_expanding_time_splits(data["match_datetime"], args.outer_splits)

    metrics_rows: list[dict[str, object]] = []
    oof_rows: list[pd.DataFrame] = []
    for fold, (train_indices, test_indices) in enumerate(outer_splits, start=1):
        train_features = features.iloc[train_indices].reset_index(drop=True)
        train_targets = targets[train_indices]
        test_features = features.iloc[test_indices].reset_index(drop=True)
        test_targets = targets[test_indices]
        train_times = data["match_datetime"].iloc[train_indices].reset_index(drop=True)

        # 三類在訓練期均需存在，否則無法訓練多類模型。
        if len(np.unique(train_targets)) != 3:
            raise RuntimeError(f"第{fold}折訓練資料未涵蓋所有H/D/A類別")
        model = make_calibrated_model(
            train_times,
            numerical_columns,
            categorical_columns,
            args.random_state + fold,
            args.calibration_splits,
        )
        model.fit(train_features, train_targets)
        probabilities = model_probabilities(model, test_features)
        predictions = probabilities.argmax(axis=1)

        fold_log_loss = log_loss(test_targets, probabilities, labels=[0, 1, 2])
        fold_accuracy = accuracy_score(test_targets, predictions)
        metrics_rows.append(
            {
                "fold": fold,
                "train_rows": len(train_indices),
                "validation_rows": len(test_indices),
                "train_start": data["match_datetime"].iloc[train_indices].min().isoformat(sep=" "),
                "train_end": data["match_datetime"].iloc[train_indices].max().isoformat(sep=" "),
                "validation_start": data["match_datetime"].iloc[test_indices].min().isoformat(sep=" "),
                "validation_end": data["match_datetime"].iloc[test_indices].max().isoformat(sep=" "),
                "log_loss": fold_log_loss,
                "accuracy": fold_accuracy,
            }
        )
        fold_predictions = data.iloc[test_indices][["match_id", "match_datetime", "league_code", "season", "home_team", "away_team", "result"]].copy()
        fold_predictions["fold"] = fold
        fold_predictions["actual_class_id"] = test_targets
        fold_predictions["predicted_class_id"] = predictions
        fold_predictions["predicted_result"] = [ID_TO_CLASS[value] for value in predictions]
        fold_predictions["prob_home_win"] = probabilities[:, 0]
        fold_predictions["prob_draw"] = probabilities[:, 1]
        fold_predictions["prob_away_win"] = probabilities[:, 2]
        oof_rows.append(fold_predictions)
        print(f"第{fold}折完成：Log-Loss={fold_log_loss:.5f}，Accuracy={fold_accuracy:.2%}")

    metrics = pd.DataFrame(metrics_rows)
    oof = pd.concat(oof_rows, ignore_index=True).sort_values(["match_datetime", "match_id"])
    true_values = oof["actual_class_id"].to_numpy()
    probability_values = oof[["prob_home_win", "prob_draw", "prob_away_win"]].to_numpy()
    predicted_values = oof["predicted_class_id"].to_numpy()
    overall_log_loss = log_loss(true_values, probability_values, labels=[0, 1, 2])
    overall_accuracy = accuracy_score(true_values, predicted_values)
    confusion = confusion_matrix(true_values, predicted_values, labels=[0, 1, 2])

    # 以全體資料重新訓練、校準並保存，供之後新賽事特徵列推論。
    final_model = make_calibrated_model(
        data["match_datetime"],
        numerical_columns,
        categorical_columns,
        args.random_state,
        args.calibration_splits,
    )
    final_model.fit(features, targets)
    model_package = {
        "model": final_model,
        "feature_columns": list(features.columns),
        "numerical_columns": numerical_columns,
        "categorical_columns": categorical_columns,
        "class_to_id": CLASS_TO_ID,
        "id_to_class": ID_TO_CLASS,
        "calibration_method": "sigmoid",
        "outer_validation": "5-fold expanding time-series CV grouped by match_datetime",
        "input_file": input_path.name,
    }

    metrics_path = output_dir / "cross_validation_metrics.csv"
    oof_path = output_dir / "oof_predictions.csv"
    model_path = output_dir / "soccer_predict_model.pkl"
    plot_path = output_dir / "confusion_matrix.png"
    report_path = output_dir / "model_report_zh-TW.md"
    metrics.to_csv(metrics_path, index=False, float_format="%.8f")
    oof.to_csv(oof_path, index=False, float_format="%.8f")
    joblib.dump(model_package, model_path)
    plot_confusion_matrix(confusion, plot_path)
    markdown_report(
        report_path,
        input_path,
        metrics,
        overall_log_loss,
        overall_accuracy,
        confusion,
        len(data),
        list(features.columns),
    )

    print("\n=== 校準後XGBoost模型訓練完成 ===")
    print(f"折外整體 Log-Loss：{overall_log_loss:.5f}")
    print(f"折外整體 Accuracy：{overall_accuracy:.2%}")
    print(f"模型檔：{model_path}")
    print(f"交叉驗證指標：{metrics_path}")
    print(f"折外預測：{oof_path}")
    print(f"混淆矩陣：{plot_path}")
    print(f"報告：{report_path}")


if __name__ == "__main__":
    main()
