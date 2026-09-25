from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests


LOGGER = logging.getLogger(__name__)
DEFAULT_TEAM_TRANSLATIONS_TABLE = "team_translations"
TEAM_TRANSLATION_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class TelegramNotificationError(RuntimeError):
    pass


def format_kickoff_hkt(value: str | None) -> str:
    """Format an ISO-8601 kickoff instant in Hong Kong time for Telegram."""
    if not value:
        return "資料不足"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo("UTC"))
        return parsed.astimezone(ZoneInfo("Asia/Hong_Kong")).strftime("%Y-%m-%d %H:%M (HKT)")
    except (TypeError, ValueError):
        return "資料不足"


def telegram_configured() -> bool:
    return bool(os.getenv("TELEGRAM_BOT_TOKEN", "").strip() and os.getenv("TELEGRAM_CHAT_ID", "").strip())


def send_message(text: str) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("Telegram notification skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured")
        return
    response = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    if not payload.get("ok"):
        raise TelegramNotificationError("Telegram API rejected notification")


def _canonical_team_name(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


def _configured_team_translation_table() -> str:
    table = os.getenv("SUPABASE_TEAM_TRANSLATIONS_TABLE", DEFAULT_TEAM_TRANSLATIONS_TABLE).strip()
    if TEAM_TRANSLATION_IDENTIFIER.fullmatch(table):
        return table
    LOGGER.warning("Invalid SUPABASE_TEAM_TRANSLATIONS_TABLE; using %s", DEFAULT_TEAM_TRANSLATIONS_TABLE)
    return DEFAULT_TEAM_TRANSLATIONS_TABLE


def load_team_translations(team_names: set[str]) -> dict[str, str]:
    """Load verified Chinese team names without blocking Telegram delivery."""
    requested = {_canonical_team_name(name) for name in team_names if _canonical_team_name(name)}
    url_base = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_SECRET_KEY", "").strip() or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not requested or not url_base or not key:
        return {}

    try:
        response = requests.get(
            f"{url_base}/rest/v1/{_configured_team_translation_table()}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            params={"select": "*", "limit": "1000"},
            timeout=10,
        )
        response.raise_for_status()
        rows = response.json()
    except (requests.RequestException, ValueError) as exc:
        LOGGER.warning("Unable to load team translations; keeping source names: %s", exc)
        return {}

    if not isinstance(rows, list):
        LOGGER.warning("Supabase team translations response was not a list")
        return {}

    translations: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        english_name = next(
            (row.get(column) for column in ("english_name", "team_name", "name") if row.get(column)),
            None,
        )
        translated = next(
            (row.get(column) for column in ("name_zh_hk", "name_zh_tw") if str(row.get(column) or "").strip()),
            None,
        )
        key_name = _canonical_team_name(english_name)
        if key_name in requested and translated:
            translations[key_name] = str(translated).strip()
    return translations


def localized_team_name(source_name: str, translations: dict[str, str]) -> str:
    return translations.get(_canonical_team_name(source_name), source_name)


def format_success(report: dict[str, Any]) -> str:
    counts = report.get("counts", {})
    predictions = report.get("predictions", [])[:2]
    translations = load_team_translations(
        {str(item.get("home_team", "")) for item in predictions}
        | {str(item.get("away_team", "")) for item in predictions}
    )
    lines = [
        "Aurelia Football｜同步研究摘要",
        f"同步：{counts.get('fixtures', 0)}場｜盤口：{counts.get('odds_snapshots', 0)}筆｜研究模型：{counts.get('ai_predictions', 0)}場",
    ]
    if predictions:
        lines.append("當日模型訊號（僅供研究）：")
        for item in predictions:
            home_team = localized_team_name(str(item["home_team"]), translations)
            away_team = localized_team_name(str(item["away_team"]), translations)
            lines.append(
                f"• {item['league']}｜{home_team} vs {away_team}｜"
                f"開賽 {format_kickoff_hkt(item.get('kickoff_at'))}｜"
                f"最可能比分 {item['score']}｜{item['lean']}｜證據 {'⭐' * item['stars']}"
            )
    else:
        lines.append("本輪沒有符合歷史樣本門檻的研究模型輸出。")
    lines.append("研究用途：非投注、非資金建議；請留意資料時間與樣本限制。")
    return "\n".join(lines)


def format_failure(detail: str) -> str:
    safe_detail = detail.strip().replace("\n", " ")[:350]
    return "\n".join([
        "Aurelia Football｜同步警報",
        "資料同步在三次嘗試後仍未完成；本輪未發布新的研究摘要。",
        f"原因：{safe_detail or '未提供詳細錯誤'}",
        "請到GitHub Actions查看執行紀錄；系統不會以缺失資料填補預測。",
    ])


def notify_from_report(path: Path) -> None:
    report = json.loads(path.read_text(encoding="utf-8"))
    send_message(format_success(report))
