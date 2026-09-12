import { ENV } from "./server/_core/env";
import { readFile } from "node:fs/promises";

type Fixture = { fixture_id: number; league_name: string; event_time: string; home_team: string; away_team: string; status: string };

async function query(path: string) {
  if (!ENV.supabaseUrl || !ENV.supabaseSecretKey) throw new Error("Supabase server cache is not configured");
  const response = await fetch(new URL(`/rest/v1/${path}`, ENV.supabaseUrl), { headers: { apikey: ENV.supabaseSecretKey, Authorization: `Bearer ${ENV.supabaseSecretKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase query failed ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  const payload = JSON.parse(await readFile("/tmp/bundesliga_direct.json", "utf8")) as { rows: Fixture[] };
  const fixtures = payload.rows.filter(row => row.league_name === "Bundesliga");
  const ids = fixtures.map(row => row.fixture_id);
  const inFilter = ids.join(",");
  const [predictions, odds] = await Promise.all([
    query(`ai_predictions?select=fixture_id,home_win_prob,draw_prob,away_win_prob,predicted_score,recommendation,confidence,updated_at&fixture_id=in.(${inFilter})`),
    query(`odds_snapshots?select=fixture_id,market_type,handicap,home_odds,draw_odds,away_odds,snapshot_time&fixture_id=in.(${inFilter})&order=snapshot_time.desc`),
  ]);
  console.log(JSON.stringify({ dateHkt: "2026-09-05", fixtures, predictions, odds }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
