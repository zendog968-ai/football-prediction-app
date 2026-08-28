import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { Resvg } from "@resvg/resvg-js";
import { formatLeagueDisplay } from "../shared/leagueDisplay";
import { formatFixtureDisplay, localizeTeamName } from "../shared/teamDisplay";
import { getSupabaseUpcomingCache, type CachedUpcomingFixture } from "./supabaseCache";

const DEFAULT_TITLE = "Aurelia Football Probability Studio";
const DEFAULT_DESCRIPTION = "以已同步資料呈現的足球賽事機率與戰術研究平台。";

export type FixtureSharePreview = {
  fixtureId: number;
  title: string;
  description: string;
  league: string;
  fixture: string;
  kickoffHkt: string;
  predictionLine: string;
  researchLine: string;
  imageUrl: string;
  canonicalUrl: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function escapeSvg(value: string): string {
  return escapeHtml(value).replace(/\n/g, " ");
}

function validFixtureId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const fixtureId = Number(raw);
  return Number.isSafeInteger(fixtureId) && fixtureId > 0 ? fixtureId : null;
}

function originForRequest(req: Request): string | null {
  const host = req.get("x-forwarded-host") ?? req.get("host");
  if (!host || /[\r\n]/.test(host)) return null;
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? forwardedProtocol : req.protocol;
  return `${protocol}://${host}`;
}

function displayTeam(name: string, translation?: CachedUpcomingFixture["homeTeamTranslation"]): string {
  const translated = translation?.nameZhHk ?? translation?.nameZhTw ?? localizeTeamName(name);
  return translated && translated !== name ? `${translated} (${name})` : name;
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatHkt(value: string): string {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)).replace(/\//g, "-");
}

function trimSvgText(value: string, maximum = 40): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

export function buildFixtureSharePreview(fixture: CachedUpcomingFixture, origin: string): FixtureSharePreview {
  const home = displayTeam(fixture.homeTeam, fixture.homeTeamTranslation);
  const away = displayTeam(fixture.awayTeam, fixture.awayTeamTranslation);
  const leagueTranslated = fixture.leagueTranslation?.nameZhHk ?? fixture.leagueTranslation?.nameZhTw;
  const league = leagueTranslated && leagueTranslated !== fixture.leagueName ? `${leagueTranslated} (${fixture.leagueName})` : formatLeagueDisplay(fixture.leagueName);
  const fixtureName = `${home} vs ${away}`;
  const canonicalUrl = new URL(`/?fixture=${fixture.fixtureId}`, origin).toString();
  const imageUrl = new URL(`/api/share/fixture/${fixture.fixtureId}/card.png`, origin).toString();
  const predictionLine = fixture.hasPrediction
    ? `主勝 ${percentage(fixture.homeWin)}｜和局 ${percentage(fixture.draw)}｜客勝 ${percentage(fixture.awayWin)}${fixture.predictedScore ? `｜預測比分 ${fixture.predictedScore}` : ""}`
    : "完整1X2研究機率仍在同步中";
  const expectedGoals = fixture.expectedHomeGoals !== null && fixture.expectedAwayGoals !== null
    ? `預期入球 ${fixture.expectedHomeGoals.toFixed(2)} — ${fixture.expectedAwayGoals.toFixed(2)}`
    : "未有可驗證預期入球基準";
  const researchLine = fixture.researchSource ? `${fixture.researchSource}｜${expectedGoals}` : expectedGoals;

  return {
    fixtureId: fixture.fixtureId,
    title: `${fixtureName}｜${league}｜Aurelia Football`,
    description: `${formatHkt(fixture.eventTime)} HKT｜${predictionLine}。${researchLine}。僅供賽事研究參考。`,
    league,
    fixture: fixtureName,
    kickoffHkt: `${formatHkt(fixture.eventTime)} HKT`,
    predictionLine,
    researchLine,
    imageUrl,
    canonicalUrl,
  };
}

