import { handicapSelectionProbability, handicapWinDistribution, highestOutcome, mainstreamTotals, topScorelines, type CompactMarketRow, type ScorelineProbability } from "@shared/compactResearch";
import { ENV } from "./_core/env";

type CachedMarketSelection = { selection: string; odds: number | null };

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
  hasPrediction: boolean;
  compactMarkets: CompactMarketRow[];
  topScorelines: ScorelineProbability[];
  odds: {
    home: number | null;
    draw: number | null;
    away: number | null;
    capturedAt: string | null;
  } | null;
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

function normalizeOdds(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function parseResearchMetadata(value: unknown) {
  const recommendation = typeof value === "string" ? value : "";
  const marker = "\n[AURELIA_META]";
  const markerIndex = recommendation.indexOf(marker);
  if (markerIndex < 0) return { recommendation: recommendation || null, metadata: null as Record<string, unknown> | null };
  try {
    return {
      recommendation: recommendation.slice(0, markerIndex) || null,
      metadata: JSON.parse(recommendation.slice(markerIndex + marker.length)) as Record<string, unknown>,
    };
  } catch {
    return { recommendation: recommendation.slice(0, markerIndex) || null, metadata: null as Record<string, unknown> | null };
  }
}

function normalizeScorelines(value: unknown): ScorelineProbability[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ScorelineProbability[] => {
    if (!item || typeof item !== "object") return [];
    const fields = item as Record<string, unknown>;
    const probability = normalizeProbability(fields.probability);
    return typeof fields.score === "string" && /^\d+-\d+$/.test(fields.score) && probability !== null ? [{ score: fields.score, probability }] : [];
  }).slice(0, 3);
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
    const fixtures = await queryRows("fixtures?select=fixture_id,league_name,event_time,home_team,away_team,status,updated_at&order=event_time.asc&limit=100");
    const ids = fixtures.map(row => Number(row.fixture_id)).filter(Number.isInteger);
    if (ids.length === 0) {
      const payload: SupabaseUpcomingCache = { source: "Supabase cache", loadedAt, available: true, fixtures: [], lastSyncAt: null };
      cache = { expiresAt: Date.now() + CACHE_MS, payload };
      return payload;
    }
    const [predictions, oddsSnapshots] = await Promise.all([
      queryRows(`ai_predictions?select=fixture_id,home_win_prob,draw_prob,away_win_prob,predicted_score,recommendation,confidence,updated_at&fixture_id=in.(${ids.join(",")})`),
      queryRows(`odds_snapshots?select=fixture_id,market_type,handicap,home_odds,draw_odds,away_odds,snapshot_time&fixture_id=in.(${ids.join(",")})&order=snapshot_time.desc&limit=500`),
    ]);
    const byFixture = new Map(predictions.map(row => [Number(row.fixture_id), row]));
    const oddsByFixture = new Map<number, CachedUpcomingFixture["odds"]>();
    const totalsByFixture = new Map<number, CachedMarketSelection>();
    const handicapByFixture = new Map<number, CachedMarketSelection>();
    const handicap025ByFixture = new Map<number, CachedMarketSelection>();
    const handicap075ByFixture = new Map<number, CachedMarketSelection>();
    const handicap125ByFixture = new Map<number, CachedMarketSelection>();
    const handicap175ByFixture = new Map<number, CachedMarketSelection>();

    for (const snapshot of oddsSnapshots) {
      const fixtureId = Number(snapshot.fixture_id);
      const marketType = typeof snapshot.market_type === "string" ? snapshot.market_type : "";
      if (!Number.isInteger(fixtureId)) continue;
      const selection = typeof snapshot.handicap === "string" ? snapshot.handicap : "";
      const selectionOdds = normalizeOdds(snapshot.home_odds) ?? normalizeOdds(snapshot.away_odds);
      if (marketType.startsWith("TOTALS") && !totalsByFixture.has(fixtureId) && /^(Over|Under)\s+2\.5$/i.test(selection)) {
        totalsByFixture.set(fixtureId, { selection, odds: selectionOdds });
      }
      if (marketType.startsWith("HDC") && !handicap025ByFixture.has(fixtureId) && /^(Home|Away)\s+[+-]?\d+\.25$/i.test(selection)) {
        handicap025ByFixture.set(fixtureId, { selection, odds: selectionOdds });
      }
      if (marketType.startsWith("HDC") && !handicap075ByFixture.has(fixtureId) && /^(Home|Away)\s+[+-]?\d+\.75$/i.test(selection)) {
        handicap075ByFixture.set(fixtureId, { selection, odds: selectionOdds });
      }
      if (marketType.startsWith("HDC") && !handicap125ByFixture.has(fixtureId) && /^(Home|Away)\s+[+-]?1\.25$/i.test(selection)) {
        handicap125ByFixture.set(fixtureId, { selection, odds: selectionOdds });
      }
      if (marketType.startsWith("HDC") && !handicap175ByFixture.has(fixtureId) && /^(Home|Away)\s+[+-]?1\.75$/i.test(selection)) {
        handicap175ByFixture.set(fixtureId, { selection, odds: selectionOdds });
      }
      if (marketType.startsWith("HDC") && !handicapByFixture.has(fixtureId) && /^(Home|Away)\s+[+-]?\d+(?:\.5)?$/i.test(selection)) {
        handicapByFixture.set(fixtureId, { selection, odds: selectionOdds });
      }
      if (oddsByFixture.has(fixtureId) || !marketType.startsWith("HDA")) continue;
      const home = normalizeOdds(snapshot.home_odds);
      const draw = normalizeOdds(snapshot.draw_odds);
      const away = normalizeOdds(snapshot.away_odds);
      if (home === null && draw === null && away === null) continue;
      oddsByFixture.set(fixtureId, {
        home,
        draw,
        away,
        capturedAt: typeof snapshot.snapshot_time === "string" ? snapshot.snapshot_time : null,
      });
    }

    const rows = fixtures.flatMap((fixture): CachedUpcomingFixture[] => {
      const fixtureId = Number(fixture.fixture_id);
      const prediction = byFixture.get(fixtureId);
      const homeWin = normalizeProbability(prediction?.home_win_prob);
      const draw = normalizeProbability(prediction?.draw_prob);
      const awayWin = normalizeProbability(prediction?.away_win_prob);
      const { recommendation, metadata } = parseResearchMetadata(prediction?.recommendation);
      const expectedHomeGoals = normalizeProbability(metadata?.expected_home_goals) ?? null;
      const expectedAwayGoals = normalizeProbability(metadata?.expected_away_goals) ?? null;
      const storedScorelines = normalizeScorelines(metadata?.top_scorelines);
      const handicap = handicapByFixture.get(fixtureId);
      const handicap025 = handicap025ByFixture.get(fixtureId);
      const handicap075 = handicap075ByFixture.get(fixtureId);
      const handicap125 = handicap125ByFixture.get(fixtureId);
      const handicap175 = handicap175ByFixture.get(fixtureId);
      const handicapProbability = handicapSelectionProbability(handicap?.selection, expectedHomeGoals, expectedAwayGoals);
      const handicap025Probability = handicapSelectionProbability(handicap025?.selection, expectedHomeGoals, expectedAwayGoals);
      const handicap075Probability = handicapSelectionProbability(handicap075?.selection, expectedHomeGoals, expectedAwayGoals);
      const handicap125Probability = handicapSelectionProbability(handicap125?.selection, expectedHomeGoals, expectedAwayGoals);
      const handicap175Probability = handicapSelectionProbability(handicap175?.selection, expectedHomeGoals, expectedAwayGoals);
      const handicap025Distribution = handicapWinDistribution(handicap025?.selection, expectedHomeGoals, expectedAwayGoals);
      const handicap075Distribution = handicapWinDistribution(handicap075?.selection, expectedHomeGoals, expectedAwayGoals);
      const handicap125Distribution = handicapWinDistribution(handicap125?.selection, expectedHomeGoals, expectedAwayGoals);
      const handicap175Distribution = handicapWinDistribution(handicap175?.selection, expectedHomeGoals, expectedAwayGoals);
      const outcome = homeWin !== null && draw !== null && awayWin !== null ? highestOutcome(homeWin, draw, awayWin) : null;
      const compactMarkets = [
        outcome,
        ...mainstreamTotals(expectedHomeGoals, expectedAwayGoals),
        handicapProbability !== null && handicap ? { market: "讓球盤 (Handicap)" as const, selection: handicap.selection.replace(/^Home/i, "主隊").replace(/^Away/i, "客隊"), probability: handicapProbability } : null,
        handicap025Probability !== null && handicap025 && handicap025Distribution ? { market: "亞洲讓球 0.25" as const, selection: handicap025.selection.replace(/^Home/i, "主隊").replace(/^Away/i, "客隊"), probability: handicap025Probability, distribution: handicap025Distribution } : null,
        handicap075Probability !== null && handicap075 && handicap075Distribution ? { market: "亞洲讓球 0.75" as const, selection: handicap075.selection.replace(/^Home/i, "主隊").replace(/^Away/i, "客隊"), probability: handicap075Probability, distribution: handicap075Distribution } : null,
        handicap125Probability !== null && handicap125 && handicap125Distribution ? { market: "亞洲讓球 1.25" as const, selection: handicap125.selection.replace(/^Home/i, "主隊").replace(/^Away/i, "客隊"), probability: handicap125Probability, distribution: handicap125Distribution } : null,
        handicap175Probability !== null && handicap175 && handicap175Distribution ? { market: "亞洲讓球 1.75" as const, selection: handicap175.selection.replace(/^Home/i, "主隊").replace(/^Away/i, "客隊"), probability: handicap175Probability, distribution: handicap175Distribution } : null,
      ].filter((item): item is CompactMarketRow => item !== null);
      const eventTime = typeof fixture.event_time === "string" ? fixture.event_time : "";
      const homeTeam = typeof fixture.home_team === "string" ? fixture.home_team : "";
      const awayTeam = typeof fixture.away_team === "string" ? fixture.away_team : "";
      if (!Number.isInteger(fixtureId) || !eventTime || !homeTeam || !awayTeam) return [];
      return [{
        fixtureId,
        leagueName: typeof fixture.league_name === "string" ? fixture.league_name : "Unknown league",
        eventTime,
        homeTeam,
        awayTeam,
        homeWin: homeWin ?? Number.NaN,
        draw: draw ?? Number.NaN,
        awayWin: awayWin ?? Number.NaN,
        predictedScore: typeof prediction?.predicted_score === "string" ? prediction.predicted_score : null,
        recommendation,
        confidence: Math.max(0, Math.min(5, Number(prediction?.confidence) || 0)),
        predictionUpdatedAt: typeof prediction?.updated_at === "string" ? prediction.updated_at : null,
        hasPrediction: !!prediction && homeWin !== null && draw !== null && awayWin !== null,
        compactMarkets,
        topScorelines: storedScorelines.length === 3 ? storedScorelines : topScorelines(expectedHomeGoals, expectedAwayGoals),
        odds: oddsByFixture.get(fixtureId) ?? null,
      }];
    }).sort((left, right) => new Date(left.eventTime).getTime() - new Date(right.eventTime).getTime());
    const lastSyncAt = fixtures.map(row => typeof row.updated_at === "string" ? row.updated_at : null).filter(Boolean).sort().at(-1) ?? null;
    const payload: SupabaseUpcomingCache = {
      source: "Supabase cache",
      loadedAt,
      available: true,
      fixtures: rows,
      fallback: !rows.some(row => {
        const diff = new Date(row.eventTime).getTime() - Date.now();
        return diff >= 0 && diff <= 24 * 60 * 60_000;
      }),
      lastSyncAt,
    };
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
