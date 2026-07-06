// Props Lab: hypothetical fair-value player props for Spinners games.
// Pure math, shared-nothing: takes the published data files and returns
// probabilities; the app formats them as percentages or American odds.
//
// Method ("face value + advanced stats"):
//   * per-plate-appearance rates from each hitter's season line, regressed
//     toward the league-average hitter with a 60-PA prior (small samples get
//     pulled hard toward average; a 100-PA regular keeps most of his line)
//   * scaled by opponent pitching quality (their runs-allowed rate vs league,
//     clamped to +/-20%) and blended toward Trackman-derived contact quality
//     when an export has been imported (see scripts/trackman-import.js)
//   * a game is 3-5 plate appearances (10% / 55% / 35%), and hit/TB/HR
//     counts fall out of small binomial/DP calculations over that mix
// These are fair-value estimates for fun, not betting advice, and there is
// deliberately no vig.

const PA_MIX = [[3, 0.10], [4, 0.55], [5, 0.35]];
const REGRESSION_PA = 60;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// league-average per-PA rates, computed from the league hitting totals the
// scraper stores alongside players.json
function leagueRates(league) {
  const pa = league.ab + league.bb;
  return {
    hit: league.h / pa,
    hr: league.hr / pa,
    d2: league.d2 / pa,
    t3: league.t3 / pa,
    walk: league.bb / pa,
  };
}

// one hitter's regressed, opponent-adjusted per-PA outcome rates
function hitterRates(p, lg, oppFactor, tm) {
  const pa = p.ab + p.bb + (p.hbp || 0);
  const reg = (x, lgRate) => (x + REGRESSION_PA * lgRate) / (pa + REGRESSION_PA);
  let hit = reg(p.h, lg.hit);
  let hr = reg(p.hr, lg.hr);
  const d2 = reg(p.d2, lg.d2);
  const t3 = reg(p.t3, lg.t3);

  // opponent pitching: better-than-league run prevention deflates everything
  hit *= oppFactor;
  hr *= oppFactor;

  // Trackman contact quality: nudge hit/HR rates by hard-hit percentage
  // relative to a ~35% baseline (half-weight; it's a nudge, not a takeover)
  if (tm && tm.n >= 25) {
    const f = clamp(1 + (tm.hardHitPct - 0.35) * 0.5, 0.85, 1.15);
    hit *= f;
    hr *= f;
  }

  const single = Math.max(0, hit - hr - d2 * oppFactor - t3);
  return { pa, hit: clamp(hit, 0.02, 0.6), hr: clamp(hr, 0.001, 0.2), d2: d2 * oppFactor, t3, single };
}

// P(at least k successes) over the PA mix at per-PA prob p
function pAtLeast(k, p) {
  let total = 0;
  for (const [n, w] of PA_MIX) {
    let miss = 0;
    for (let i = 0; i < k; i++) {
      // binomial pmf term i
      let c = 1;
      for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
      miss += c * p ** i * (1 - p) ** (n - i);
    }
    total += w * (1 - miss);
  }
  return clamp(total, 0, 1);
}

// P(total bases >= 2) via a tiny DP over the per-PA TB distribution
function pTotalBases2(r) {
  const pmf = [1 - r.hit, r.single, r.d2, r.t3, r.hr]; // TB 0..4 per PA
  const norm = pmf.reduce((a, b) => a + b, 0);
  const q = pmf.map((x) => Math.max(0, x / norm));
  const twoPlus = q[2] + q[3] + q[4];
  let total = 0;
  for (const [n, w] of PA_MIX) {
    // dp = [P(0 TB so far), P(exactly 1), P(2 or more)]
    let dp = [1, 0, 0];
    for (let g = 0; g < n; g++) {
      dp = [
        dp[0] * q[0],
        dp[0] * q[1] + dp[1] * q[0],
        dp[2] + dp[0] * twoPlus + dp[1] * (q[1] + twoPlus),
      ];
    }
    total += w * dp[2];
  }
  return clamp(total, 0, 1);
}

// main entry: returns null when player data isn't available yet
export function computeProps({ players, teams, schedule, trackman = {}, focus = "LOW" }) {
  if (!players || !players.hitters || !players.hitters.length || !players.league) return null;
  const game = schedule.find((g) => g.home === focus || g.away === focus);
  if (!game) return null;

  const opp = game.home === focus ? game.away : game.home;
  const oppTeam = teams.find((t) => t.abbr === opp);
  const lgRAg = teams.reduce((s, t) => s + t.RA / t.GP, 0) / teams.length;
  const oppFactor = oppTeam ? clamp((oppTeam.RA / oppTeam.GP) / lgRAg, 0.8, 1.2) : 1;

  const lg = leagueRates(players.league);

  const rows = players.hitters
    .filter((p) => p.ab >= 30)
    .sort((a, b) => b.ab - a.ab)
    .slice(0, 10)
    .map((p) => {
      const tm = trackman[p.name];
      const r = hitterRates(p, lg, oppFactor, tm);
      return {
        name: p.name,
        line: `${(p.h / p.ab).toFixed(3).replace(/^0/, "")}, ${p.hr} HR`,
        ab: p.ab,
        smallSample: r.pa < 60,
        usedTrackman: !!(tm && tm.n >= 25),
        props: {
          hit1: pAtLeast(1, r.hit),
          hit2: pAtLeast(2, r.hit),
          tb2: pTotalBases2(r),
          hr1: pAtLeast(1, r.hr),
        },
      };
    });

  return { game: { date: game.date, opp, homeAway: game.home === focus ? "home" : "away" }, oppFactor, rows };
}
