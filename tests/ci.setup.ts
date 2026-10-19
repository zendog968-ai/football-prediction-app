// CI-only setup, never imported by the production application.
// These are deliberately fake values, not defaults for operational services.
const fakeEnvironment: Record<string, string> = {
  SUPABASE_URL: "https://supabase.invalid",
  SUPABASE_SECRET_KEY: "ci-unit-test-not-a-real-secret",
  API_FOOTBALL_KEY: "ci-unit-test-not-a-real-key",
  TELEGRAM_BOT_TOKEN: "ci-unit-test-not-a-real-token",
  TELEGRAM_WEBHOOK_SECRET: "ci_unit_test_only",
  TELEGRAM_WEBHOOK_URL: "https://webhook.invalid/telegram",
  TELEGRAM_RUNTIME_LABEL: "CI-UNIT-TEST",
  DATABASE_URL: "",
  JWT_SECRET: "ci-unit-test-cookie-signing-not-production",
  BUILT_IN_FORGE_API_URL: "",
  BUILT_IN_FORGE_API_KEY: "",
  SUPABASE_TEAM_TRANSLATIONS_TABLE: "team_translations",
  SUPABASE_LEAGUE_TRANSLATIONS_TABLE: "league_translations",
};
for (const [name, value] of Object.entries(fakeEnvironment)) {
  process.env[name] = value;
}

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)) {
    return originalFetch(input, { ...init, redirect: "error" });
  }
  throw new Error("CI unit tests must explicitly mock fetch; external network is disabled");
};
