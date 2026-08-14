from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import requests


class TelegramNotificationError(RuntimeError):
    pass


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


def format_success(report: dict[str, Any]) -> str:
    counts = report.get("counts", {})
    predictions = report.get("predictions", [])[:2]
    lines = [
        "Aurelia Football｜同步研究摘要",
        f"同步：{counts.get('fixtures', 0)}場｜盤口：{counts.get('odds_snapshots', 0)}筆｜研究模型：{counts.get('ai_predictions', 0)}場",
    ]
    if predictions:
        lines.append("當日模型訊號（僅供研究）：")
        for item in predictions:
            lines.append(
                f"• {item['league']}｜{item['home_team']} vs {item['away_team']}｜"
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
