#!/usr/bin/env python3
"""以 football_data.db 建立無未來資料洩漏的逐場賽前特徵。

輸出：training_features.csv

每一列對應一場已完成的比賽；該列所有特徵均在此場開賽前計算。
功能包括：
1. 動態 Elo：聯賽內跨賽季延續，賽季起點做回歸平均值處理。
2. 近況：雙方最近五場整體進球、失球、勝率；以及最近五個主／客場的勝率。
3. Dixon–Coles：以歷史365日、指數時間衰減的加權最大概似估計，定期重估主場攻擊、
   主場防守、客場攻擊、客場防守、預期進球及勝平負機率。

執行方式：
    python3 build_match_features.py \
        --database football_data.db \
        --output training_features.csv
"""

from __future__ import annotations

import argparse
import math
import sqlite3
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln

# Elo 參數。主場優勢與K值可透過命令列調整。
ELO_INITIAL_RATING = 1500.0
ELO_DEFAULT_K = 20.0
ELO_DEFAULT_HOME_ADVANTAGE = 65.0
ELO_SEASON_CARRYOVER = 0.75

# Dixon–Coles參數。所有擬合僅使用當前比賽之前的賽事。
DC_LOOKBACK_DAYS = 365
DC_REFIT_INTERVAL_DAYS = 28
DC_MIN_HISTORY_MATCHES = 100
DC_TIME_DECAY = 0.002  # 約347天半衰期，較近賽事權重更高。
DC_RIDGE = 0.010
DC_MAXITER = 120
DC_RHO_BOUND = 0.15
DC_MAX_GOALS = 8


@dataclass
class DCModel:
    """某一時點以前資料所估計的Dixon–Coles模型。"""

    teams: list[str]
    team_index: dict[str, int]
    home_attack_log: np.ndarray
    home_defense_concession_log: np.ndarray
    away_attack_log: np.ndarray
    away_defense_concession_log: np.ndarray
    home_intercept: float
    away_intercept: float
    rho: float
    fit_match_count: int
    fit_end_datetime: pd.Timestamp

    def team_parameters(self, team: str) -> tuple[float, float, float, float]:
        """未知或剛升班球隊以聯賽平均修正值0處理。"""
        index = self.team_index.get(team)
        if index is None:
            return 0.0, 0.0, 0.0, 0.0
        return (
            float(self.home_attack_log[index]),
            float(self.home_defense_concession_log[index]),
            float(self.away_attack_log[index]),
            float(self.away_defense_concession_log[index]),
        )

    def match_features(self, home_team: str, away_team: str) -> dict[str, float]:
        home_att, home_def_concede, _, _ = self.team_parameters(home_team)
        _, _, away_att, away_def_concede = self.team_parameters(away_team)
        lambda_home = math.exp(self.home_intercept + home_att + away_def_concede)
        lambda_away = math.exp(self.away_intercept + away_att + home_def_concede)
        home_win, draw, away_win = dixon_coles_outcome_probabilities(lambda_home, lambda_away, self.rho)
        return {
            # 強度採容易解讀的方向：攻擊值越高越強；防守值越高越能降低對手預期進球。
            "home_dc_home_attack_strength": math.exp(home_att),
            "home_dc_home_defense_strength": math.exp(-home_def_concede),
            "away_dc_away_attack_strength": math.exp(away_att),
            "away_dc_away_defense_strength": math.exp(-away_def_concede),
            "dc_home_baseline_goals": math.exp(self.home_intercept),
            "dc_away_baseline_goals": math.exp(self.away_intercept),
            "dc_expected_home_goals": lambda_home,
            "dc_expected_away_goals": lambda_away,
            "dc_rho": self.rho,
            "dc_prob_home_win": home_win,
            "dc_prob_draw": draw,
            "dc_prob_away_win": away_win,
            "dc_fit_match_count": float(self.fit_match_count),
        }


def dixon_coles_tau(
    home_goals: np.ndarray,
    away_goals: np.ndarray,
    lambda_home: np.ndarray,
    lambda_away: np.ndarray,
    rho: float,
) -> np.ndarray:
    """Dixon–Coles低比分修正項，修正0-0、0-1、1-0及1-1的相關性。"""
    tau = np.ones_like(lambda_home, dtype=float)
    zero_zero = (home_goals == 0) & (away_goals == 0)
    zero_one = (home_goals == 0) & (away_goals == 1)
    one_zero = (home_goals == 1) & (away_goals == 0)
    one_one = (home_goals == 1) & (away_goals == 1)
    tau[zero_zero] = 1.0 - lambda_home[zero_zero] * lambda_away[zero_zero] * rho
    tau[zero_one] = 1.0 + lambda_home[zero_one] * rho
    tau[one_zero] = 1.0 + lambda_away[one_zero] * rho
    tau[one_one] = 1.0 - rho
    return np.clip(tau, 1e-10, None)


