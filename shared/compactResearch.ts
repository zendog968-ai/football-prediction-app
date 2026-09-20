export type ScorelineProbability = { score: string; probability: number };

export type CompactMarketRow = {
  market: "主客和 (1X2)" | "入球大細 1.5" | "入球大細 2.5" | "入球大細 3.5" | "入球大細 4.5" | "讓球盤 (Handicap)" | "亞洲讓球 0.25" | "亞洲讓球 0.75" | "亞洲讓球 1.25" | "亞洲讓球 1.75";
  selection: string;
  probability: number;
  distribution?: { fullWin: number; halfWin: number; push: number; halfLoss: number; fullLoss: number };
};

const MAX_GOALS = 8;

function poisson(goals: number, mean: number) {
  let factorial = 1;
  for (let value = 2; value <= goals; value += 1) factorial *= value;
  return Math.exp(-mean) * mean ** goals / factorial;
}

function validMean(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.2 && value <= 4.5;
}

function scoreGrid(homeMean: number, awayMean: number) {
  const raw = Array.from({ length: MAX_GOALS + 1 }, (_, homeGoals) => Array.from({ length: MAX_GOALS + 1 }, (_, awayGoals) => ({
    homeGoals,
    awayGoals,
    probability: poisson(homeGoals, homeMean) * poisson(awayGoals, awayMean),
  }))).flat();
  const normalizer = raw.reduce((total, item) => total + item.probability, 0);
  return raw.map(item => ({ ...item, probability: item.probability / normalizer }));
}

export function topScorelines(homeMean: number | null | undefined, awayMean: number | null | undefined): ScorelineProbability[] {
  if (!validMean(homeMean) || !validMean(awayMean)) return [];
  return scoreGrid(homeMean, awayMean)
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 3)
    .map(item => ({ score: `${item.homeGoals}-${item.awayGoals}`, probability: item.probability }));
}

export function outcomeProbabilities(homeMean: number | null | undefined, awayMean: number | null | undefined): { homeWin: number; draw: number; awayWin: number } | null {
  if (!validMean(homeMean) || !validMean(awayMean)) return null;
  return scoreGrid(homeMean, awayMean).reduce((outcomes, item) => {
    if (item.homeGoals > item.awayGoals) outcomes.homeWin += item.probability;
    else if (item.homeGoals === item.awayGoals) outcomes.draw += item.probability;
    else outcomes.awayWin += item.probability;
    return outcomes;
  }, { homeWin: 0, draw: 0, awayWin: 0 });
}

export function totalSelectionProbability(selection: string | null | undefined, homeMean: number | null | undefined, awayMean: number | null | undefined): number | null {
  const match = selection?.match(/^(Over|Under)\s+([1234]\.5)$/i);
  if (!match || !validMean(homeMean) || !validMean(awayMean)) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  const over = scoreGrid(homeMean, awayMean).reduce((total, item) => total + (item.homeGoals + item.awayGoals > line ? item.probability : 0), 0);
  return match[1]?.toLowerCase() === "over" ? over : 1 - over;
}

export function mainstreamTotals(homeMean: number | null | undefined, awayMean: number | null | undefined): CompactMarketRow[] {
  if (!validMean(homeMean) || !validMean(awayMean)) return [];
  return [1.5, 2.5, 3.5, 4.5].flatMap((line): CompactMarketRow[] => {
    const over = totalSelectionProbability(`Over ${line}`, homeMean, awayMean);
    if (over === null) return [];
    const under = 1 - over;
    return [{
      market: `入球大細 ${line}` as CompactMarketRow["market"],
      selection: over >= under ? `大 ${line}` : `小 ${line}`,
      probability: Math.max(over, under),
    }];
  });
}

function handicapSplitLines(selection: string | null | undefined) {
  const match = selection?.match(/^(Home|Away)\s+([+-]?\d+(?:\.25|\.5|\.75)?)$/i);
  if (!match) return null;
  const side = match[1]?.toLowerCase();
  const line = Number(match[2]);
  if (!Number.isFinite(line) || !side) return null;
  const absolute = Math.abs(line);
  const whole = Math.floor(absolute);
  const fraction = Math.round((absolute - whole) * 100) / 100;
  const sign = line < 0 ? -1 : 1;
  const splitLines = fraction === 0.25
    ? [sign * whole, sign * (whole + 0.5)]
    : fraction === 0.75
      ? [sign * (whole + 0.5), sign * (whole + 1)]
      : [line];
  return { side, splitLines };
}

export function handicapWinDistribution(selection: string | null | undefined, homeMean: number | null | undefined, awayMean: number | null | undefined): { fullWin: number; halfWin: number; push: number; halfLoss: number; fullLoss: number } | null {
  const parsed = handicapSplitLines(selection);
  if (!parsed || !validMean(homeMean) || !validMean(awayMean)) return null;
  return scoreGrid(homeMean, awayMean).reduce((distribution, item) => {
    const goalDifference = parsed.side === "home" ? item.homeGoals - item.awayGoals : item.awayGoals - item.homeGoals;
    const outcomes = parsed.splitLines.map(splitLine => goalDifference + splitLine);
    if (outcomes.every(outcome => outcome > 0)) distribution.fullWin += item.probability;
    if (outcomes.some(outcome => outcome > 0) && outcomes.some(outcome => outcome === 0)) distribution.halfWin += item.probability;
    if (outcomes.every(outcome => outcome === 0)) distribution.push += item.probability;
    if (outcomes.some(outcome => outcome < 0) && outcomes.some(outcome => outcome === 0)) distribution.halfLoss += item.probability;
    if (outcomes.every(outcome => outcome < 0)) distribution.fullLoss += item.probability;
    return distribution;
  }, { fullWin: 0, halfWin: 0, push: 0, halfLoss: 0, fullLoss: 0 });
}

export function handicapSelectionProbability(selection: string | null | undefined, homeMean: number | null | undefined, awayMean: number | null | undefined): number | null {
  const distribution = handicapWinDistribution(selection, homeMean, awayMean);
  if (!distribution) return null;
  return distribution.fullWin + distribution.halfWin * 0.5;
}

export function highestOutcome(homeWin: number, draw: number, awayWin: number): CompactMarketRow | null {
  const options = [
    { selection: "主勝", probability: homeWin },
    { selection: "和局", probability: draw },
    { selection: "客勝", probability: awayWin },
  ].filter((item): item is { selection: string; probability: number } => Number.isFinite(item.probability) && item.probability >= 0 && item.probability <= 1);
  if (options.length !== 3) return null;
  const best = options.sort((left, right) => right.probability - left.probability)[0]!;
  return { market: "主客和 (1X2)", ...best };
}
