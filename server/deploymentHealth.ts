import { readFileSync } from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { RESEARCH_MODEL_VERSION } from "./qualityPoisson";
import { RESEARCH_POLICY } from "./researchPolicy";

const RELEASE_METADATA_FILE = ".aurelia-release.json";
const SHA_PATTERN = /^[a-fA-F0-9]{40}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PROJECT_ROOT = process.cwd();

export type DeploymentHealthResponse = {
  ok: true;
  service: "aurelia-football";
  releaseSha: string | null;
  policy: {
    modelVersion: typeof RESEARCH_MODEL_VERSION;
    mode: typeof RESEARCH_POLICY.mode;
    minTeamMatches: typeof RESEARCH_POLICY.minTeamMatches;
    minLeagueMatches: typeof RESEARCH_POLICY.minLeagueMatches;
    highConfidenceEnabled: typeof RESEARCH_POLICY.highConfidenceEnabled;
    bettingAdviceEnabled: typeof RESEARCH_POLICY.bettingAdviceEnabled;
    expectedValueEnabled: typeof RESEARCH_POLICY.expectedValueEnabled;
  };
};

type ReleaseMetadata = {
  sha?: unknown;
  builtAt?: unknown;
};

function isIsoUtc(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_UTC_PATTERN.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    && (date.toISOString() === value || date.toISOString().replace(".000Z", "Z") === value);
}

/**
 * Reads and validates release metadata once at application startup. Invalid or
 * unavailable metadata intentionally produces no version claim.
 */
export function readReleaseSha(projectRoot: string): string | null {
  try {
    const metadata: ReleaseMetadata = JSON.parse(
      readFileSync(path.join(projectRoot, RELEASE_METADATA_FILE), "utf8")
    );

    if (typeof metadata.sha !== "string" || !SHA_PATTERN.test(metadata.sha) || !isIsoUtc(metadata.builtAt)) {
      return null;
    }

    return metadata.sha;
  } catch {
    return null;
  }
}

export const DEPLOYMENT_HEALTH_POLICY: DeploymentHealthResponse["policy"] = Object.freeze({
  modelVersion: RESEARCH_MODEL_VERSION,
  mode: RESEARCH_POLICY.mode,
  minTeamMatches: RESEARCH_POLICY.minTeamMatches,
  minLeagueMatches: RESEARCH_POLICY.minLeagueMatches,
  highConfidenceEnabled: RESEARCH_POLICY.highConfidenceEnabled,
  bettingAdviceEnabled: RESEARCH_POLICY.bettingAdviceEnabled,
  expectedValueEnabled: RESEARCH_POLICY.expectedValueEnabled,
});

export function createDeploymentHealthHandler(releaseSha: string | null) {
  const response: DeploymentHealthResponse = Object.freeze({
    ok: true,
    service: "aurelia-football",
    releaseSha,
    policy: DEPLOYMENT_HEALTH_POLICY,
  });

  return (_req: Request, res: Response): void => {
    res.set("Cache-Control", "no-store").status(200).json(response);
  };
}

/**
 * Registers the liveness and release-proof endpoint. The metadata is read here,
 * once during startup, so changing a release symlink cannot alter an old
 * process's reported version.
 */
export function registerDeploymentHealthRoute(app: Express, projectRoot = PROJECT_ROOT): void {
  const releaseSha = readReleaseSha(projectRoot);
  app.get("/api/deployment/health", createDeploymentHealthHandler(releaseSha));
}