def dixon_coles_outcome_probabilities(lambda_home: float, lambda_away: float, rho: float) -> tuple[float, float, float]:
    """透過修正後的聯合進球分布，估計主勝、平局與客勝機率。"""
    goals = np.arange(DC_MAX_GOALS + 1)
    log_p_home = goals * math.log(lambda_home) - lambda_home - gammaln(goals + 1)
    log_p_away = goals * math.log(lambda_away) - lambda_away - gammaln(goals + 1)
    probabilities = np.outer(np.exp(log_p_home), np.exp(log_p_away))

    home_grid, away_grid = np.meshgrid(goals, goals, indexing="ij")
    tau = np.ones_like(probabilities)
    tau[0, 0] = 1.0 - lambda_home * lambda_away * rho
    tau[0, 1] = 1.0 + lambda_home * rho
    tau[1, 0] = 1.0 + lambda_away * rho
    tau[1, 1] = 1.0 - rho
    probabilities *= np.clip(tau, 1e-10, None)
    probabilities /= probabilities.sum()

    return (
        float(probabilities[home_grid > away_grid].sum()),
        float(probabilities[home_grid == away_grid].sum()),
        float(probabilities[home_grid < away_grid].sum()),
    )


def pack_centered(parameters: np.ndarray, start: int, n_teams: int) -> tuple[np.ndarray, int]:
    """以最後一隊為隱含值，確保每組團隊參數和為零，維持模型可識別性。"""
    free_count = n_teams - 1
    values = np.zeros(n_teams, dtype=float)
    values[:-1] = parameters[start : start + free_count]
    values[-1] = -values[:-1].sum()
    return values, start + free_count


def unpack_dc_parameters(parameters: np.ndarray, n_teams: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float, float, float]:
    cursor = 0
    home_attack, cursor = pack_centered(parameters, cursor, n_teams)
    home_defense_concession, cursor = pack_centered(parameters, cursor, n_teams)
    away_attack, cursor = pack_centered(parameters, cursor, n_teams)
    away_defense_concession, cursor = pack_centered(parameters, cursor, n_teams)
    home_intercept = float(parameters[cursor])
    away_intercept = float(parameters[cursor + 1])
    rho = float(parameters[cursor + 2])
    return (
        home_attack,
        home_defense_concession,
        away_attack,
        away_defense_concession,
        home_intercept,
        away_intercept,
        rho,
    )


