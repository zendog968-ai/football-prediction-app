import { ENV } from "./_core/env";

export type CachedUpcomingFixture = {
  fixtureId: number;
  leagueName: string;
  eventTime: string;
  homeTeam: string;
  awayTeam: string;
  homeWin: number;
  draw: number;
  awayWin: number;
  predictedScore: string | null;
  recommendation: string | null;
  confidence: number;
  predictionUpdatedAt: string | null;
};

export type SupabaseUpcomingCache = {
  source: "Supabase cache";
  loadedAt: string;
  available: boolean;
  reason?: string;
  fallback?: boolean;
  lastSyncAt?: string | null;
  fixtures: CachedUpcomingFixture[];
};

const CACHE_MS = 30_000;
let cache: { expiresAt: number; payload: SupabaseUpcomingCache } | null = null;

function normalizeProbability(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function postgrestUrl(path: string): URL {
  if (!ENV.supabaseUrl || !ENV.supabaseSecretKey) throw new Error("Supabase server cache is not configured");
  return new URL(`/rest/v1/${path}`, ENV.supabaseUrl);
}

async function queryRows(path: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(postgrestUrl(path), {
    headers: {
      apikey: ENV.supabaseSecretKey,
      Authorization: `Bearer ${ENV.supabaseSecretKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Supabase cache query failed (${response.status})`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Supabase cache returned an invalid payload");
  return payload as Array<Record<string, unknown>>;
}

export async function getSupabaseUpcomingCache(force = false): Promise<SupabaseUpcomingCache> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.payload;
  const loadedAt = new Date().toISOString();
  try {
    const fixtures = await queryRows(`fixtures?select=fixture_id,league_name,event_time,home_team,away_team,status,updated_at&order=event_time.asc&limit=100`);
    const ids = fixtures.map(row => Number(row.fixture_id)).filter(Number.isInteger);
    if (ids.length === 0) {
      const payload: SupabaseUpcomingCache = { source: "Supabase cache", loadedAt, available: true, fixtures: [], lastSyncAt: null };
      cache = { expiresAt: Date.now() + CACHE_MS, payload };
      return payload;
    }
    const predictions = await queryRows(`ai_predictions?select=fixture_id,home_win_prob,draw_prob,away_win_prob,predicted_score,recommendation,confidence,updated_at&fixture_id=in.(${ids.join(",")})`);
    const byFixture = new Map(predictions.map(row => [Number(row.fixture_id), row]));
    const rows = fixtures.flatMap((fixture): CachedUpcomingFixture[] => {
      const prediction = byFixture.get(Number(fixture.fixture_id));
      const homeWin = normalizeProbability(prediction?.home_win_prob);
      const draw = normalizeProbability(prediction?.draw_prob);
      const awayWin = normalizeProbability(prediction?.away_win_prob);
      const eventTime = typeof fixture.event_time === "string" ? fixture.event_time : "";
      const homeTeam = typeof fixture.home_team === "string" ? fixture.home_team : "";
      const awayTeam = typeof fixture.away_team === "string" ? fixture.away_team : "";
      if (!eventTime || !homeTeam || !awayTeam) return [];
      return [{
        fixtureId: Number(fixture.fixture_id),
        leagueName: typeof fixture.league_name === "string" ? fixture.league_name : "Unknown league",
        eventTime,
        homeTeam,
        awayTeam,
        homeWin: homeWin ?? 0,
        draw: draw ?? 0,
        awayWin: awayWin ?? 0,
        predictedScore: typeof prediction?.predicted_score === "string" ? prediction.predicted_score : null,
        recommendation: typeof prediction?.recommendation === "string" ? prediction.recommendation : null,
        confidence: Math.max(0, Math.min(5, Number(prediction?.confidence) || 0)),
        predictionUpdatedAt: typeof prediction?.updated_at === "string" ? prediction.updated_at : null,
      }];
    }).sort((left, right) => new Date(left.eventTime).getTime() - new Date(right.eventTime).getTime());
    const lastSyncAt = fixtures.map(row => typeof row.updated_at === "string" ? row.updated_at : null).filter(Boolean).sort().at(-1) ?? null;
    const payload: SupabaseUpcomingCache = { source: "Supabase cache", loadedAt, available: true, fixtures: rows, fallback: !rows.some(row => {
      const diff = new Date(row.eventTime).getTime() - Date.now(); return diff >= 0 && diff <= 24 * 60 * 60_000;
    }), lastSyncAt };
    cache = { expiresAt: Date.now() + CACHE_MS, payload };
    return payload;
  } catch (error) {
    const payload: SupabaseUpcomingCache = { source: "Supabase cache", loadedAt, available: false, reason: error instanceof Error ? error.message : "unknown cache failure", fixtures: [] };
    cache = { expiresAt: Date.now() + 10_000, payload };
    return payload;
  }
}

export function __resetSupabaseUpcomingCacheForTests() {
  cache = null;
}
