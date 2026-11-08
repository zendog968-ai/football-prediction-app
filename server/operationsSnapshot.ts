import { promises as fs } from "node:fs";

export type OperationsSnapshot = {
  schema_version: 1;
  generated_at: string;
  fixtures: Record<string, unknown>[];
  predictions: Record<string, unknown>[];
  odds: Record<string, unknown>[];
  counts: Record<string, number>;
  warnings: string[];
  odds_status?: Record<string, string>;
};
export async function readOperationsSnapshot(now = Date.now()): Promise<OperationsSnapshot | null> {
  const file = process.env.FOOTBALL_OPERATIONS_STATE_PATH || "/var/lib/aurelia-operations/latest.json";
  try {
    const stat = await fs.stat(file);
    if (stat.size > 8_000_000) return null;
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const generated = Date.parse(data.generated_at);
    if (data.schema_version !== 1 || !Number.isFinite(generated) || generated > now || now - generated > 120 * 60_000
      || !Array.isArray(data.fixtures) || !Array.isArray(data.predictions) || !Array.isArray(data.odds)) return null;
    return data as OperationsSnapshot;
  } catch { return null; }
}
