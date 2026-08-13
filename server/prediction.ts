import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Request } from "express";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const runtimeDirectory = path.join(os.tmpdir(), "football-prediction-runtime-expanded-v1");
const databasePath = path.join(runtimeDirectory, "football_data_expanded.db");
const modelPath = path.join(runtimeDirectory, "soccer_predict_model_expanded.pkl");

const runtimeAssets = {
  database: "/manus-storage/football_data_expanded_b11d821f.db",
  model: "/manus-storage/soccer_predict_model_expanded_0dc66f04.pkl",
};

export const SUPPORTED_LEAGUE_CODES = new Set([
  "BRA1", "EPL", "LL", "BL", "SA", "L1", "MLS", "J1", "FIN1", "KOR1", "POR1", "MEX1", "AUS1",
]);

export class PredictionScopeError extends Error {
  readonly code = "OUT_OF_SCOPE";

  constructor(message: string) {
    super(message);
    this.name = "PredictionScopeError";
  }
}

let runtimeReady: Promise<void> | null = null;

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
  if (runtimeReady) return runtimeReady;
  runtimeReady = (async () => {
    await fs.mkdir(runtimeDirectory, { recursive: true });
    const databaseExists = await fs.stat(databasePath).then(() => true).catch(() => false);
    const modelExists = await fs.stat(modelPath).then(() => true).catch(() => false);
    const origin = getOrigin(request);
    if (!databaseExists) await downloadFile(`${origin}${runtimeAssets.database}`, databasePath);
    if (!modelExists) await downloadFile(`${origin}${runtimeAssets.model}`, modelPath);
  })();
  try {
    await runtimeReady;
  } catch (error) {
    runtimeReady = null;
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
    throw new PredictionScopeError("超出模型範疇：目前只支援13個已驗證聯賽內的對戰；盃賽與未涵蓋聯賽不會輸出未校準機率。");
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
