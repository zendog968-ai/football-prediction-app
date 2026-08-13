import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Request } from "express";
import { getReleaseAssets } from "./releaseAssets";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const runtimeDirectory = path.join(os.tmpdir(), "football-prediction-runtime-expanded-v2-odds");
const databasePath = path.join(runtimeDirectory, "football_data_expanded_with_closing_odds.db");
const modelPath = path.join(runtimeDirectory, "soccer_predict_model_expanded.pkl");

export const SUPPORTED_LEAGUE_CODES = new Set([
  "BRA1", "EPL", "LL", "BL", "SA", "L1", "MLS", "J1", "FIN1", "KOR1", "POR1", "MEX1", "AUS1", "UEL", "SUD", "LCUP",
]);

export class PredictionScopeError extends Error {
  readonly code = "OUT_OF_SCOPE";

  constructor(message: string) {
    super(message);
    this.name = "PredictionScopeError";
  }
}

let runtimeReady: Promise<void> | null = null;
let runtimeVersion: string | null = null;

export type PredictionResult = {
  prediction_as_of: string;
  league_code: string;
  league_name: string;
  home_team: string;
  away_team: string;
  probabilities: { home_win: number; draw: number; away_win: number };
  diagnostics: {
    historical_matches_used: number;
    latest_historical_match: string;
    dc_history_match_count: number;
    dc_available: boolean;
  };
  selected_features: {
    home_elo_pre: number;
    away_elo_pre: number;
    elo_diff_pre: number;
    home_recent5_win_rate: number;
    away_recent5_win_rate: number;
    dc_expected_home_goals: number | null;
    dc_expected_away_goals: number | null;
  };
};

export type LeagueMetadata = {
  leagues: Array<{ code: string; name: string; first_date: string; last_date: string; match_count: number }>;
  teams: string[];
  coverage: {
    firstDate: string;
    lastDate: string;
    lastUpdatedAt: string | null;
    model: string;
    disclaimer: string;
  };
};

type EuropaMatch = {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
  status: "FINISHED" | "UPCOMING";
  round: string;
};

export type EuropaOverview = {
  source: "UEFA official match API";
  retrievedAt: string;
  season: string;
  recentResults: EuropaMatch[];
  upcomingFixtures: EuropaMatch[];
};

let europaCache: { expiresAt: number; payload: EuropaOverview } | null = null;

export type CupOverview = {
  source: "ESPN public scoreboard";
  retrievedAt: string;
  season: string;
  recentResults: EuropaMatch[];
  upcomingFixtures: EuropaMatch[];
};

const CUP_SCOREBOARD_SLUGS: Record<"SUD" | "LCUP", string> = {
  SUD: "conmebol.sudamericana",
  LCUP: "concacaf.leagues.cup",
};
const cupCache = new Map<string, { expiresAt: number; payload: CupOverview }>();

