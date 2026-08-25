const REPOSITORY = "zendog968-ai/football-prediction-app";
const CACHE_TTL_MS = 120_000;
import { ENV } from "./_core/env";

type GitHubRunSource = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  head_branch: string;
  head_sha: string;
  run_number: number;
  event: string;
  display_title: string;
};

export type GithubActionsRun = {
  id: number;
  workflowName: string;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  branch: string;
  commit: string;
  runNumber: number;
  event: string;
  title: string;
  category: "security" | "sync" | "other";
  failureSummary: string | null;
};

export type GithubWorkflowSummary = {
  id: "security" | "sync" | "other";
  label: string;
  description: string;
  requiredForMain: boolean;
  latest: GithubActionsRun | null;
  recentCompleted: number;
  recentSuccesses: number;
  successRate: number | null;
  failureCount: number;
};

export type GithubRunTrendPoint = {
  date: string;
  label: string;
  completedRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number | null;
};

export type GithubActionsOverview = {
  repository: string;
  repositoryUrl: string;
  fetchedAt: string;
  refreshAfterSeconds: number;
  workflows: GithubWorkflowSummary[];
  recentRuns: GithubActionsRun[];
  trend: GithubRunTrendPoint[];
  overallCompleted: number;
  overallSuccesses: number;
  overallFailures: number;
  overallSuccessRate: number | null;
};

let cachedOverview: GithubActionsOverview | null = null;
let cachedAt = 0;

function categoryFor(name: string): GithubActionsRun["category"] {
  if (name === "Admin Configuration Security Regression") return "security";
  if (name === "Football Supabase Sync") return "sync";
  return "other";
}

function failureSummary(status: string, conclusion: string | null): string | null {
  if (status !== "completed") return null;
  if (conclusion === "failure") return "至少一個工作步驟失敗；請開啟執行紀錄查看失敗日誌。";
  if (conclusion === "cancelled") return "工作流程已取消。";
  if (conclusion === "timed_out") return "工作流程逾時。";
  if (conclusion === "skipped") return "工作流程已略過。";
  if (conclusion === "action_required") return "工作流程等待人工處理。";
  return null;
}

export function normalizeGithubRun(run: GitHubRunSource): GithubActionsRun {
  const category = categoryFor(run.name);
  return {
    id: run.id,
    workflowName: run.name,
    status: run.status,
    conclusion: run.conclusion,
    url: run.html_url,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    startedAt: run.run_started_at,
    branch: run.head_branch,
    commit: run.head_sha.slice(0, 7),
    runNumber: run.run_number,
    event: run.event,
    title: run.display_title,
    category,
    failureSummary: failureSummary(run.status, run.conclusion),
  };
}

function hktDateKey(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = new Map(parts.map(part => [part.type, part.value]));
  return `${lookup.get("year")}-${lookup.get("month")}-${lookup.get("day")}`;
}

function shiftDateKey(dateKey: string, offset: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function displayTrendLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export function buildGithubRunTrend(runs: GithubActionsRun[], fetchedAt = new Date().toISOString(), days = 14): GithubRunTrendPoint[] {
  const byDate = new Map<string, GithubRunTrendPoint>();
  const anchorDate = hktDateKey(fetchedAt);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = shiftDateKey(anchorDate, -offset);
    byDate.set(date, { date, label: displayTrendLabel(date), completedRuns: 0, successfulRuns: 0, failedRuns: 0, successRate: null });
  }

  for (const run of runs) {
    if (run.status !== "completed") continue;
    const point = byDate.get(hktDateKey(run.updatedAt));
    if (!point) continue;
    point.completedRuns += 1;
    if (run.conclusion === "success") point.successfulRuns += 1;
    else if (["failure", "timed_out", "cancelled", "action_required"].includes(run.conclusion || "")) point.failedRuns += 1;
  }

  return Array.from(byDate.values()).map(point => ({
    ...point,
    successRate: point.completedRuns ? Math.round((point.successfulRuns / point.completedRuns) * 100) : null,
  }));
}

export function summarizeGithubRuns(runs: GithubActionsRun[], fetchedAt = new Date().toISOString()): GithubActionsOverview {
  const tracked: Array<Pick<GithubWorkflowSummary, "id" | "label" | "description" | "requiredForMain">> = [
    {
      id: "security",
      label: "必要安全回歸",
      description: "所有 Pull Request 必須通過的隔離式表單安全測試。",
      requiredForMain: true,
    },
    {
      id: "sync",
      label: "每小時資料同步",
      description: "API-Football 與 Supabase 的排程同步及重試流程。",
      requiredForMain: false,
    },
  ];

  const workflows = tracked.map(workflow => {
    const matching = runs.filter(run => run.category === workflow.id);
    const completed = matching.filter(run => run.status === "completed");
    const successes = completed.filter(run => run.conclusion === "success");
    return {
      ...workflow,
      latest: matching[0] ?? null,
      recentCompleted: completed.length,
      recentSuccesses: successes.length,
      successRate: completed.length ? Math.round((successes.length / completed.length) * 100) : null,
      failureCount: completed.filter(run => run.conclusion === "failure").length,
    };
  });

  const completedRuns = runs.filter(run => run.status === "completed");
  const overallSuccesses = completedRuns.filter(run => run.conclusion === "success").length;
  const overallFailures = completedRuns.filter(run => ["failure", "timed_out", "cancelled", "action_required"].includes(run.conclusion || "")).length;

  return {
    repository: REPOSITORY,
    repositoryUrl: `https://github.com/${REPOSITORY}`,
    fetchedAt,
    refreshAfterSeconds: Math.round(CACHE_TTL_MS / 1000),
    workflows,
    recentRuns: runs.slice(0, 12),
    trend: buildGithubRunTrend(runs, fetchedAt),
    overallCompleted: completedRuns.length,
    overallSuccesses,
    overallFailures,
    overallSuccessRate: completedRuns.length ? Math.round((overallSuccesses / completedRuns.length) * 100) : null,
  };
}

export async function getGithubActionsOverview(): Promise<GithubActionsOverview> {
  const now = Date.now();
  if (cachedOverview && now - cachedAt < CACHE_TTL_MS) return cachedOverview;

  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/runs?per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Aurelia-Football-Operations-Monitor",
      ...(ENV.githubStatusToken ? { Authorization: `Bearer ${ENV.githubStatusToken}` } : {}),
    },
  });
  if (!response.ok) {
    const guidance = response.status === 403
      ? "GitHub 公開 API 暫時受限，請稍後再試。"
      : `GitHub Actions 資料暫時無法讀取（HTTP ${response.status}）。`;
    throw new Error(guidance);
  }

  const payload = await response.json() as { workflow_runs?: GitHubRunSource[] };
  if (!Array.isArray(payload.workflow_runs)) throw new Error("GitHub Actions 回傳格式無法辨識。");

  const overview = summarizeGithubRuns(payload.workflow_runs.map(normalizeGithubRun));
  cachedOverview = overview;
  cachedAt = now;
  return overview;
}
