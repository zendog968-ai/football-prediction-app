-- Run this file in Supabase SQL Editor before the first sync.
-- It is additive and creates only the three tables required by the Python runner.
create extension if not exists pgcrypto;

create table if not exists public.fixtures (
  api_fixture_id bigint primary key,
  league_id integer,
  league_name text,
  season integer,
  kickoff_at timestamptz not null,
  status text,
  home_team_id bigint not null,
  home_team text not null,
  away_team_id bigint not null,
  away_team text not null,
  home_goals integer,
  away_goals integer,
  halftime_home_goals integer,
  halftime_away_goals integer,
  source_updated_at bigint,
  synced_at timestamptz not null default now()
);

create index if not exists fixtures_kickoff_idx on public.fixtures (kickoff_at);

create table if not exists public.odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id bigint not null references public.fixtures(api_fixture_id) on delete cascade,
  bookmaker_id integer not null,
  bookmaker_name text not null,
  market_code text not null check (market_code in ('HDA', 'HDC', 'TOTALS')),
  market_name text not null,
  selection text not null,
  decimal_odds numeric(8,3) not null check (decimal_odds > 1),
  source_updated_at timestamptz,
  captured_at timestamptz not null,
  unique (api_fixture_id, bookmaker_id, market_code, selection, captured_at)
);

create index if not exists odds_fixture_market_captured_idx on public.odds_snapshots (api_fixture_id, market_code, captured_at desc);

create table if not exists public.ai_predictions (
  id uuid primary key default gen_random_uuid(),
  prediction_key text unique not null,
  api_fixture_id bigint not null references public.fixtures(api_fixture_id) on delete cascade,
  model_version text not null,
  generated_at timestamptz not null,
  home_win_probability numeric(8,6) not null,
  draw_probability numeric(8,6) not null,
  away_win_probability numeric(8,6) not null,
  expected_home_goals numeric(8,4) not null,
  expected_away_goals numeric(8,4) not null,
  most_likely_score text not null,
  over_2_5_probability numeric(8,6) not null,
  btts_probability numeric(8,6) not null,
  research_lean text not null,
  evidence_stars smallint not null check (evidence_stars between 1 and 5),
  data_warning text
);

create index if not exists predictions_fixture_generated_idx on public.ai_predictions (api_fixture_id, generated_at desc);

-- Apply least privilege before using browser-facing publishable keys. The hourly job should use
-- only a server-side secret key stored in GitHub Actions secrets.
alter table public.fixtures enable row level security;
alter table public.odds_snapshots enable row level security;
alter table public.ai_predictions enable row level security;