export async function getCupOverview(leagueCode: "SUD" | "LCUP"): Promise<CupOverview> {
  const cached = cupCache.get(leagueCode);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const now = new Date().toISOString().slice(0, 10);
  const season = now.slice(0, 4);
  const sourceUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${CUP_SCOREBOARD_SLUGS[leagueCode]}/scoreboard?dates=${season}&limit=500`;
  const response = await fetch(sourceUrl, { headers: { "user-agent": "AureliaFootballResearch/1.0" } });
  if (!response.ok) throw new Error(`盃賽公開賽程載入失敗（${response.status}）。`);
  const payload = await response.json() as { events?: Array<Record<string, unknown>> };
  if (!Array.isArray(payload.events)) throw new Error("盃賽公開賽程格式無效。");
  const matches = payload.events.flatMap((event): EuropaMatch[] => {
    const date = typeof event.date === "string" ? event.date : undefined;
    const statusName = String((event.status as { type?: { name?: string } } | undefined)?.type?.name || "");
    const competitors = ((event.competitions as Array<{ competitors?: Array<Record<string, unknown>> }> | undefined)?.[0]?.competitors) || [];
    const home = competitors.find(row => row.homeAway === "home");
    const away = competitors.find(row => row.homeAway === "away");
    if (!date || !home || !away) return [];
    const homeTeam = String((home.team as { displayName?: string } | undefined)?.displayName || "").trim();
    const awayTeam = String((away.team as { displayName?: string } | undefined)?.displayName || "").trim();
    if (!homeTeam || !awayTeam) return [];
    const finished = statusName === "STATUS_FULL_TIME";
    const homeGoals = finished ? Number(home.score) : null;
    const awayGoals = finished ? Number(away.score) : null;
    if (finished && (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals))) return [];
    return [{ date, homeTeam, awayTeam, homeGoals, awayGoals, status: finished ? "FINISHED" : "UPCOMING", round: leagueCode === "SUD" ? "CONMEBOL Sudamericana" : "Leagues Cup" }];
  });
  const overview: CupOverview = {
    source: "ESPN public scoreboard",
    retrievedAt: new Date().toISOString(),
    season,
    recentResults: matches.filter(match => match.status === "FINISHED" && match.date.slice(0, 10) <= now).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    upcomingFixtures: matches.filter(match => match.status === "UPCOMING" && match.date.slice(0, 10) >= now).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8),
  };
  cupCache.set(leagueCode, { expiresAt: Date.now() + 5 * 60_000, payload: overview });
  return overview;
}

function europaTeamName(team: Record<string, unknown>) {
  const direct = team.internationalName;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const translations = team.translations as { displayName?: Record<string, string> } | undefined;
  return translations?.displayName?.EN?.trim() || "Unknown team";
}

export async function getEuropaOverview(): Promise<EuropaOverview> {
  if (europaCache && europaCache.expiresAt > Date.now()) return europaCache.payload;
  const now = new Date().toISOString().slice(0, 10);
  const startYear = Number(now.slice(0, 4)) - (Number(now.slice(5, 7)) < 7 ? 1 : 0);
  const seasonEndYear = startYear + 1;
  const sourceUrl = `https://match.uefa.com/v5/matches?competitionId=14&seasonYear=${seasonEndYear}&limit=500&offset=0&order=ASC`;
  const response = await fetch(sourceUrl, { headers: { "user-agent": "AureliaFootballResearch/1.0" } });
  if (!response.ok) throw new Error(`UEFA官方歐霸盃賽程載入失敗（${response.status}）。`);
  const rows = await response.json() as Array<Record<string, unknown>>;
  if (!Array.isArray(rows)) throw new Error("UEFA官方歐霸盃賽程格式無效。");
  const matches = rows.flatMap((row): EuropaMatch[] => {
    const kickoff = row.kickOffTime as { date?: string } | undefined;
    const home = (row.homeTeam || {}) as Record<string, unknown>;
    const away = (row.awayTeam || {}) as Record<string, unknown>;
    const status = row.status;
    if (!kickoff?.date || home.isPlaceHolder || away.isPlaceHolder || (status !== "FINISHED" && status !== "UPCOMING")) return [];
    const regular = (row.score as { regular?: { home?: number; away?: number } } | undefined)?.regular;
    const round = ((row.round as { metaData?: { name?: string } } | undefined)?.metaData?.name) || "Europa League";
    if (status === "FINISHED" && (!Number.isInteger(regular?.home) || !Number.isInteger(regular?.away))) return [];
    return [{
      date: kickoff.date,
      homeTeam: europaTeamName(home),
      awayTeam: europaTeamName(away),
      homeGoals: status === "FINISHED" ? regular!.home! : null,
      awayGoals: status === "FINISHED" ? regular!.away! : null,
      status,
      round,
    }];
  });
  const payload: EuropaOverview = {
    source: "UEFA official match API",
    retrievedAt: new Date().toISOString(),
    season: `${startYear}-${seasonEndYear}`,
    recentResults: matches.filter(match => match.status === "FINISHED" && match.date <= now).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    upcomingFixtures: matches.filter(match => match.status === "UPCOMING" && match.date >= now).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8),
  };
  europaCache = { expiresAt: Date.now() + 5 * 60_000, payload };
  return payload;
}

function getOrigin(request: Request) {
  const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0];
  const protocol = forwardedProtocol || request.protocol || "http";
  const host = request.get("host");
  if (!host) throw new Error("無法建立模型資產下載網址。");
  return `${protocol}://${host}`;
}

