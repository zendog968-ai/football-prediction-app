import { ENV } from "./server/_core/env";

async function main() {
  if (!ENV.apiFootballKey) throw new Error("API-Football Key未設定");
  const dates = ["2026-09-08", "2026-09-07", "2026-09-06"];
  for (const date of dates) {
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}&timezone=Asia%2FHong_Kong`, {
      headers: { "x-apisports-key": ENV.apiFootballKey },
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json() as { response?: any[]; errors?: unknown };
    const rows = (payload.response ?? []).filter((item: any) => {
      const names = [item.teams?.home?.name, item.teams?.away?.name].map((name) => String(name ?? "").toLowerCase());
      return names.some((name) => name.includes("vitoria") || name.includes("vitória") || name.includes("gremio") || name.includes("grêmio"));
    });
    if (rows.length) console.log(JSON.stringify(rows, null, 2));
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
