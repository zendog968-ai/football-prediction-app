import { describe, expect, it } from "vitest";
import { buildGithubRunTrend, getGithubActionsOverview, normalizeGithubRun, summarizeGithubRuns } from "./githubActions";

const source = (overrides: Partial<Parameters<typeof normalizeGithubRun>[0]> = {}) => ({
  id: 42,
  name: "Admin Configuration Security Regression",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/example/run/42",
  created_at: "2026-08-22T00:00:00Z",
  updated_at: "2026-08-22T00:01:00Z",
  run_started_at: "2026-08-22T00:00:10Z",
  head_branch: "main",
  head_sha: "abcdef1234567890",
  run_number: 11,
  event: "pull_request",
  display_title: "CI test",
  ...overrides,
});

describe("GitHub Actions monitoring mapping", () => {
  it("marks the required security regression and calculates completed-run success rate", () => {
    const securitySuccess = normalizeGithubRun(source());
    const securityFailure = normalizeGithubRun(source({ id: 43, conclusion: "failure", html_url: "https://github.com/example/run/43" }));
    const overview = summarizeGithubRuns([securitySuccess, securityFailure], "2026-08-22T01:00:00Z");
    const security = overview.workflows.find(workflow => workflow.id === "security");

    expect(security).toMatchObject({ requiredForMain: true, recentCompleted: 2, recentSuccesses: 1, successRate: 50, failureCount: 1 });
    expect(securityFailure.failureSummary).toContain("失敗");
  });

  it("keeps in-progress runs out of success-rate denominators and labels hourly sync", () => {
    const syncRunning = normalizeGithubRun(source({ name: "Football Supabase Sync", status: "in_progress", conclusion: null }));
    const overview = summarizeGithubRuns([syncRunning]);
    const sync = overview.workflows.find(workflow => workflow.id === "sync");

    expect(sync).toMatchObject({ requiredForMain: false, recentCompleted: 0, successRate: null });
    expect(syncRunning.category).toBe("sync");
  });

  it("builds a chronological HKT trend with real completed success and failure counts", () => {
    const success = normalizeGithubRun(source({ updated_at: "2026-08-21T16:10:00Z" }));
    const failure = normalizeGithubRun(source({ id: 44, conclusion: "failure", updated_at: "2026-08-22T16:20:00Z" }));
    const trend = buildGithubRunTrend([success, failure], "2026-08-23T16:00:00Z", 3);

    expect(trend).toHaveLength(3);
    expect(trend.map(point => point.date)).toEqual(["2026-08-22", "2026-08-23", "2026-08-24"]);
    expect(trend[0]).toMatchObject({ successfulRuns: 1, failedRuns: 0, successRate: 100 });
    expect(trend[1]).toMatchObject({ successfulRuns: 0, failedRuns: 1, successRate: 0 });
    expect(trend[2]).toMatchObject({ completedRuns: 0, successRate: null });
  });

  const testWithToken = process.env.GITHUB_STATUS_TOKEN ? it : it.skip;
  testWithToken("uses the configured server token for a lightweight GitHub Actions read", async () => {
    const overview = await getGithubActionsOverview();
    expect(overview.repository).toBe("zendog968-ai/football-prediction-app");
    expect(overview.recentRuns.length).toBeGreaterThan(0);
  }, 15_000);
});