async function downloadFile(sourceUrl: string, destination: string) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`模型資產下載失敗（${response.status}）。`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("模型資產下載結果為空。");
  await fs.writeFile(destination, bytes);
}

async function ensureRuntimeAssets(request: Request) {
  const assets = await getReleaseAssets(getOrigin(request));
  if (runtimeReady && runtimeVersion === assets.version) return runtimeReady;
  runtimeVersion = assets.version;
  runtimeReady = (async () => {
    await fs.mkdir(runtimeDirectory, { recursive: true });
    await downloadFile(assets.database, databasePath);
    await downloadFile(assets.model, modelPath);
  })();
  try {
    await runtimeReady;
  } catch (error) {
    runtimeReady = null;
    runtimeVersion = null;
    throw error;
  }
}

async function runPython(scriptName: string, args: string[]) {
  const { stdout } = await execFileAsync("python3", [path.join(projectRoot, "scripts", scriptName), ...args], {
    cwd: projectRoot,
    timeout: 90000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}

export async function getLeagueMetadata(request: Request): Promise<LeagueMetadata> {
  await ensureRuntimeAssets(request);
  const stdout = await runPython("list_teams.py", ["--database", databasePath]);
  return JSON.parse(stdout) as LeagueMetadata;
}

export async function getTeams(request: Request, leagueCode: string): Promise<string[]> {
  const normalizedLeague = leagueCode.trim().toUpperCase();
  if (!SUPPORTED_LEAGUE_CODES.has(normalizedLeague)) {
    throw new PredictionScopeError("超出模型範疇：目前只支援16個已驗證資料範圍內的對戰；未涵蓋盃賽與聯賽不會輸出未校準機率。");
  }
  await ensureRuntimeAssets(request);
  const stdout = await runPython("list_teams.py", ["--database", databasePath, "--league", normalizedLeague]);
  return (JSON.parse(stdout) as LeagueMetadata).teams;
}

export function validateInferenceScope(
  input: { leagueCode: string; homeTeam: string; awayTeam: string },
  leagueTeams: string[],
) {
  const normalizedLeague = input.leagueCode.trim().toUpperCase();
  if (!SUPPORTED_LEAGUE_CODES.has(normalizedLeague)) {
    throw new PredictionScopeError("超出模型範疇：此聯賽未納入目前校準模型，系統不會產生未經校準的機率。 ");
  }

  const exactTeams = new Set(leagueTeams.map(team => team.trim().toLocaleLowerCase()));
  const unavailable = [input.homeTeam, input.awayTeam]
    .filter(team => !exactTeams.has(team.trim().toLocaleLowerCase()));
  if (unavailable.length > 0) {
    throw new PredictionScopeError(
      `超出模型範疇：${unavailable.join("、")} 不屬於 ${normalizedLeague} 的已驗證聯賽資料。跨聯賽或盃賽對戰（例如自由盃、歐洲賽、聯盟盃）不會輸出未經校準的機率。`,
    );
  }
}

export async function getPrediction(
  request: Request,
  input: { leagueCode: string; homeTeam: string; awayTeam: string }
): Promise<PredictionResult> {
  await ensureRuntimeAssets(request);
  const normalizedLeague = input.leagueCode.trim().toUpperCase();
  const leagueTeams = await getTeams(request, normalizedLeague);
  validateInferenceScope({ ...input, leagueCode: normalizedLeague }, leagueTeams);
  const outputPath = path.join(runtimeDirectory, `prediction-${randomUUID()}.json`);
  try {
    await runPython("predict_upcoming.py", [
      "--home", input.homeTeam,
      "--away", input.awayTeam,
      "--league", normalizedLeague,
      "--database", databasePath,
      "--model", modelPath,
      "--json-out", outputPath,
    ]);
    return JSON.parse(await fs.readFile(outputPath, "utf8")) as PredictionResult;
  } finally {
    await fs.unlink(outputPath).catch(() => undefined);
  }
}

export function hasValidProbabilityDistribution(result: PredictionResult) {
  const values = Object.values(result.probabilities);
  return values.every(value => Number.isFinite(value) && value >= 0 && value <= 1) &&
    Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < 1e-8;
}
