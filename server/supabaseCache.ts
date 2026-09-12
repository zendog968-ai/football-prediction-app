import { handicapSelectionProbability, handicapWinDistribution, highestOutcome, mainstreamTotals, topScorelines, type CompactMarketRow, type ScorelineProbability } from "@shared/compactResearch";
import { ENV } from "./_core/env";

type CachedMarketSelection = { selection: string; odds: number | null };
export type CachedHandicapTrend = {
  homeDirection: "up" | "down" | "flat";
  awayDirection: "up" | "down" | "flat";
  homeDelta: number;
  awayDelta: number;
  sampleCount: number;
  windowMinutes: number;
  firstCapturedAt: string;
  latestCapturedAt: string;
};

export type CachedHandicapQuote = {
  source: string;
  homeLine: string;
  homeOdds: number;
  awayLine: string;
  awayOdds: number;
  capturedAt: string | null;
  trend?: CachedHandicapTrend;
};
type CachedTraditionalTranslation = { nameZhHk: string | null; nameZhTw: string | null };

export type CachedUpcomingFixture = {
  fixtureId: number;
  leagueName: string;
  leagueTranslation?: CachedTraditionalTranslation;
  eventTime: string;
  homeTeam: string;
  homeTeamTranslation?: CachedTraditionalTranslation;
  awayTeam: string;
  awayTeamTranslation?: CachedTraditionalTranslation;
  homeWin: number;
  draw: number;
  awayWin: number;
  predictedScore: string | null;
  recommendation: string | null;
  researchSource?: string | null;
  confidence: number;
  predictionUpdatedAt: string | null;
  hasPrediction: boolean;
  compactMarkets: CompactMarketRow[];
  topScorelines: ScorelineProbability[];
  expectedHomeGoals: number | null;
  expectedAwayGoals: number | null;
  odds: {
    home: number | null;
    draw: number | null;
    away: number | null;
    capturedAt: string | null;
  } | null;
  handicapQuote: CachedHandicapQuote | null;
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

function normalizeExpectedGoals(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 6 ? parsed : null;
}

function normalizeOdds(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

type RawHandicapSelection = {
  fixtureId: number;
  source: string;
  side: "Home" | "Away";
  line: number;
  odds: number;
  capturedAt: string | null;
};

function parseHandicapSelection(snapshot: Record<string, unknown>): RawHandicapSelection | null {
  const fixtureId = Number(snapshot.fixture_id);
  const marketType = typeof snapshot.market_type === "string" ? snapshot.market_type : "";
  const selection = typeof snapshot.handicap === "string" ? snapshot.handicap.trim() : "";
  const match = /^(Home|Away)\s+([+-]?\d+(?:\.\d+)?)$/i.exec(selection);
  const odds = normalizeOdds(snapshot.home_odds) ?? normalizeOdds(snapshot.away_odds);
  if (!Number.isInteger(fixtureId) || !marketType.startsWith("HDC") || !match || odds === null) return null;
  return {
    fixtureId,
    source: marketType.split("|").slice(1).join("|").trim() || "API-Football Asian Handicap",
    side: match[1]!.toLowerCase() === "home" ? "Home" : "Away",
    line: Number(match[2]),
    odds,
    capturedAt: typeof snapshot.snapshot_time === "string" ? snapshot.snapshot_time : null,
  };
}

function formatHandicapLine(value: number): string {
  return `${value >= 0 ? "+" : ""}${Number.isInteger(value) ? value.toFixed(0) : value.toString()}`;
}

function mapTraditionalTranslation(row: Record<string, unknown>): CachedTraditionalTranslation {
  return {
    nameZhHk: typeof row.name_zh_hk === "string" ? row.name_zh_hk : null,
    nameZhTw: typeof row.name_zh_tw === "string" ? row.name_zh_tw : null,
  };
}

type HandicapPair = {
  source: string;
  home: RawHandicapSelection;
  away: RawHandicapSelection;
};

function getHandicapPairs(rows: Array<Record<string, unknown>>, fixtureId: number): HandicapPair[] {
  const selections = rows.flatMap(row => {
    const parsed = parseHandicapSelection(row);
    return parsed?.fixtureId === fixtureId ? [parsed] : [];
  });
  const pairs: HandicapPair[] = [];
  for (const row of rows) {
    const parsed = parseHandicapSelection(row);
    const homeOdds = normalizeOdds(row.home_odds);
    const awayOdds = normalizeOdds(row.away_odds);
    if (parsed?.fixtureId !== fixtureId || parsed.side !== "Home" || homeOdds === null || awayOdds === null) continue;
    pairs.push({
      source: parsed.source,
      home: { ...parsed, odds: homeOdds },
      away: { ...parsed, side: "Away", line: -parsed.line, odds: awayOdds },
    });
  }
  for (const home of selections.filter(item => item.side === "Home")) {
    const sameTimestamp = selections.find(item => item.side === "Away"
      && item.source === home.source
      && Math.abs(item.line + home.line) < 0.001
      && item.capturedAt === home.capturedAt);
    const away = sameTimestamp ?? selections.find(item => item.side === "Away"
      && item.source === home.source
      && Math.abs(item.line + home.line) < 0.001);
    if (away) pairs.push({ source: home.source, home, away });
  }
  return pairs;
}

function buildHandicapTrend(pairs: HandicapPair[], selected: HandicapPair): CachedHandicapTrend | undefined {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const samples = pairs
    .filter(pair => pair.source === selected.source && Math.abs(pair.home.line - selected.home.line) < 0.001)
    .flatMap(pair => {
      const capturedAt = pair.home.capturedAt ?? pair.away.capturedAt;
      const timestamp = capturedAt ? Date.parse(capturedAt) : Number.NaN;
      if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now + 5 * 60 * 1000) return [];
      return [{ timestamp, capturedAt: capturedAt!, homeOdds: pair.home.odds, awayOdds: pair.away.odds }];
    })
    .sort((left, right) => left.timestamp - right.timestamp)
    .filter((sample, index, all) => index === 0 || sample.timestamp !== all[index - 1]!.timestamp);
  if (samples.length < 2) return undefined;
  const first = samples[0]!;
  const latest = samples.at(-1)!;
  const homeDelta = Number((latest.homeOdds - first.homeOdds).toFixed(3));
  const awayDelta = Number((latest.awayOdds - first.awayOdds).toFixed(3));
  const direction = (delta: number): "up" | "down" | "flat" => Math.abs(delta) < 0.005 ? "flat" : delta > 0 ? "up" : "down";
  return {
    homeDirection: direction(homeDelta),
    awayDirection: direction(awayDelta),
    homeDelta,
    awayDelta,
    sampleCount: samples.length,
    windowMinutes: Math.round((latest.timestamp - first.timestamp) / 60000),
    firstCapturedAt: first.capturedAt,
    latestCapturedAt: latest.capturedAt,
  };
}

function pickHandicapQuote(rows: Array<Record<string, unknown>>, fixtureId: number): CachedUpcomingFixture["handicapQuote"] {
  const pairs = getHandicapPairs(rows, fixtureId);
  if (!pairs.length) return null;
  const selected = [...pairs].sort((left, right) => {
    const leftTime = Date.parse(left.home.capturedAt ?? "");
    const rightTime = Date.parse(right.home.capturedAt ?? "");
    return rightTime - leftTime || Math.abs(left.home.line) - Math.abs(right.home.line);
  })[0]!;
  const trend = buildHandicapTrend(pairs, selected);
  return {
    source: selected.source,
    homeLine: formatHandicapLine(selected.home.line),
    homeOdds: selected.home.odds,
    awayLine: formatHandicapLine(selected.away.line),
    awayOdds: selected.away.odds,
    capturedAt: selected.home.capturedAt ?? selected.away.capturedAt,
    ...(trend ? { trend } : {}),
  };
}

function parseResearchMetadata(value: unknown) {
  const recommendation = typeof value === "string" ? value : "";
  const marker = "\n[AURELIA_META]";
  const markerIndex = recommendation.indexOf(marker);
  if (markerIndex < 0) {
    const compactMarker = "\n[M]";
    const compactIndex = recommendation.indexOf(compactMarker);
    if (compactIndex < 0) return { recommendation: recommendation || null, metadata: null as Record<string, unknown> | null };
    const [h, a, s, r] = recommendation.slice(compactIndex + compactMarker.length).split(",");
    const home = Number(h);
    const away = Number(a);
    const rho = Number(r);
    return {
      recommendation: recommendation.slice(0, compactIndex) || null,
      metadata: Number.isFinite(home) && Number.isFinite(away)
        ? { h: home, a: away, s, r: Number.isFinite(rho) ? rho : null }
        : null,
    };
  }
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(postgrestUrl(path), {
      headers: {
        apikey: ENV.supabaseSecretKey,
        Authorization: `Bearer ${ENV.supabaseSecretKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Supabase cache request timed out after 12 seconds");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const detail = typeof response.text === "function" ? (await response.text()).slice(0, 240).replace(/\s+/g, " ").trim() : "";
    throw new Error(`Supabase cache query failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Supabase cache returned an invalid payload");
  return payload as Array<Record<string, unknown>>;
}

async function queryPagedRows(path: string, pageSize = 1000, maxPages = 5): Promise<Array<Record<string, unknown>>> {
  const result: Array<Record<string, unknown>> = [];
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await queryRows(`${path}&limit=${pageSize}&offset=${page * pageSize}`);
    result.push(...rows);
    if (rows.length < pageSize) break;
  }
  return result;
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function queryFixtureRelatedRows(select: string, ids: number[]): Promise<Array<Record<string, unknown>>> {
  const rows = await Promise.all(chunks(ids, 60).map(group => queryRows(`${select}&fixture_id=in.(${group.join(",")})`)));
  return rows.flat();
}

async function queryTranslationRows(table: "team_translations" | "league_translations", names: string[]): Promise<Array<Record<string, unknown>>> {
  const unique = Array.from(new Set(names.map(name => name.trim()).filter(Boolean)));
  if (!unique.length) return [];
  try {
    const groups = chunks(unique, 40);
    const rows = await Promise.all(groups.map(group => {
      const quoted = group.map(name => `"${name.replace(/"/g, "\\\"")}"`).join(",");
      return queryRows(`${table}?select=english_name,name_zh_hk,name_zh_tw&english_name=in.(${quoted})`);
    }));
    return rows.flat();
  } catch (error) {
    if (error instanceof Error && (error.message.includes("(404)") || error.message.includes("PGRST205"))) return [];
    throw error;
  }
}

export async function getSupabaseUpcomingCache(force = false): Promise<SupabaseUpcomingCache> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.payload;
  const loadedAt = new Date().toISOString();
  try {
    const now = encodeURIComponent(new Date().toISOString());
    const horizon = encodeURIComponent(new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString());
    const fixtures = await queryPagedRows(`fixtures?select=fixture_id,league_name,event_time,home_team,away_team,status,updated_at&event_time=gte.${now}&event_time=lt.${horizon}&order=event_time.asc`, 500, 2);
    const ids = fixtures.map(row => Number(row.fixture_id)).filter(Number.isInteger);
    if (ids.length === 0) {
      const payload: SupabaseUpcomingCache = { source: "Supabase cache", loadedAt, available: true, fixtures: [], lastSyncAt: null };
      cache = { expiresAt: Date.now() + CACHE_MS, payload };
      return payload;
    }
    const teamNames = fixtures.flatMap(fixture => [String(fixture.home_team ?? ""), String(fixture.away_team ?? "")]);
    const leagueNames = fixtures.map(fixture => String(fixture.league_name ?? ""));
    const [predictions, oddsSnapshots, teamTranslations, leagueTranslations] = await Promise.all([
      queryFixtureRelatedRows("ai_predictions?select=fixture_id,home_win_prob,draw_prob,away_win_prob,predicted_score,recommendation,confidence,updated_at", ids),
      queryFixtureRelatedRows("odds_snapshots?select=fixture_id,market_type,handicap,home_odds,draw_odds,away_odds,snapshot_time&order=snapshot_time.desc", ids),
      queryTranslationRows("team_translations", teamNames),
      queryTranslationRows("league_translations", leagueNames),
    ]);
    const teamTranslationByName = new Map(teamTranslations.map(row => [String(row.english_name), mapTraditionalTranslation(row)]));
    const leagueTranslationByName = new Map(leagueTranslations.map(row => [String(row.english_name), mapTraditionalTranslation(row)]));
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
      const expectedHomeGoals = normalizeExpectedGoals(metadata?.expected_home_goals ?? metadata?.h) ?? null;
      const expectedAwayGoals = normalizeExpectedGoals(metadata?.expected_away_goals ?? metadata?.a) ?? null;
      const storedScorelines = normalizeScorelines(metadata?.top_scorelines);
      const sourceCode = typeof metadata?.s === "string" ? metadata.s : null;
      const researchSource = typeof metadata?.research_source === "string"
        ? metadata.research_source
        : sourceCode === "英冠校準" || sourceCode === "CD"
          ? "英冠正式聯賽樣本＋聯賽平均及主場優勢校準"
          : sourceCode === "CE"
            ? "英冠正式聯賽樣本＋主場優勢校準；HDA去水融合"
            : sourceCode === "E"
              ? "Dixon–Coles模型＋HDA去水融合"
              : sourceCode === "D"
                ? "Dixon–Coles模型"
                : sourceCode === "隊史" ? "隊伍歷史攻防" : null;
      const handicap = handicapByFixture.get(fixtureId);
      const handicap025 = handicap025ByFixture.get(fixtureId);
      const handicap075 = handicap075ByFixture.get(fixtureId);
      const handicap125 = handicap125ByFixture.get(fixtureId);
      const handicap175 = handicap175ByFixture.get(fixtureId);
      const handicapProbability = handicapSelectionProbability(handicap?.selection, expectedHomeGoals, expectedAwayGoals);
      const handicapDistribution = handicapWinDistribution(handicap?.selection, expectedHomeGoals, expectedAwayGoals);
      const fallbackHandicapSelection = homeWin !== null && awayWin !== null && expectedHomeGoals !== null && expectedAwayGoals !== null
        ? (homeWin >= awayWin ? "Home -0.5" : "Away +0.5")
        : null;
      const fallbackHandicapProbability = handicapSelectionProbability(fallbackHandicapSelection, expectedHomeGoals, expectedAwayGoals);
      const fallbackHandicapDistribution = handicapWinDistribution(fallbackHandicapSelection, expectedHomeGoals, expectedAwayGoals);
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
        handicapProbability !== null && handicap && handicapDistribution ? { market: "讓球盤 (Handicap)" as const, selection: handicap.selection.replace(/^Home/i, "主隊").replace(/^Away/i, "客隊"), probability: handicapProbability, distribution: handicapDistribution } : fallbackHandicapProbability !== null && fallbackHandicapSelection && fallbackHandicapDistribution ? { market: "讓球盤 (Handicap)" as const, selection: `${fallbackHandicapSelection.replace(/^Home/i, "主隊").replace(/^Away/i, "客隊")}（模型參考）`, probability: fallbackHandicapProbability, distribution: fallbackHandicapDistribution } : null,
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
        leagueTranslation: leagueTranslationByName.get(String(fixture.league_name)),
        eventTime,
        homeTeam,
        homeTeamTranslation: teamTranslationByName.get(homeTeam),
        awayTeam,
        awayTeamTranslation: teamTranslationByName.get(awayTeam),
        homeWin: homeWin ?? Number.NaN,
        draw: draw ?? Number.NaN,
        awayWin: awayWin ?? Number.NaN,
        predictedScore: typeof prediction?.predicted_score === "string" ? prediction.predicted_score : null,
        recommendation,
        researchSource,
        confidence: Math.max(0, Math.min(5, Number(prediction?.confidence) || 0)),
        predictionUpdatedAt: typeof prediction?.updated_at === "string" ? prediction.updated_at : null,
        hasPrediction: !!prediction && homeWin !== null && draw !== null && awayWin !== null,
        compactMarkets,
        topScorelines: storedScorelines.length === 3 ? storedScorelines : topScorelines(expectedHomeGoals, expectedAwayGoals),
        expectedHomeGoals,
        expectedAwayGoals,
        odds: oddsByFixture.get(fixtureId) ?? null,
        handicapQuote: pickHandicapQuote(oddsSnapshots, fixtureId),
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
