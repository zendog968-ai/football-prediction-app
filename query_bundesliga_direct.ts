import { ENV } from "./server/_core/env";

function hktBounds(date: string) {
  const start = new Date(`${date}T00:00:00+08:00`);
  const end = new Date(`${date}T23:59:59.999+08:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function main() {
  const date = process.env.HKT_DATE ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!ENV.supabaseUrl || !ENV.supabaseSecretKey) throw new Error("Supabase server cache is not configured");
  const { start, end } = hktBounds(date);
  const params = new URLSearchParams({
    select: "fixture_id,league_name,event_time,home_team,away_team,status,updated_at",
    league_name: "ilike.*Bundesliga*",
    event_time: `gte.${start}`,
    event_time_2: `lt.${end}`,
    order: "event_time.asc",
    limit: "100",
  });
  params.delete("event_time_2");
  params.set("event_time", `gte.${start}`);
  params.append("event_time", `lt.${end}`);
  const url = new URL(`/rest/v1/fixtures?${params.toString()}`, ENV.supabaseUrl);
  const response = await fetch(url, { headers: { apikey: ENV.supabaseSecretKey, Authorization: `Bearer ${ENV.supabaseSecretKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase query failed ${response.status}: ${text.slice(0, 300)}`);
  console.log(JSON.stringify({ dateHkt: date, start, end, rows: JSON.parse(text) }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
