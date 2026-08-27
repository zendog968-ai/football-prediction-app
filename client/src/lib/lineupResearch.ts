export type OutcomeProbabilities = {
  homeWin: number;
  draw: number;
  awayWin: number;
};

export type LineupResearch = OutcomeProbabilities & {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  totalExpectedGoals: number;
  topScorelines: Array<{ score: string; probability: number }>;
};

const MAX_GOALS = 9;

function poisson(goal: number, expectedGoals: number) {
  let factorial = 1;
  for (let index = 2; index <= goal; index += 1) factorial *= index;
  return Math.exp(-expectedGoals) * expectedGoals ** goal / factorial;
}

export function calculateLineupResearch(
  homeBaseline: number,
  awayBaseline: number,
  homeAdjustment: number,
  awayAdjustment: number,
): LineupResearch {
  const homeExpectedGoals = Math.max(0.15, homeBaseline * (1 + homeAdjustment / 100));
  const awayExpectedGoals = Math.max(0.15, awayBaseline * (1 + awayAdjustment / 100));
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  const scorelines: Array<{ score: string; probability: number }> = [];

  for (let homeGoals = 0; homeGoals <= MAX_GOALS; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= MAX_GOALS; awayGoals += 1) {
      const probability = poisson(homeGoals, homeExpectedGoals) * poisson(awayGoals, awayExpectedGoals);
      if (homeGoals > awayGoals) homeWin += probability;
      else if (homeGoals === awayGoals) draw += probability;
      else awayWin += probability;
      scorelines.push({ score: `${homeGoals}-${awayGoals}`, probability });
    }
  }

  const total = homeWin + draw + awayWin;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
    homeExpectedGoals,
    awayExpectedGoals,
    totalExpectedGoals: homeExpectedGoals + awayExpectedGoals,
    topScorelines: scorelines.sort((left, right) => right.probability - left.probability).slice(0, 3),
  };
}
