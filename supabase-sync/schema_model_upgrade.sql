-- Additive schema for the Aurelia research-model upgrade.
-- Apply in Supabase SQL Editor with a project database owner before enabling feature writes.
create table if not exists public.model_feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  fixture_id bigint not null references public.fixtures(fixture_id) on delete cascade,
  model_version text not null,
  generated_at timestamptz not null default now(),
  home_weighted5_goals_for numeric,
  home_weighted5_goals_against numeric,
  away_weighted5_goals_for numeric,
  away_weighted5_goals_against numeric,
  home_home5_goals_for numeric,
  home_home5_goals_against numeric,
  away_away5_goals_for numeric,
  away_away5_goals_against numeric,
  home_rest_days numeric,
  away_rest_days numeric,
  home_elo numeric,
  away_elo numeric,
  home_xg_weighted5 numeric,
  away_xg_weighted5 numeric,
  xg_source_available boolean not null default false,
  dc_rho numeric,
  market_implied_home numeric,
  market_implied_draw numeric,
  market_implied_away numeric,
  unique (fixture_id, model_version, generated_at)
);

create index if not exists model_feature_snapshots_fixture_generated_idx
  on public.model_feature_snapshots (fixture_id, generated_at desc);

alter table public.model_feature_snapshots enable row level security;
