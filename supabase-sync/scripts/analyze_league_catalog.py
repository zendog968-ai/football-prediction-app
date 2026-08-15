from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize an API-Football leagues response without exposing credentials.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--countries", nargs="*", help="Optional exact API country names to list in full")
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    rows = payload.get("response", [])
    records = [{
        "id": item.get("league", {}).get("id"),
        "name": item.get("league", {}).get("name"),
        "type": item.get("league", {}).get("type"),
        "country": item.get("country", {}).get("name"),
        "code": item.get("country", {}).get("code"),
        "current_seasons": [season.get("year") for season in item.get("seasons", []) if season.get("current") is True],
    } for item in rows]
    records = [record for record in records if isinstance(record["id"], int) and isinstance(record["name"], str)]
    countries = Counter(str(record["country"] or "Unknown") for record in records)
    types = Counter(str(record["type"] or "Unknown") for record in records)
    summary = {
        "total_leagues": len(records),
        "countries": len(countries),
        "by_type": dict(types.most_common()),
        "countries_with_most_leagues": countries.most_common(30),
        "examples": records[:20],
    }
    if args.output:
        args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.countries:
        wanted = set(args.countries)
        selected = [record for record in records if record["country"] in wanted]
        print(json.dumps({"selected_countries": sorted(wanted), "leagues": sorted(selected, key=lambda record: (str(record["country"]), str(record["name"])))}, ensure_ascii=False, indent=2))
        return
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