export function injectFixtureShareMeta(template: string, preview: FixtureSharePreview): string {
  const title = escapeHtml(preview.title);
  const description = escapeHtml(preview.description);
  const canonicalUrl = escapeHtml(preview.canonicalUrl);
  const imageUrl = escapeHtml(preview.imageUrl);
  const metadata = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="zh_HK" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta property="og:image" content="${imageUrl}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${imageUrl}" />`,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  ].join("\n    ");
  return template
    .replace(`<title>${DEFAULT_TITLE}</title>`, `<title>${title}</title>`)
    .replace(`<meta name="description" content="${DEFAULT_DESCRIPTION}" />`, `<meta name="description" content="${description}" />`)
    .replace("<!-- AURELIA_SHARE_META -->", metadata);
}

export function renderFixtureShareCard(preview: FixtureSharePreview): string {
  const [predictionPrimary, predictionSecondary = ""] = preview.predictionLine.split("｜預測比分 ");
  const [homeTeam = preview.fixture, awayTeam = ""] = preview.fixture.split(" vs ");
  const socialTeamName = (name: string) => trimSvgText(name.split(" (")[0]!.trim(), 30);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0a1715"/><stop offset="1" stop-color="#102722"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#34d399"/><stop offset="1" stop-color="#fbbf24"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1110" cy="-40" r="260" fill="#34d399" fill-opacity=".08"/><circle cx="50" cy="660" r="270" fill="#fbbf24" fill-opacity=".06"/>
  <rect x="60" y="55" width="8" height="58" rx="4" fill="url(#accent)"/>
  <text x="90" y="78" fill="#6ee7b7" font-family="sans-serif" font-size="20" font-weight="700" letter-spacing="4">AURELIA FOOTBALL · MATCH RESEARCH</text>
  <text x="90" y="107" fill="#a1a1aa" font-family="sans-serif" font-size="18">${escapeSvg(trimSvgText(preview.league, 56))} · ${escapeSvg(preview.kickoffHkt)}</text>
  <text x="60" y="190" fill="#f4f4f5" font-family="sans-serif" font-size="36" font-weight="700">主隊　${escapeSvg(socialTeamName(homeTeam))}</text>
  <text x="60" y="235" fill="#f4f4f5" font-family="sans-serif" font-size="36" font-weight="700">客隊　${escapeSvg(socialTeamName(awayTeam))}</text>
  <line x1="60" y1="265" x2="1140" y2="265" stroke="#ffffff" stroke-opacity=".14"/>
  <text x="60" y="315" fill="#a1a1aa" font-family="sans-serif" font-size="18" font-weight="700" letter-spacing="2">1X2 機率研究</text>
  <text x="60" y="365" fill="#ecfdf5" font-family="sans-serif" font-size="30" font-weight="700">${escapeSvg(trimSvgText(predictionPrimary, 62))}</text>
  ${predictionSecondary ? `<text x="60" y="405" fill="#fcd34d" font-family="sans-serif" font-size="22" font-weight="700">預測比分　${escapeSvg(predictionSecondary)}</text>` : ""}
  <rect x="60" y="440" width="1080" height="1" fill="#ffffff" fill-opacity=".14"/>
  <text x="60" y="485" fill="#d4d4d8" font-family="sans-serif" font-size="18">${escapeSvg(trimSvgText(preview.researchLine, 85))}</text>
  <text x="60" y="548" fill="#71717a" font-family="sans-serif" font-size="16">數據為分享當刻已同步之研究結果；不構成投注、資金或保證性建議。</text>
  <text x="60" y="586" fill="#34d399" font-family="sans-serif" font-size="16" font-weight="700">aurelia football probability studio</text>
</svg>`;
}

async function loadFixturePreview(fixtureId: number, origin: string): Promise<FixtureSharePreview | null> {
  const cache = await getSupabaseUpcomingCache();
  const fixture = cache.fixtures.find(item => item.fixtureId === fixtureId);
  return fixture ? buildFixtureSharePreview(fixture, origin) : null;
}

async function readClientTemplate(): Promise<string> {
  const templatePath = process.env.NODE_ENV === "development"
    ? path.resolve(import.meta.dirname, "..", "client", "index.html")
    : path.resolve(import.meta.dirname, "public", "index.html");
  return fs.promises.readFile(templatePath, "utf-8");
}

export function registerSharePreviewRoutes(app: Express) {
  app.get("/api/share/fixture/:fixtureId/card.png", async (req, res) => {
    const fixtureId = validFixtureId(req.params.fixtureId);
    const origin = originForRequest(req);
    if (fixtureId === null || origin === null) {
      res.status(400).type("text/plain").send("Invalid fixture share request");
      return;
    }
    try {
      const preview = await loadFixturePreview(fixtureId, origin);
      if (!preview) {
        res.status(404).type("text/plain").send("Fixture is not available in the current synced range");
        return;
      }
      const image = new Resvg(renderFixtureShareCard(preview), { fitTo: { mode: "width", value: 1200 } }).render().asPng();
      res.set({
        "Cache-Control": "public, max-age=300",
        "Content-Type": "image/png",
        "Content-Length": String(image.length),
      });
      if (req.query.download === "1") res.attachment(`aurelia-fixture-${fixtureId}.png`);
      res.send(image);
    } catch {
      res.status(503).type("text/plain").send("Fixture share card is temporarily unavailable");
    }
  });

  app.get("/", async (req, res, next) => {
    const fixtureId = validFixtureId(req.query.fixture);
    const origin = originForRequest(req);
    if (fixtureId === null || origin === null) return next();
    try {
      const preview = await loadFixturePreview(fixtureId, origin);
      if (!preview) return next();
      let template = injectFixtureShareMeta(await readClientTemplate(), preview);
      const vite = app.locals.vite as { transformIndexHtml?: (url: string, html: string) => Promise<string> } | undefined;
      if (vite?.transformIndexHtml) template = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set("Content-Type", "text/html").end(template);
    } catch (error) {
      next(error);
    }
  });
}
