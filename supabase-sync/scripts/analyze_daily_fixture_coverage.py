from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize a daily API-Football fixture payload.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    rows = payload.get("response", [])
    leagues = Counter((item.get("league", {}).get("id"), item.get("league", {}).get("name"), item.get("league", {}).get("country")) for item in rows)
    countries = Counter((country or "Unknown") for _, _, country in leagues for _ in range(1))
    summary = {
        "fixtures": len(rows),
        "leagues": len(leagues),
        "countries": len(countries),
        "fixtures_by_country": Counter(item.get("league", {}).get("country") or "Unknown" for item in rows).most_common(),
        "leagues": [
            {"league_id": league_id, "league_name": name, "country": country, "fixtures": count}
            for (league_id, name, country), count in sorted(leagues.items(), key=lambda item: (str(item[0][2]), str(item[0][1])))
        ],
    }
    if args.output:
        args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "fixtures": summary["fixtures"],
        "leagues": len(leagues),
        "countries": len(countries),
        "top_countries": summary["fixtures_by_country"][:20],
        "sample_leagues": summary["leagues"][:30],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
