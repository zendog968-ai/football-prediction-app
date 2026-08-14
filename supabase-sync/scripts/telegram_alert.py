#!/usr/bin/env python3
"""Send optional research-only Telegram summaries for the GitHub sync workflow."""

from __future__ import annotations

import argparse
from pathlib import Path

from football_sync.telegram import format_failure, notify_from_report, send_message


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("success", "failure"), required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--detail", default="")
    args = parser.parse_args()
    if args.kind == "success":
        if not args.report or not args.report.exists():
            raise RuntimeError("success notification requires an existing --report JSON file")
        notify_from_report(args.report)
        return
    send_message(format_failure(args.detail))


if __name__ == "__main__":
    main()