def fit_dixon_coles(history: list[dict[str, Any]], prediction_time: pd.Timestamp) -> DCModel | None:
    """使用prediction_time之前且回溯窗口內的比賽，估計一個聯賽專屬DC模型。"""
    cutoff = prediction_time - pd.Timedelta(days=DC_LOOKBACK_DAYS)
    usable = [record for record in history if record["match_datetime"] >= cutoff]
    if len(usable) < DC_MIN_HISTORY_MATCHES:
        return None

    teams = sorted({record["home_team"] for record in usable} | {record["away_team"] for record in usable})
    if len(teams) < 4:
        return None
    team_index = {team: index for index, team in enumerate(teams)}
    n_teams = len(teams)

    home_indices = np.array([team_index[record["home_team"]] for record in usable], dtype=int)
    away_indices = np.array([team_index[record["away_team"]] for record in usable], dtype=int)
    home_goals = np.array([record["home_goals"] for record in usable], dtype=float)
    away_goals = np.array([record["away_goals"] for record in usable], dtype=float)
    ages = np.array([(prediction_time - record["match_datetime"]).total_seconds() / 86400.0 for record in usable])
    weights = np.exp(-DC_TIME_DECAY * ages)

    home_mean = max(float(np.average(home_goals, weights=weights)), 0.10)
    away_mean = max(float(np.average(away_goals, weights=weights)), 0.10)
    parameter_count = 4 * (n_teams - 1) + 3
    initial = np.zeros(parameter_count, dtype=float)
    initial[-3] = math.log(home_mean)
    initial[-2] = math.log(away_mean)
    initial[-1] = 0.0

    def negative_log_likelihood(parameters: np.ndarray) -> float:
        (
            home_attack,
            home_defense_concession,
            away_attack,
            away_defense_concession,
            home_intercept,
            away_intercept,
            rho,
        ) = unpack_dc_parameters(parameters, n_teams)
        lambda_home = np.exp(home_intercept + home_attack[home_indices] + away_defense_concession[away_indices])
        lambda_away = np.exp(away_intercept + away_attack[away_indices] + home_defense_concession[home_indices])
        tau = dixon_coles_tau(home_goals, away_goals, lambda_home, lambda_away, rho)
        log_probability = (
            home_goals * np.log(lambda_home)
            - lambda_home
            - gammaln(home_goals + 1)
            + away_goals * np.log(lambda_away)
            - lambda_away
            - gammaln(away_goals + 1)
            + np.log(tau)
        )
        regularization = DC_RIDGE * (
            np.square(home_attack).sum()
            + np.square(home_defense_concession).sum()
            + np.square(away_attack).sum()
            + np.square(away_defense_concession).sum()
        )
        return float(-(weights * log_probability).sum() + regularization)

    bounds = [(None, None)] * (parameter_count - 1) + [(-DC_RHO_BOUND, DC_RHO_BOUND)]
    result = minimize(
        negative_log_likelihood,
        initial,
        method="L-BFGS-B",
        bounds=bounds,
        options={"maxiter": DC_MAXITER, "ftol": 1e-8},
    )
    if not result.success and not np.isfinite(result.fun):
        return None

    values = unpack_dc_parameters(result.x, n_teams)
    return DCModel(
        teams=teams,
        team_index=team_index,
        home_attack_log=values[0],
        home_defense_concession_log=values[1],
        away_attack_log=values[2],
        away_defense_concession_log=values[3],
        home_intercept=values[4],
        away_intercept=values[5],
        rho=values[6],
        fit_match_count=len(usable),
        fit_end_datetime=prediction_time,
    )


def recent_metrics(history: deque[dict[str, float]]) -> dict[str, float]:
    """取最近最多五場的整體賽事平均進／失球與勝率。"""
    if not history:
        return {"count": 0.0, "goals_for_avg": np.nan, "goals_against_avg": np.nan, "win_rate": np.nan}
    values = list(history)
    return {
        "count": float(len(values)),
        "goals_for_avg": float(np.mean([item["goals_for"] for item in values])),
        "goals_against_avg": float(np.mean([item["goals_against"] for item in values])),
        "win_rate": float(np.mean([item["won"] for item in values])),
    }


def venue_win_rate(history: deque[dict[str, float]]) -> tuple[float, float]:
    if not history:
        return 0.0, np.nan
    return float(len(history)), float(np.mean([item["won"] for item in history]))


def elo_expected_score(home_rating: float, away_rating: float, home_advantage: float) -> float:
    return 1.0 / (1.0 + 10.0 ** (-(home_rating + home_advantage - away_rating) / 400.0))


def apply_elo_update(
    ratings: dict[str, float],
    home_team: str,
    away_team: str,
    home_goals: int,
    away_goals: int,
    k_factor: float,
    home_advantage: float,
) -> None:
    home_rating = ratings[home_team]
    away_rating = ratings[away_team]
    expected_home = elo_expected_score(home_rating, away_rating, home_advantage)
    actual_home = 1.0 if home_goals > away_goals else 0.5 if home_goals == away_goals else 0.0
    margin_multiplier = math.log(abs(home_goals - away_goals) + 1.0) * (2.2 / (abs(home_rating - away_rating) * 0.001 + 2.2))
    if home_goals == away_goals:
        margin_multiplier = 1.0
    change = k_factor * margin_multiplier * (actual_home - expected_home)
    ratings[home_team] = home_rating + change
    ratings[away_team] = away_rating - change


