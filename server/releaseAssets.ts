const GITHUB_RELEASE_ROOT = "https://github.com/zendog968-ai/football-prediction-app/releases/download";
const LATEST_STATUS_URL = `${GITHUB_RELEASE_ROOT}/data-latest/pipeline_status.json`;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

type PipelineManifest = {
  schema_version: number;
  generated_at: string;
  release_tag: string;
  assets: { database: string; model: string; performance: string };
};

export type ReleaseAssets = {
  version: string;
  database: string;
  model: string;
  performance: string;
  generatedAt: string | null;
};

let cachedAssets: ReleaseAssets | null = null;
let cacheExpiresAt = 0;

function isSafeAssetName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function isValidManifest(value: unknown): value is PipelineManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<PipelineManifest>;
  return manifest.schema_version === 1 &&
    typeof manifest.generated_at === "string" &&
    typeof manifest.release_tag === "string" && /^data-[A-Za-z0-9._-]+$/.test(manifest.release_tag) &&
    !!manifest.assets && isSafeAssetName(manifest.assets.database) &&
    isSafeAssetName(manifest.assets.model) && isSafeAssetName(manifest.assets.performance);
}

function fallbackAssets(origin: string): ReleaseAssets {
  return {
    version: "managed-fallback-v2-odds",
    database: `${origin}/manus-storage/football_data_expanded_with_closing_odds_f47c25c4.db`,
    model: `${origin}/manus-storage/soccer_predict_model_expanded_0dc66f04.pkl`,
    performance: `${origin}/manus-storage/model_performance_filters_expanded_8d3a1806.json`,
    generatedAt: null,
  };
}

function isPublishedRelease(assets: ReleaseAssets): boolean {
  return /^data-[A-Za-z0-9._-]+$/.test(assets.version);
}

export function __resetReleaseAssetsCacheForTests(): void {
  cachedAssets = null;
  cacheExpiresAt = 0;
}

export async function getReleaseAssets(origin: string): Promise<ReleaseAssets> {
  if (cachedAssets && Date.now() < cacheExpiresAt) return cachedAssets;
  try {
    const cacheKey = Math.floor(Date.now() / REFRESH_INTERVAL_MS);
    const response = await fetch(`${LATEST_STATUS_URL}?window=${cacheKey}`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`manifest status ${response.status}`);
    const manifest = await response.json() as unknown;
    if (!isValidManifest(manifest)) throw new Error("manifest validation failed");
    const baseUrl = `${GITHUB_RELEASE_ROOT}/${manifest.release_tag}`;
    cachedAssets = {
      version: manifest.release_tag,
      database: `${baseUrl}/${manifest.assets.database}`,
      model: `${baseUrl}/${manifest.assets.model}`,
      performance: `${baseUrl}/${manifest.assets.performance}`,
      generatedAt: manifest.generated_at,
    };
  } catch {
    if (cachedAssets && isPublishedRelease(cachedAssets)) {
      cacheExpiresAt = Date.now() + REFRESH_INTERVAL_MS;
      return cachedAssets;
    }
    cachedAssets = fallbackAssets(origin);
  }
  cacheExpiresAt = Date.now() + REFRESH_INTERVAL_MS;
  return cachedAssets;
}
