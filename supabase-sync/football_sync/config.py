from __future__ import annotations

import os
from dataclasses import dataclass, replace


# API-Football popular coverage: major European leagues and cups, Brazil, North
# America, and the Asian leagues supported by the wider Aurelia data registry.
POPULAR_LEAGUE_IDS = frozenset({2, 3, 11, 13, 39, 48, 61, 71, 78, 94, 98, 135, 140, 188, 253, 262, 292})


@dataclass(frozen=True)
class Settings:
    api_football_key: str
    supabase_url: str | None
    supabase_key: str | None
    max_fixtures: int = 30
    history_matches: int = 10
    league_ids: frozenset[int] = POPULAR_LEAGUE_IDS

    @classmethod
    def from_env(cls) -> "Settings":
        api_key = os.getenv("API_FOOTBALL_KEY", "").strip()
        if not api_key:
            raise RuntimeError("API_FOOTBALL_KEY is required")
        return cls(
            api_football_key=api_key,
            supabase_url=os.getenv("SUPABASE_URL", "").strip() or None,
            supabase_key=(os.getenv("SUPABASE_SECRET_KEY", "").strip() or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip() or None),
        )

    def with_max_fixtures(self, value: int) -> "Settings":
        if not 1 <= value <= 30:
            raise ValueError("max fixtures must be between 1 and 30")
        return replace(self, max_fixtures=value)