def fetch_matches(database_path: Path) -> pd.DataFrame:
    with sqlite3.connect(database_path) as connection:
        dataframe = pd.read_sql_query(
            """
            SELECT match_id, league_code, league_name, season, match_date, match_time,
                   home_team, away_team, home_goals, away_goals, result
            FROM matches
            ORDER BY league_code, match_date, match_time, match_id
            """,
            connection,
        )
    # 多個公開歷史來源只提供比賽日期而無開賽時間。以同日固定時間處理，讓同日賽事
    # 先共同產生特徵、再共同更新歷史，較將它們任意排序為早晚開踢更保守。
    normalized_time = dataframe["match_time"].fillna("12:00:00").astype(str).replace({"": "12:00:00", "None": "12:00:00", "nan": "12:00:00"})
    dataframe["match_datetime"] = pd.to_datetime(
        dataframe["match_date"].astype(str) + " " + normalized_time,
        format="mixed",
        errors="coerce",
    )
    if dataframe["match_datetime"].isna().any():
        invalid = int(dataframe["match_datetime"].isna().sum())
        raise RuntimeError(f"有{invalid}筆賽事缺少可解析的開賽時間，無法安全依時間排序")
    return dataframe.sort_values(["league_code", "match_datetime", "match_id"]).reset_index(drop=True)


def generate_features(matches: pd.DataFrame, k_factor: float, home_advantage: float) -> pd.DataFrame:
    feature_rows: list[dict[str, Any]] = []

    for league_code, league_matches in matches.groupby("league_code", sort=False):
        ratings: defaultdict[str, float] = defaultdict(lambda: ELO_INITIAL_RATING)
        team_overall_history: defaultdict[str, deque[dict[str, float]]] = defaultdict(lambda: deque(maxlen=5))
        team_home_history: defaultdict[str, deque[dict[str, float]]] = defaultdict(lambda: deque(maxlen=5))
        team_away_history: defaultdict[str, deque[dict[str, float]]] = defaultdict(lambda: deque(maxlen=5))
        dc_history: list[dict[str, Any]] = []
        dc_model: DCModel | None = None
        last_dc_fit_time: pd.Timestamp | None = None
        active_season: str | None = None

        league_matches = league_matches.sort_values(["match_datetime", "match_id"])
        for match_datetime, group in league_matches.groupby("match_datetime", sort=True):
            # 同一開球時間的所有比賽均先產生特徵，之後才一併寫回其賽果，防止並行比賽互相洩漏。
            current_seasons = group["season"].unique()
            if len(current_seasons) != 1:
                raise RuntimeError(f"{league_code}在同一開球時間含多個賽季，無法安全處理")
            current_season = str(current_seasons[0])
            if active_season is None:
                active_season = current_season
            elif current_season != active_season:
                for team in list(ratings):
                    ratings[team] = ELO_INITIAL_RATING + ELO_SEASON_CARRYOVER * (ratings[team] - ELO_INITIAL_RATING)
                active_season = current_season

            needs_refit = (
                len(dc_history) >= DC_MIN_HISTORY_MATCHES
                and (last_dc_fit_time is None or (match_datetime - last_dc_fit_time).days >= DC_REFIT_INTERVAL_DAYS)
            )
            if needs_refit:
                dc_model = fit_dixon_coles(dc_history, match_datetime)
                last_dc_fit_time = match_datetime

            pending_updates: list[dict[str, Any]] = []
            for _, match in group.iterrows():
                home_team = str(match["home_team"])
                away_team = str(match["away_team"])
                home_rating = float(ratings[home_team])
                away_rating = float(ratings[away_team])
                home_recent = recent_metrics(team_overall_history[home_team])
                away_recent = recent_metrics(team_overall_history[away_team])
                home_home_count, home_home_win_rate = venue_win_rate(team_home_history[home_team])
                away_away_count, away_away_win_rate = venue_win_rate(team_away_history[away_team])

                row: dict[str, Any] = {
                    "match_id": match["match_id"],
                    "league_code": match["league_code"],
                    "league_name": match["league_name"],
                    "season": match["season"],
                    "match_date": match["match_date"],
                    "match_time": match["match_time"],
                    "match_datetime": match_datetime.isoformat(sep=" "),
                    "home_team": home_team,
                    "away_team": away_team,
                    # 訓練標籤，勿作為同列賽前特徵使用。
                    "home_goals": int(match["home_goals"]),
                    "away_goals": int(match["away_goals"]),
                    "result": match["result"],
                    "target_home_win": int(match["result"] == "H"),
                    "target_draw": int(match["result"] == "D"),
                    "target_away_win": int(match["result"] == "A"),
                    "home_elo_pre": home_rating,
                    "away_elo_pre": away_rating,
                    "elo_diff_pre": home_rating - away_rating,
                    "elo_home_expected_score_pre": elo_expected_score(home_rating, away_rating, home_advantage),
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
                    "dc_available": int(dc_model is not None),
                }
                if dc_model is None:
                    for column in [
                        "home_dc_home_attack_strength", "home_dc_home_defense_strength",
                        "away_dc_away_attack_strength", "away_dc_away_defense_strength",
                        "dc_home_baseline_goals", "dc_away_baseline_goals", "dc_expected_home_goals",
                        "dc_expected_away_goals", "dc_rho", "dc_prob_home_win", "dc_prob_draw",
                        "dc_prob_away_win", "dc_fit_match_count",
                    ]:
                        row[column] = np.nan
                else:
                    row.update(dc_model.match_features(home_team, away_team))

                feature_rows.append(row)
                pending_updates.append(match.to_dict())

            # 在輸出同時間點所有特徵後，才更新Elo、最近五場資料及DC歷史。
            for match in pending_updates:
                home_team = str(match["home_team"])
                away_team = str(match["away_team"])
                home_goals = int(match["home_goals"])
                away_goals = int(match["away_goals"])
                home_won = float(home_goals > away_goals)
                away_won = float(away_goals > home_goals)
                home_record = {"goals_for": float(home_goals), "goals_against": float(away_goals), "won": home_won}
                away_record = {"goals_for": float(away_goals), "goals_against": float(home_goals), "won": away_won}
                team_overall_history[home_team].append(home_record)
                team_overall_history[away_team].append(away_record)
                team_home_history[home_team].append(home_record)
                team_away_history[away_team].append(away_record)
                apply_elo_update(ratings, home_team, away_team, home_goals, away_goals, k_factor, home_advantage)
                dc_history.append(match)

    return pd.DataFrame(feature_rows).sort_values(["match_datetime", "match_id"]).reset_index(drop=True)


