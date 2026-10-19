#!/usr/bin/env python3
"""Send one deployment-status message, never claim a prediction-card smoke test."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
from urllib import request
from urllib.parse import urlsplit


class NotificationError(RuntimeError):
    pass


def make_message(status: str, sha: str, run_url: str, receipt: dict | None) -> str:
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise NotificationError("Invalid deployment SHA")
    url = urlsplit(run_url)
    if url.scheme != "https" or url.netloc != "github.com" or not re.fullmatch(r"/zendog968-ai/football-prediction-app/actions/runs/[0-9]+", url.path) or url.query or url.fragment:
        raise NotificationError("Invalid Actions run URL")
    if status == "success":
        if not receipt or receipt.get("status") != "deployed" or receipt.get("releaseSha") != sha or receipt.get("policyVerified") is not True:
            raise NotificationError("Cannot send deployment success without verified Home evidence")
        heading = "Aurelia Football｜Home 部署完成"
        detail = "已驗證運行版本與5／5／20研究政策；高信心、投注與EV訊號停用。"
    else:
        heading = "Aurelia Football｜Home 部署未完成"
        detail = "部署流程失敗；請查看執行紀錄及回滾狀態，勿視為已更新正式服務。"
    return f"{heading}\n版本：{sha[:12]}\n{detail}\n{run_url}\n這是部署狀態通知，不是賽事預測或完整圖卡測試。"


def send(token: str, chat_id: str, text: str) -> dict:
    if not token or not re.fullmatch(r"-?[0-9]+", chat_id):
        raise NotificationError("TELEGRAM_BOT_TOKEN and numeric TELEGRAM_CHAT_ID are required")
    body = json.dumps({"chat_id": chat_id, "text": text, "disable_web_page_preview": True}).encode()
    req = request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=body, headers={"Content-Type": "application/json"})
    try:
        with request.urlopen(req, timeout=30) as response:
            payload = json.load(response)
    except Exception as exc:
        # Do not print an exception or URL containing the Bot token; no blind retries.
        raise NotificationError("Telegram status delivery failed or is uncertain; no automatic resend") from exc
    if not isinstance(payload, dict):
        raise NotificationError("Telegram returned an invalid receipt")
    result = payload.get("result", {})
    if not isinstance(result, dict) or payload.get("ok") is not True or type(result.get("message_id")) is not int:
        raise NotificationError("Telegram did not return a verified message receipt")
    return {"ok": True, "messageId": result["message_id"], "kind": "deployment-status"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", choices=("success", "failure", "cancelled"), required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--run-url", required=True)
    parser.add_argument("--deployment-receipt", type=Path, required=True)
    parser.add_argument("--receipt-out", type=Path, required=True)
    args = parser.parse_args()
    receipt = json.loads(args.deployment_receipt.read_text()) if args.deployment_receipt.exists() else None
    text = make_message(args.status, args.sha, args.run_url, receipt)
    result = send(os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(), os.environ.get("TELEGRAM_CHAT_ID", "").strip(), text)
    args.receipt_out.write_text(json.dumps({**result, "releaseSha": args.sha}, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (NotificationError, ValueError) as exc:
        raise SystemExit(str(exc) if isinstance(exc, NotificationError) else "Invalid deployment receipt") from None
