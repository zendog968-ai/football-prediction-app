import { getSupabaseUpcomingCache } from "./server/supabaseCache";

function hktDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

async function main() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const payload = await getSupabaseUpcomingCache(true);
  const fixtures = payload.fixtures.filter((fixture) => {
    const league = fixture.leagueName.toLowerCase();
    const isBundesliga = league.includes("bundesliga") || league.includes("germany") || league.includes("german") || league.includes("德甲") || league.includes("德國");
    return isBundesliga && hktDate(fixture.eventTime) === today;
  });
  console.log(JSON.stringify({ todayHkt: today, available: payload.available, reason: payload.reason ?? null, loadedAt: payload.loadedAt, lastSyncAt: payload.lastSyncAt ?? null, count: fixtures.length, fixtures }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