def validate_features(features: pd.DataFrame) -> None:
    """檢查輸出行數、Elo存在、最近五場窗口上限，以及DC機率加總。"""
    if features.empty:
        raise RuntimeError("特徵資料集為空")
    if features[["home_elo_pre", "away_elo_pre"]].isna().any().any():
        raise RuntimeError("Elo特徵不應有缺值")
    count_columns = ["home_recent5_count", "away_recent5_count", "home_home5_count", "away_away5_count"]
    if (features[count_columns] > 5).any().any():
        raise RuntimeError("最近五場特徵窗口超過5場")
    fitted = features[features["dc_available"] == 1]
    if not fitted.empty:
        sums = fitted[["dc_prob_home_win", "dc_prob_draw", "dc_prob_away_win"]].sum(axis=1)
        if not np.allclose(sums, 1.0, rtol=0.0, atol=1e-7):
            raise RuntimeError("Dixon–Coles勝平負機率未加總為1")
        if (fitted[["dc_expected_home_goals", "dc_expected_away_goals"]] <= 0).any().any():
            raise RuntimeError("Dixon–Coles預期進球必須為正值")


def main() -> None:
    parser = argparse.ArgumentParser(description="建立賽前Elo、近況與Dixon–Coles訓練特徵")
    parser.add_argument("--database", default="football_data.db", help="輸入SQLite資料庫檔案")
    parser.add_argument("--output", default="training_features.csv", help="輸出CSV檔案")
    parser.add_argument("--elo-k", type=float, default=ELO_DEFAULT_K, help="Elo K值")
    parser.add_argument("--elo-home-advantage", type=float, default=ELO_DEFAULT_HOME_ADVANTAGE, help="Elo主場分數優勢")
    args = parser.parse_args()

    database_path = Path(args.database).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    if not database_path.exists():
        raise FileNotFoundError(f"找不到資料庫：{database_path}")
    if args.elo_k <= 0:
        parser.error("--elo-k必須大於0")

    matches = fetch_matches(database_path)
    features = generate_features(matches, args.elo_k, args.elo_home_advantage)
    validate_features(features)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    features.to_csv(output_path, index=False, float_format="%.8f")

    dc_rows = int(features["dc_available"].sum())
    print("=== 特徵資料集建立成功 ===")
    print(f"輸入賽事：{len(matches):,} 場")
    print(f"輸出列數：{len(features):,}")
    print(f"欄位數：{len(features.columns)}")
    print(f"Dixon–Coles可用列數：{dc_rows:,} ({dc_rows / len(features):.1%})")
    print(f"輸出檔案：{output_path}")


if __name__ == "__main__":
    main()
