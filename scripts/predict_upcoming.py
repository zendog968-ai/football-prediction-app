#!/usr/bin/env python3
"""依足球資料庫最新歷史與已校準模型，預測指定主客隊的勝平負機率。

範例：
    python3 predict_upcoming.py --home Flamengo --away Palmeiras
    python3 predict_upcoming.py --home "Flamengo RJ" --away Palmeiras --league BRA1

預設使用資料庫最新已完成賽事之後的時間點作為預測截點；不下載即時資料。
若資料庫最後更新至過去賽季，輸出代表該資料截止日下的歷史模型預測，而非即時賽前資訊。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import unicodedata
from collections import defaultdict, deque
from datetime import timedelta
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from build_match_features import (
    DC_MIN_HISTORY_MATCHES,
    ELO_DEFAULT_HOME_ADVANTAGE,
    ELO_DEFAULT_K,
    ELO_INITIAL_RATING,
    ELO_SEASON_CARRYOVER,
    apply_elo_update,
    elo_expected_score,
    fit_dixon_coles,
    recent_metrics,
    venue_win_rate,
)

BASE_DIR = Path(__file__).parent
DEFAULT_DATABASE = BASE_DIR / "football_data.db"
DEFAULT_MODEL = BASE_DIR / "soccer_predict_model.pkl"


def normalize_team_name(name: str) -> str:
    """以不區分大小寫、重音與空白的方式比對球隊名稱。"""
    decomposed = unicodedata.normalize("NFKD", name)
    without_diacritics = "".join(char for char in decomposed if not unicodedata.combining(char))
    return "".join(char for char in without_diacritics.casefold() if char.isalnum())


def fetch_league_matches(database_path: Path, league_code: str) -> pd.DataFrame:
    with sqlite3.connect(database_path) as connection:
        matches = pd.read_sql_query(
            """
            SELECT match_id, league_code, league_name, season, match_date, match_time,
                   home_team, away_team, home_goals, away_goals, result
            FROM matches
            WHERE league_code = ?
            ORDER BY match_date, match_time, match_id
            """,
            connection,
            params=(league_code,),
        )
    if matches.empty:
        raise ValueError(f"找不到聯賽代碼 {league_code} 的歷史賽事")
    normalized_time = matches["match_time"].fillna("12:00:00").astype(str).replace({"": "12:00:00", "None": "12:00:00", "nan": "12:00:00", "NaT": "12:00:00"})
    matches["match_datetime"] = pd.to_datetime(
        matches["match_date"].astype(str) + " " + normalized_time,
        format="mixed",
        errors="coerce",
    )
    if matches["match_datetime"].isna().any():
        raise RuntimeError("資料庫存在無法解析的開賽時間，無法建立安全的賽前預測")
    return matches.sort_values(["match_datetime", "match_id"]).reset_index(drop=True)


def resolve_team(input_name: str, candidates: list[str]) -> str:
    """先精確正規化匹配，再容許唯一的前後綴匹配；模糊時要求使用者指定。"""
    normalized_input = normalize_team_name(input_name)
    if not normalized_input:
        raise ValueError("球隊名稱不可為空")
    mapping: defaultdict[str, list[str]] = defaultdict(list)
    for candidate in candidates:
        mapping[normalize_team_name(candidate)].append(candidate)

    exact = mapping.get(normalized_input, [])
    if len(exact) == 1:
        return exact[0]
    similar = [
        candidate
        for candidate in candidates
        if normalize_team_name(candidate).startswith(normalized_input)
        or normalized_input.startswith(normalize_team_name(candidate))
    ]
    similar = sorted(set(similar))
    if len(similar) == 1:
        return similar[0]
    choices = ", ".join(similar[:12]) if similar else "無"
    raise ValueError(
        f"無法唯一辨識球隊「{input_name}」。可能選項：{choices}。請以資料庫中的完整隊名再試一次。"
    )


def determine_league(database_path: Path, home_input: str, away_input: str, requested_league: str | None) -> str:
    """若未指定聯賽，尋找同時包含主客隊的唯一聯賽。"""
    with sqlite3.connect(database_path) as connection:
        raw = pd.read_sql_query(
            """
            SELECT league_code, home_team AS team FROM matches
            UNION
            SELECT league_code, away_team AS team FROM matches
            """,
            connection,
        )
    possible: list[str] = []
    for league_code, group in raw.groupby("league_code"):
        teams = group["team"].tolist()
        try:
            resolve_team(home_input, teams)
            resolve_team(away_input, teams)
            possible.append(str(league_code))
        except ValueError:
            continue
    if requested_league:
        requested = requested_league.upper()
        if requested not in possible:
            candidates = ", ".join(possible) if possible else "無"
            raise ValueError(f"聯賽「{requested}」無法同時辨識兩隊；可匹配聯賽：{candidates}")
        return requested
    if len(possible) == 1:
        return possible[0]
    if not possible:
        raise ValueError("資料庫中找不到可同時辨識兩支球隊的聯賽；可改用 --league 指定聯賽代碼。")
    raise ValueError(f"兩隊可能同時出現在多個聯賽：{', '.join(possible)}；請使用 --league 指定。")


def build_pre_match_features(
    matches: pd.DataFrame,
    home_team: str,
    away_team: str,
    as_of: pd.Timestamp,
    elo_k: float,
    elo_home_advantage: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """從該聯賽的所有as_of前賽事重播Elo和近況，並以歷史資料擬合DC模型。"""
    usable = matches[matches["match_datetime"] < as_of].copy()
    if usable.empty:
        raise ValueError("預測截點前沒有可用歷史賽事")

    ratings: defaultdict[str, float] = defaultdict(lambda: ELO_INITIAL_RATING)
    overall_history: defaultdict[str, deque[dict[str, float]]] = defaultdict(lambda: deque(maxlen=5))
    home_history: defaultdict[str, deque[dict[str, float]]] = defaultdict(lambda: deque(maxlen=5))
    away_history: defaultdict[str, deque[dict[str, float]]] = defaultdict(lambda: deque(maxlen=5))
    dc_history: list[dict[str, Any]] = []
    active_season: str | None = None

    for match_datetime, group in usable.groupby("match_datetime", sort=True):
        current_season = str(group["season"].iloc[0])
        if active_season is None:
            active_season = current_season
        elif current_season != active_season:
            for team in list(ratings):
                ratings[team] = ELO_INITIAL_RATING + ELO_SEASON_CARRYOVER * (ratings[team] - ELO_INITIAL_RATING)
            active_season = current_season

        # 同時開賽賽事先累積，之後才同時更新，與訓練特徵工程規則一致。
        batch = [record for record in group.to_dict(orient="records")]
        for record in batch:
            home = str(record["home_team"])
            away = str(record["away_team"])
            home_goals = int(record["home_goals"])
            away_goals = int(record["away_goals"])
            home_record = {
                "goals_for": float(home_goals),
                "goals_against": float(away_goals),
                "won": float(home_goals > away_goals),
            }
            away_record = {
                "goals_for": float(away_goals),
                "goals_against": float(home_goals),
                "won": float(away_goals > home_goals),
            }
            overall_history[home].append(home_record)
            overall_history[away].append(away_record)
            home_history[home].append(home_record)
            away_history[away].append(away_record)
            apply_elo_update(ratings, home, away, home_goals, away_goals, elo_k, elo_home_advantage)
            dc_history.append(record)

    home_recent = recent_metrics(overall_history[home_team])
    away_recent = recent_metrics(overall_history[away_team])
    home_home_count, home_home_win_rate = venue_win_rate(home_history[home_team])
    away_away_count, away_away_win_rate = venue_win_rate(away_history[away_team])
    home_rating = float(ratings[home_team])
    away_rating = float(ratings[away_team])

    features: dict[str, Any] = {
        "league_code": str(usable["league_code"].iloc[-1]),
        "home_elo_pre": home_rating,
        "away_elo_pre": away_rating,
        "elo_diff_pre": home_rating - away_rating,
        "elo_home_expected_score_pre": elo_expected_score(home_rating, away_rating, elo_home_advantage),
        "home_recent5_count": home_recent["count"],
        "home_recent5_goals_for_avg": home_recent["goals_for_avg"],
        "home_recent5_goals_against_avg": home_recent["goals_against_avg"],
        "home_recent5_win_rate": home_recent["win_rate"],
        "away_recent5_count": away_recent["count"],
        "away_recent5_goals_for_avg": away_recent["goals_for_avg"],
        "away_recent5_goals_against_avg": away_recent["goals_against_avg"],
        "away_recent5_win_rate": away_recent["win_rate"],
        "home_home5_count": home_home_count,
        "home_home5_win_rate": home_home_win_rate,
        "away_away5_count": away_away_count,
        "away_away5_win_rate": away_away_win_rate,
        "dc_available": 0,
    }

    dc_model = fit_dixon_coles(dc_history, as_of) if len(dc_history) >= DC_MIN_HISTORY_MATCHES else None
    if dc_model is None:
        for column in [
            "home_dc_home_attack_strength", "home_dc_home_defense_strength",
            "away_dc_away_attack_strength", "away_dc_away_defense_strength",
            "dc_home_baseline_goals", "dc_away_baseline_goals", "dc_expected_home_goals",
            "dc_expected_away_goals", "dc_rho", "dc_prob_home_win", "dc_prob_draw",
            "dc_prob_away_win", "dc_fit_match_count",
        ]:
            features[column] = np.nan
    else:
        features["dc_available"] = 1
        features.update(dc_model.match_features(home_team, away_team))

    diagnostics = {
        "historical_matches_used": len(usable),
        "home_history_matches_used": len(overall_history[home_team]),
        "away_history_matches_used": len(overall_history[away_team]),
        "league_history_matches_used": len(usable),
        "latest_historical_match": usable["match_datetime"].max().isoformat(sep=" "),
        "dc_history_match_count": int(features.get("dc_fit_match_count", 0)) if dc_model else 0,
        "dc_available": bool(dc_model is not None),
    }
    return features, diagnostics


def ordered_probabilities(model: Any, feature_frame: pd.DataFrame, class_to_id: dict[str, int]) -> dict[str, float]:
    raw = model.predict_proba(feature_frame)
    classes = [int(value) for value in model.classes_]
    probability_by_id = {class_id: float(raw[0, classes.index(class_id)]) for class_id in classes}
    probabilities = {label: probability_by_id[class_id] for label, class_id in class_to_id.items()}
    if not np.isclose(sum(probabilities.values()), 1.0, atol=1e-8):
        raise RuntimeError("模型輸出的機率未加總為1")
    return probabilities


def json_safe(value: Any) -> Any:
    """Convert numpy scalars and non-finite diagnostics to strict JSON values."""
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if np.isfinite(number) else None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description="依資料庫最新歷史資料預測足球勝平負機率")
    parser.add_argument("--home", required=True, help="主隊名稱，例如 Flamengo")
    parser.add_argument("--away", required=True, help="客隊名稱，例如 Palmeiras")
    parser.add_argument("--league", help="選用聯賽代碼，例如 BRA1；省略時自動判斷")
    parser.add_argument("--as-of", help="預測截點（YYYY-MM-DD或YYYY-MM-DD HH:MM）；預設資料庫最新賽事後一秒")
    parser.add_argument("--database", default=str(DEFAULT_DATABASE), help="SQLite資料庫路徑")
    parser.add_argument("--model", default=str(DEFAULT_MODEL), help="已校準模型路徑")
    parser.add_argument("--elo-k", type=float, default=ELO_DEFAULT_K, help="須與訓練時Elo設定一致的K值")
    parser.add_argument("--elo-home-advantage", type=float, default=ELO_DEFAULT_HOME_ADVANTAGE, help="須與訓練時一致的Elo主場優勢")
    parser.add_argument("--json-out", help="選用：將完整預測與特徵診斷寫入JSON檔")
    args = parser.parse_args()

    database_path = Path(args.database).expanduser().resolve()
    model_path = Path(args.model).expanduser().resolve()
    if not database_path.exists():
        raise FileNotFoundError(f"找不到資料庫：{database_path}")
    if not model_path.exists():
        raise FileNotFoundError(f"找不到模型：{model_path}")

    league_code = determine_league(database_path, args.home, args.away, args.league)
    league_matches = fetch_league_matches(database_path, league_code)
    candidates = sorted(set(league_matches["home_team"]) | set(league_matches["away_team"]))
    home_team = resolve_team(args.home, candidates)
    away_team = resolve_team(args.away, candidates)
    if home_team == away_team:
        raise ValueError("主隊與客隊不可相同")

    latest_available = league_matches["match_datetime"].max()
    if args.as_of:
        as_of = pd.Timestamp(args.as_of)
        if pd.isna(as_of):
            raise ValueError("--as-of必須為可解析的日期或日期時間")
    else:
        as_of = latest_available + pd.Timedelta(seconds=1)
    if as_of <= league_matches["match_datetime"].min():
        raise ValueError("預測截點早於此聯賽的第一場資料，無法計算特徵")

    package = joblib.load(model_path)
    required = {"model", "feature_columns", "class_to_id"}
    missing = required - set(package)
    if missing:
        raise RuntimeError(f"模型檔缺少必要內容：{sorted(missing)}")

    features, diagnostics = build_pre_match_features(
        league_matches,
        home_team,
        away_team,
        as_of,
        args.elo_k,
        args.elo_home_advantage,
    )
    feature_frame = pd.DataFrame([{column: features.get(column, np.nan) for column in package["feature_columns"]}])
    probabilities = ordered_probabilities(package["model"], feature_frame, package["class_to_id"])

    payload = {
        "prediction_as_of": as_of.isoformat(sep=" "),
        "league_code": league_code,
        "league_name": str(league_matches["league_name"].iloc[0]),
        "home_team": home_team,
        "away_team": away_team,
        "probabilities": {
            "home_win": probabilities["H"],
            "draw": probabilities["D"],
            "away_win": probabilities["A"],
        },
        "diagnostics": diagnostics,
        "selected_features": {
            "home_elo_pre": features["home_elo_pre"],
            "away_elo_pre": features["away_elo_pre"],
            "elo_diff_pre": features["elo_diff_pre"],
            "home_recent5_win_rate": features["home_recent5_win_rate"],
            "away_recent5_win_rate": features["away_recent5_win_rate"],
            "dc_expected_home_goals": features.get("dc_expected_home_goals"),
            "dc_expected_away_goals": features.get("dc_expected_away_goals"),
        },
    }

    print("=== 校準後勝平負機率預測 ===")
    print(f"聯賽：{payload['league_name']}（{league_code}）")
    print(f"歷史資料截點：{payload['prediction_as_of']}")
    print(f"對戰：主隊 {home_team} vs 客隊 {away_team}")
    print(f"主勝：{probabilities['H']:.2%}")
    print(f"和局：{probabilities['D']:.2%}")
    print(f"客勝：{probabilities['A']:.2%}")
    print("\n特徵摘要：")
    print(f"主隊 Elo：{features['home_elo_pre']:.1f}；客隊 Elo：{features['away_elo_pre']:.1f}；差距：{features['elo_diff_pre']:+.1f}")
    print(f"主隊近5場勝率：{features['home_recent5_win_rate']:.1%}；客隊近5場勝率：{features['away_recent5_win_rate']:.1%}")
    if diagnostics["dc_available"]:
        print(f"DC 預期進球：主隊 {features['dc_expected_home_goals']:.2f}；客隊 {features['dc_expected_away_goals']:.2f}")
    print(f"使用歷史比賽：{diagnostics['historical_matches_used']:,} 場；最新記錄：{diagnostics['latest_historical_match']}")
    print("註：此輸出僅基於本機歷史資料與模型，非即時陣容、傷停或賠率資訊。")

    if args.json_out:
        output_path = Path(args.json_out).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(json_safe(payload), ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
        print(f"JSON輸出：{output_path}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        raise SystemExit(2)
