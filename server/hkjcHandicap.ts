import type { CachedHandicapQuote } from "./supabaseCache";

const HKJC_HDC_URL = "https://bet.hkjc.com/en/football/hdc";
const CACHE_MS = 90_000;

type HkjcHandicapQuote = CachedHandicapQuote & {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
};

let cached: { expiresAt: number; quotes: HkjcHandicapQuote[] } | null = null;

function normalizeTeam(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[.\-']/g, " ").replace(/\s+/g, " ");
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:td|th)>/gi, " | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\| */g, " | ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

function parseLine(value: string): number | null {
  const normalized = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  const candidate = normalized.includes("/") ? normalized.split("/")[0] : normalized;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayLine(line: number): string {
  return `${line > 0 ? "+" : ""}${Number.isInteger(line) ? String(line) : String(line)}`;
}

export function parseHkjcHandicapText(value: string, capturedAt = new Date()): HkjcHandicapQuote[] {
  // HKJC's public HDC table is rendered as Event ID, home team, away team,
  // home line, home odds, away line, away odds. Team names may contain spaces,
  // so this parser accepts only explicit table-cell boundaries (|), never a
  // heuristic split of flattened page text.
  const text = value.replace(/[ \t]+/g, " ").replace(/ *\| */g, " | ").trim();
  const row = /(?:^|\n)\s*(FB\d+)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*(\[[+\-]?\d+(?:\.\d+)?(?:\/[+\-]?\d+(?:\.\d+)?)?\])\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\[[+\-]?\d+(?:\.\d+)?(?:\/[+\-]?\d+(?:\.\d+)?)?\])\s*\|\s*(\d+(?:\.\d+)?)(?=\s*(?:\n|$))/gim;
  const quotes: HkjcHandicapQuote[] = [];
  for (const match of Array.from(text.matchAll(row))) {
    const eventId = match[1]?.trim();
    const homeTeam = match[2]?.trim();
    const awayTeam = match[3]?.trim();
    const homeLine = parseLine(match[4] ?? "");
    const homeOdds = Number(match[5]);
    const awayLine = parseLine(match[6] ?? "");
    const awayOdds = Number(match[7]);
    if (!eventId || !homeTeam || !awayTeam || homeLine === null || awayLine === null
      || !Number.isFinite(homeOdds) || homeOdds <= 1 || !Number.isFinite(awayOdds) || awayOdds <= 1
      || Math.abs(homeLine + awayLine) > 0.000001) continue;
    quotes.push({
      eventId,
      homeTeam,
      awayTeam,
      source: "HKJC",
      homeLine: displayLine(homeLine),
      homeOdds,
      awayLine: displayLine(awayLine),
      awayOdds,
      capturedAt: capturedAt.toISOString(),
    });
  }
  return quotes;
}

async function loadHkjcHandicapQuotes(): Promise<HkjcHandicapQuote[]> {
  if (cached && cached.expiresAt > Date.now()) return cached.quotes;
  const response = await fetch(HKJC_HDC_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "AureliaFootballResearch/1.0 (+verified-public-odds-cache)",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`HKJC HDC read failed (${response.status})`);
  const quotes = parseHkjcHandicapText(htmlToText(await response.text()));
  cached = { expiresAt: Date.now() + CACHE_MS, quotes };
  return quotes;
}

export async function getHkjcHandicapQuote(homeTeam: string, awayTeam: string): Promise<CachedHandicapQuote | null> {
  const home = normalizeTeam(homeTeam);
  const away = normalizeTeam(awayTeam);
  const quotes = await loadHkjcHandicapQuotes();
  const match = quotes.find(quote => normalizeTeam(quote.homeTeam) === home && normalizeTeam(quote.awayTeam) === away);
  return match ? {
    source: match.source,
    homeLine: match.homeLine,
    homeOdds: match.homeOdds,
    awayLine: match.awayLine,
    awayOdds: match.awayOdds,
    capturedAt: match.capturedAt,
  } : null;
}

export function __resetHkjcHandicapCacheForTests(): void {
  cached = null;
}
