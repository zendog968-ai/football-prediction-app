import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { allLeagueSyncJobs } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { deliverAllLeagueCoverageSummary } from "./telegramResearch";

type ApiFixture = {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  league?: { id?: number; name?: string; country?: string };
  teams?: { home?: { name?: string }; away?: { name?: string } };
  goals?: { home?: number | null; away?: number | null };
};

type FixtureRow = {
  fixture_id: number;
  league_name: string;
  event_time: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  updated_at: string;
};

export type AllLeagueCoverage = { fixtures: number; leagues: number; countries: number; generatedAt: string };
const API_BASE = "https://v3.football.api-sports.io";

function requireSetting(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is not configured`);
  return value;
}

function uniqueFixtures(fixtures: ApiFixture[]): ApiFixture[] {
  const seen = new Set<number>();
  return fixtures.filter(item => {
    const id = item.fixture?.id;
    if (!Number.isInteger(id) || seen.has(id!)) return false;
    seen.add(id!);
    return true;
  });
}

function asFixtureRow(item: ApiFixture, now: string): FixtureRow | null {
  const id = item.fixture?.id;
  const eventTime = item.fixture?.date;
  const home = item.teams?.home?.name;
  const away = item.teams?.away?.name;
  if (!Number.isInteger(id) || !eventTime || !home || !away) return null;
  return {
    fixture_id: id!,
    league_name: item.league?.name || "Unknown League",
    event_time: eventTime,
    home_team: home,
    away_team: away,
    home_score: typeof item.goals?.home === "number" ? item.goals.home : null,
    away_score: typeof item.goals?.away === "number" ? item.goals.away : null,
    status: item.fixture?.status?.short || "TBD",
    updated_at: now,
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export function summarizeAllLeagueFixtures(fixtures: ApiFixture[], generatedAt = new Date().toISOString()): AllLeagueCoverage {
  return {
    fixtures: fixtures.length,
    leagues: new Set(fixtures.map(item => item.league?.id).filter(Number.isInteger)).size,
    countries: new Set(fixtures.map(item => item.league?.country).filter(Boolean)).size,
    generatedAt,
  };
}

async function apiFixtures(path: string): Promise<ApiFixture[]> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { "x-apisports-key": requireSetting(ENV.apiFootballKey, "API Football Key") } });
  if (!response.ok) throw new Error(`API-Football fixtures request failed (${response.status})`);
  const payload = await response.json() as { response?: unknown; errors?: unknown };
  if (!Array.isArray(payload.response)) throw new Error(`API-Football fixtures payload invalid: ${JSON.stringify(payload.errors ?? {})}`);
  return payload.response as ApiFixture[];
}

async function upsertFixtureRows(rows: FixtureRow[]): Promise<void> {
  const url = requireSetting(ENV.supabaseUrl, "Supabase URL");
  const key = requireSetting(ENV.supabaseSecretKey, "Supabase Secret Key");
  for (const batch of chunks(rows, 250)) {
    const response = await fetch(`${url}/rest/v1/fixtures?on_conflict=fixture_id`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw new Error(`Supabase fixture upsert failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

export async function runAllLeagueFixtureSync(now = new Date()): Promise<AllLeagueCoverage> {
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const [todayFixtures, tomorrowFixtures, liveFixtures] = await Promise.all([
    apiFixtures(`/fixtures?date=${today}&timezone=UTC`),
    apiFixtures(`/fixtures?date=${tomorrow}&timezone=UTC`),
    apiFixtures("/fixtures?live=all"),
  ]);
  const fixtures = uniqueFixtures([...todayFixtures, ...tomorrowFixtures, ...liveFixtures]);
  const generatedAt = now.toISOString();
  const rows = fixtures.map(item => asFixtureRow(item, generatedAt)).filter((item): item is FixtureRow => item !== null);
  await upsertFixtureRows(rows);
  return summarizeAllLeagueFixtures(fixtures, generatedAt);
}

export async function handleScheduledAllLeagueSync(req: Request, res: Response): Promise<void> {
  let taskUid: string | undefined;
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      res.status(403).json({ error: "cron-only" });
      return;
    }
    taskUid = user.taskUid;
    const db = await getDb();
    if (!db) throw new Error("排程資料庫暫時無法使用");
    const job = (await db.select().from(allLeagueSyncJobs).where(eq(allLeagueSyncJobs.scheduleCronTaskUid, taskUid)).limit(1))[0];
    if (!job) {
      res.json({ ok: true, skipped: "orphan" });
      return;
    }
    await db.update(allLeagueSyncJobs).set({ lastStartedAt: new Date(), lastError: null }).where(eq(allLeagueSyncJobs.id, job.id));
    const outcome = await runAllLeagueFixtureSync();
    const delivery = await deliverAllLeagueCoverageSummary(outcome);
    await db.update(allLeagueSyncJobs).set({
      lastCompletedAt: new Date(), lastFixtureCount: outcome.fixtures, lastLeagueCount: outcome.leagues, lastCountryCount: outcome.countries, lastError: null,
    }).where(eq(allLeagueSyncJobs.id, job.id));
    res.json({ ok: true, ...outcome, telegram: delivery });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const db = await getDb().catch(() => null);
    if (db && taskUid) await db.update(allLeagueSyncJobs).set({ lastError: detail.slice(0, 4000) }).where(eq(allLeagueSyncJobs.scheduleCronTaskUid, taskUid)).catch(() => undefined);
    res.status(500).json({ error: detail, timestamp: new Date().toISOString(), context: { taskUid } });
  }
}
