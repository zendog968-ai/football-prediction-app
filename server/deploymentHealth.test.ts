import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerDeploymentHealthRoute } from "./deploymentHealth";

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const BUILT_AT = "2026-10-19T08:00:00.000Z";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "deployment-health-"));
}

async function writeMetadata(projectRoot: string, metadata: unknown): Promise<void> {
  await writeFile(path.join(projectRoot, ".aurelia-release.json"), JSON.stringify(metadata));
}

async function requestHealth(app: express.Express): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: unknown }> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/deployment/health`);
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.json(),
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe("deployment health endpoint", () => {
  const projectRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(projectRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it("returns no release claim when metadata is missing, ignoring GIT_SHA", async () => {
    const projectRoot = await createProjectRoot();
    projectRoots.push(projectRoot);
    const priorGitSha = process.env.GIT_SHA;
    process.env.GIT_SHA = NEW_SHA;

    try {
      const app = express();
      registerDeploymentHealthRoute(app, projectRoot);
      const response = await requestHealth(app);

      expect(response.body).toMatchObject({ releaseSha: null });
    } finally {
      if (priorGitSha === undefined) delete process.env.GIT_SHA;
      else process.env.GIT_SHA = priorGitSha;
    }
  });

  it.each([
    ["invalid JSON", "{"],
    ["short SHA", JSON.stringify({ sha: "a".repeat(39), builtAt: BUILT_AT })],
    ["non-hex SHA", JSON.stringify({ sha: "g".repeat(40), builtAt: BUILT_AT })],
    ["non-UTC build time", JSON.stringify({ sha: OLD_SHA, builtAt: "2026-10-19T08:00:00+08:00" })],
  ])("returns no release claim for %s", async (_caseName, releaseFile) => {
    const projectRoot = await createProjectRoot();
    projectRoots.push(projectRoot);
    await writeFile(path.join(projectRoot, ".aurelia-release.json"), releaseFile);

    const app = express();
    registerDeploymentHealthRoute(app, projectRoot);

    expect((await requestHealth(app)).body).toMatchObject({ releaseSha: null });
  });

  it("returns the exact JSON contract and no-store header for valid metadata", async () => {
    const projectRoot = await createProjectRoot();
    projectRoots.push(projectRoot);
    await writeMetadata(projectRoot, { sha: OLD_SHA, builtAt: BUILT_AT });

    const app = express();
    registerDeploymentHealthRoute(app, projectRoot);
    const response = await requestHealth(app);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      ok: true,
      service: "aurelia-football",
      releaseSha: OLD_SHA,
      policy: {
        modelVersion: "poisson-v4-shrink10-research",
        mode: "research-only",
        minTeamMatches: 5,
        minLeagueMatches: 20,
        highConfidenceEnabled: false,
        bettingAdviceEnabled: false,
        expectedValueEnabled: false,
      },
    });
  });

  it("pins the release SHA when the route is registered", async () => {
    const projectRoot = await createProjectRoot();
    projectRoots.push(projectRoot);
    await writeMetadata(projectRoot, { sha: OLD_SHA, builtAt: BUILT_AT });

    const app = express();
    registerDeploymentHealthRoute(app, projectRoot);
    await writeMetadata(projectRoot, { sha: NEW_SHA, builtAt: BUILT_AT });

    expect((await requestHealth(app)).body).toMatchObject({ releaseSha: OLD_SHA });
  });
});
