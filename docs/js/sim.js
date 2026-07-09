// ---------------------------------------------------------------------------
// FCBL Playoff Predictor: simulation engine (single source of truth).
//
// This exact file runs in two places:
//   * Node (GitHub Actions scraper) via src/sim.js
//   * the browser Web Worker (docs/js/worker.js)
// so the "official" odds and the interactive what-if odds always use
// identical math.
//
// Methodology (locked):
//   talent  = regressed blend of Pythagenpat expectation and actual win%
//   game    = log5(home, away) + home-field advantage, clamped [.02, .98]
//   season  = Monte Carlo over every remaining scheduled game
//   playoff = top 4 by points% -> total points -> head-to-head -> random
//   bracket = best-of-3 semis (1v4, 2v3) + best-of-3 final, higher seed
//             hosts games 1 and 3
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  nSims: 10000,
  hfaGlobal: 0.035,      // global home-field advantage (added to home win prob)
  useTeamHFA: true,      // blend in each team's own home/away split (regressed)
  pythWeight: 0.55,      // weight on Pythagenpat vs actual win% in talent
  regressPrior: 90,      // games of .500 ball blended in. Empirically derived:
                         //   the 2026 standings spread (SD .103) is barely wider
                         //   than pure coin-flip noise over ~32 games (SD .087),
                         //   so only ~28% of the observed gaps are real skill.
                         //   James-Stein shrinkage implies a prior of ~85-90
                         //   games. This league is far more even than its
                         //   standings look.
  rosterWeight: 1.0,     // multiplier on rosterShift, the talent-scale
                         //   adjustment for how a team's CURRENT active roster
                         //   differs from the one that produced its results
                         //   (departures of good players push it negative).
                         //   Deliberately NOT the roster-quality LEVEL, which
                         //   is ~collinear with run differential and would just
                         //   double-count it. 1.0 = apply the measured shift
                         //   as-is; raise it if you think departures matter
                         //   more than the box score yet shows.
  recencyWeight: 0.30,   // weight on each team's LAST-12-GAMES run rates vs
                         //   full-season rates when estimating strength. Summer
                         //   rosters change, so who a team is NOW can differ
                         //   from who it was in June (July 2026: Lowell's
                         //   last-12 run diff was +1.6/game vs -1.8 full-season)
  rosterChurn: 0.12,     // per-simulation talent shock (std dev). Summer rosters
                         //   turn over mid-season (MLB draft, school, innings
                         //   caps); in 2025, Nashua fell from playoff position
                         //   to 24-36 and a .459 Norwich won the title. This is
                         //   that reality, as a dial.
  dials: {},             // { ABBR: -0.10 .. +0.10 } manual strength adjustment
  forcedOutcomes: {},    // { scheduleIndex: "home" | "away" } scenario tool
  lowellForce: null,     // { w: N } force Lowell to win exactly N of its
                         //   remaining un-forced games (scenario tool)
  focusTeam: "LOW",
  seed: null,            // RNG seed for reproducibility (null = random)
};

// --- small deterministic PRNG (so tests are reproducible) -------------------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

// --- team strength -----------------------------------------------------------

// Pythagenpat: exponent adapts to the league's run environment.
export function pythagenpat(RS, RA, GP) {
  if (!GP || (RS + RA) === 0) return { k: 2, pyth: 0.5 };
  const k = Math.pow((RS + RA) / GP, 0.287);
  const rsk = Math.pow(RS, k);
  const rak = Math.pow(RA, k);
  return { k, pyth: rsk / (rsk + rak) };
}

// talent = blend of Pythagenpat and actual win%, regressed toward .500 with a
// prior of `regressPrior` .500 games, then shifted by the user's strength dial.
// When the team carries recent-form fields (recentRS/recentRA/recentGP, the
// last ~12 games, computed by the scraper), the Pythagenpat input run rates
// are blended toward recent form by `recencyWeight` — the "who are they NOW"
// adjustment. pythWeight/regressPrior default to the model settings; pass
// them explicitly to reproduce the original spec reference values (0.70 / 12).
export function talentFor(team, dial = 0, opts = {}) {
  const w = opts.pythWeight ?? DEFAULT_SETTINGS.pythWeight;
  const prior = opts.regressPrior ?? DEFAULT_SETTINGS.regressPrior;
  const recW = opts.recencyWeight ?? DEFAULT_SETTINGS.recencyWeight;
  if (!team.GP) return clamp(0.5 + dial, 0.05, 0.95);

  let rsPG = team.RS / team.GP;
  let raPG = team.RA / team.GP;
  if (recW > 0 && team.recentGP > 0) {
    // scale by sample size so 3 recent games can't swing everything
    const rw = recW * Math.min(1, team.recentGP / 12);
    rsPG = (1 - rw) * rsPG + rw * (team.recentRS / team.recentGP);
    raPG = (1 - rw) * raPG + rw * (team.recentRA / team.recentGP);
  }
  const { pyth } = pythagenpat(rsPG * team.GP, raPG * team.GP, team.GP);
  const winPct = team.W / team.GP;
  const raw = w * pyth + (1 - w) * winPct;
  let talent = 0.5 + (raw - 0.5) * (team.GP / (team.GP + prior));

  // roster shift: talent adjustment for departures/additions the results
  // haven't caught up to yet (team.rosterShift, from docs/data/rosters.json).
  // Orthogonal to run differential by construction.
  const rw = opts.rosterWeight ?? DEFAULT_SETTINGS.rosterWeight;
  if (rw > 0 && team.rosterShift) talent += rw * team.rosterShift;

  return clamp(talent + dial, 0.05, 0.95);
}

export function log5(pA, pB) {
  const den = pA + pB - 2 * pA * pB;
  if (den === 0) return 0.5;
  return (pA - pA * pB) / den;
}

// Team-specific HFA: half the (home win% - away win%) split, regressed VERY
// hard toward the global value with a 300-game prior: a mid-season home/away
// split is ~16 games a side, which is nearly all noise, so a team's own split
// should only ever nudge the league-average HFA, not replace it. Only the
// HOME team's HFA is applied to a game.
export function teamHFA(team, hfaGlobal, useTeamHFA) {
  if (!useTeamHFA) return hfaGlobal;
  const hg = team.homeW + team.homeL;
  const ag = team.awayW + team.awayL;
  if (!hg || !ag) return hfaGlobal;
  const raw = (team.homeW / hg - team.awayW / ag) / 2;
  return hfaGlobal + (raw - hfaGlobal) * (team.GP / (team.GP + 300));
}

// P(home team wins a single game).
export function gameWinProb(homeTeam, awayTeam, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const th = talentFor(homeTeam, s.dials[homeTeam.abbr] || 0, s);
  const ta = talentFor(awayTeam, s.dials[awayTeam.abbr] || 0, s);
  const hfa = teamHFA(homeTeam, s.hfaGlobal, s.useTeamHFA);
  return clamp(log5(th, ta) + hfa, 0.02, 0.98);
}

// Remaining strength of schedule for one team, venue-adjusted, on a
// win-percentage scale. Defined as the average probability that an exactly
// league-average (.500) team would LOSE each of the remaining games: for a
// .500 reference team, log5 collapses to the opponent's talent, so each
// game's difficulty is opponent talent plus their home-field edge when we're
// on the road, minus the standard home edge when we host. .500 = an average
// slate; higher = harder. Respects the same settings/dials as everything else.
export function remainingSoS(abbr, teams, schedule, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const byAbbr = Object.fromEntries(teams.map((t) => [t.abbr, t]));
  let sum = 0, n = 0, home = 0, away = 0;
  for (const g of schedule) {
    if (g.home !== abbr && g.away !== abbr) continue;
    const isHome = g.home === abbr;
    const opp = byAbbr[isHome ? g.away : g.home];
    if (!opp) continue;
    const oppTalent = talentFor(opp, s.dials[opp.abbr] || 0, s);
    const difficulty = isHome
      ? oppTalent - s.hfaGlobal
      : oppTalent + teamHFA(opp, s.hfaGlobal, s.useTeamHFA);
    sum += clamp(difficulty, 0.02, 0.98);
    n++;
    if (isHome) home++; else away++;
  }
  return { sos: n ? sum / n : 0.5, games: n, home, away };
}

// standard normal draw (Box-Muller) from a uniform RNG, used for the
// roster-churn talent shocks
export function gaussian(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --- standings & tiebreakers -------------------------------------------------

// entries: [{ abbr, pts, gp }]  (pts = 2*wins + derby losses; gp = games played)
// h2hPts / h2hGames: { A: { B: number } }, points A earned vs B / games A-B.
// rand: () => [0,1). Returns abbrs in seed order (1st = best).
//
// Tiebreakers in order: points% -> total points -> head-to-head points% among
// the tied group -> random. Fractions compared by cross-multiplication so
// floating point can never mis-order a genuine tie.
export function rankTeams(entries, h2hPts, h2hGames, rand) {
  const cmpPct = (a, b) => b.pts * a.gp - a.pts * b.gp; // pts/(2gp) desc
  const sorted = [...entries].sort((a, b) => cmpPct(a, b) || (b.pts - a.pts));

  // group teams tied on BOTH points% and total points
  const groups = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && cmpPct(g[0], e) === 0 && g[0].pts === e.pts) g.push(e);
    else groups.push([e]);
  }

  const order = [];
  for (const group of groups) {
    if (group.length === 1) { order.push(group[0].abbr); continue; }
    // head-to-head points% among the tied group
    const scored = group.map((e) => {
      let pts = 0, games = 0;
      for (const other of group) {
        if (other.abbr === e.abbr) continue;
        pts += (h2hPts[e.abbr] && h2hPts[e.abbr][other.abbr]) || 0;
        games += (h2hGames[e.abbr] && h2hGames[e.abbr][other.abbr]) || 0;
      }
      return { abbr: e.abbr, pts, games, r: rand() };
    });
    scored.sort((a, b) => {
      // h2h points% desc via cross-multiply; teams with no h2h games sort as .5? No:
      // a team with 0 h2h games has undefined pct, so treat as 0.5 share.
      const pa = a.games ? a.pts / (2 * a.games) : 0.5;
      const pb = b.games ? b.pts / (2 * b.games) : 0.5;
      if (pa !== pb) return pb - pa;
      return a.r - b.r; // random
    });
    for (const s of scored) order.push(s.abbr);
  }
  return order;
}

// --- best-of-3 series --------------------------------------------------------

// Higher seed hosts games 1 and 3 (home-away-home).
// pMatrix[h][a] = P(team h beats team a when h is home). Returns winner index.
export function playBestOf3(hiIdx, loIdx, pMatrix, rand) {
  let hiWins = 0, loWins = 0;
  const hosts = [hiIdx, loIdx, hiIdx];
  for (let g = 0; g < 3 && hiWins < 2 && loWins < 2; g++) {
    const home = hosts[g];
    const away = home === hiIdx ? loIdx : hiIdx;
    const homeWon = rand() < pMatrix[home][away];
    const winner = homeWon ? home : away;
    if (winner === hiIdx) hiWins++; else loWins++;
  }
  return hiWins > loWins ? hiIdx : loIdx;
}

// --- the full Monte Carlo ----------------------------------------------------

// teams:    array of { abbr, W, L, GP, homeW, homeL, awayW, awayL, RS, RA,
//                      derbyLosses }
// schedule: array of remaining games { date|d, home|h, away|a, ... }
// results:  array of completed games { home, away, winner } (for head-to-head)
// settings: see DEFAULT_SETTINGS
export function simulate({ teams, schedule, results = [], settings = {} }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const n = Math.max(1, Math.floor(s.nSims));
  const rand = mulberry32(s.seed == null ? (Math.floor(Math.random() * 2 ** 31)) : s.seed);

  const abbrs = teams.map((t) => t.abbr);
  const idx = Object.fromEntries(abbrs.map((a, i) => [a, i]));
  const T = teams.length;

  // normalize schedule field names ({d,h,a} seed shorthand or full names)
  const games = schedule.map((g, i) => ({
    i,
    date: g.date || g.d,
    home: idx[g.home || g.h],
    away: idx[g.away || g.a],
  }));

  // per-team remaining game counts -> final GP
  const remaining = new Array(T).fill(0);
  for (const g of games) { remaining[g.home]++; remaining[g.away]++; }

  const talents = teams.map((t) => talentFor(t, s.dials[t.abbr] || 0, s));
  const hfas = teams.map((t) => teamHFA(t, s.hfaGlobal, s.useTeamHFA));

  // matrix[h][a] = P(home team h beats away team a) for a given talent vector
  const buildMatrix = (tal) => {
    const m = [];
    for (let h = 0; h < T; h++) {
      m[h] = [];
      for (let a = 0; a < T; a++) {
        m[h][a] = h === a ? 0.5 : clamp(log5(tal[h], tal[a]) + hfas[h], 0.02, 0.98);
      }
    }
    return m;
  };
  const pMatrix = buildMatrix(talents);              // mean (no-shock) view
  const pGame = games.map((g) => pMatrix[g.home][g.away]);

  // base head-to-head from actual results (winner earns 2 points)
  const baseH2HPts = {}, baseH2HGames = {};
  for (const a of abbrs) { baseH2HPts[a] = {}; baseH2HGames[a] = {}; }
  for (const r of results) {
    if (!(r.home in idx) || !(r.away in idx) || !r.winner) continue;
    const loser = r.winner === r.home ? r.away : r.home;
    baseH2HPts[r.winner][loser] = (baseH2HPts[r.winner][loser] || 0) + 2;
    baseH2HGames[r.home][r.away] = (baseH2HGames[r.home][r.away] || 0) + 1;
    baseH2HGames[r.away][r.home] = (baseH2HGames[r.away][r.home] || 0) + 1;
  }

  // focus-team bookkeeping (Lowell extras)
  const focus = idx[s.focusTeam];
  const focusGames = games.filter((g) => g.home === focus || g.away === focus);
  const forced = s.forcedOutcomes || {};
  const focusUnforced = focusGames.filter((g) => !(g.i in forced));
  // lowellForce.w is the focus team's TOTAL rest-of-way win count. Wins the
  // user already forced on specific games count toward that total, so
  // "goes 15-10" plus a hand-picked forced win still means 15 wins, with the
  // remaining 14 distributed across the un-forced games.
  const focusForcedWins = focusGames.filter((g) => {
    const f = forced[g.i];
    return f && ((f === "home") === (g.home === focus));
  }).length;
  const forceW = s.lowellForce && Number.isFinite(s.lowellForce.w)
    ? clamp(Math.round(s.lowellForce.w) - focusForcedWins, 0, focusUnforced.length)
    : null;

  // tallies
  const playoffCount = new Array(T).fill(0);
  const titleCount = new Array(T).fill(0);
  const seedCount = abbrs.map(() => [0, 0, 0, 0]);
  const winHist = abbrs.map(() => ({}));
  const sumWins = new Array(T).fill(0);
  const byFinalWins = {};                 // focus: finalWins -> {made, n}
  // paired counterfactual tallies: every iteration contributes one sample to
  // BOTH branches (the season as played, and the season with that one game
  // flipped), so winMade and lossMade are each out of n
  const gameLev = focusGames.map(() => ({ winMade: 0, lossMade: 0 }));

  const outcome = new Array(games.length); // true = home team won

  for (let iter = 0; iter < n; iter++) {
    // 0) roster churn: this simulated season, each team's true strength gets
    //    a mid-summer shock (draft departures, school commitments, a roster
    //    that gels). One draw per team per season, not per game.
    let mIter = pMatrix, pIter = pGame;
    if (s.rosterChurn > 0) {
      const shocked = talents.map((t) => clamp(t + s.rosterChurn * gaussian(rand), 0.05, 0.95));
      mIter = buildMatrix(shocked);
      pIter = games.map((g) => mIter[g.home][g.away]);
    }

    // 1) play the season
    for (let gi = 0; gi < games.length; gi++) {
      const f = forced[games[gi].i];
      outcome[gi] = f ? f === "home" : rand() < pIter[gi];
    }

    // optional: force the focus team's aggregate record, distributing wins
    // across its un-forced games weighted by each game's win probability
    if (forceW !== null && focusUnforced.length) {
      const pool = focusUnforced.map((g) => {
        const gi = games.indexOf(g);
        const pFocusWin = g.home === focus ? pIter[gi] : 1 - pIter[gi];
        return { gi, g, w: pFocusWin };
      });
      for (const p of pool) outcome[p.gi] = p.g.home !== focus; // start all losses
      let need = forceW;
      const avail = [...pool];
      while (need > 0 && avail.length) {
        let total = 0;
        for (const p of avail) total += p.w;
        let r = rand() * (total || avail.length);
        let pick = 0;
        for (let j = 0; j < avail.length; j++) {
          r -= total ? avail[j].w : 1;
          if (r <= 0) { pick = j; break; }
        }
        const chosen = avail.splice(pick, 1)[0];
        outcome[chosen.gi] = chosen.g.home === focus; // focus wins
        need--;
      }
    }

    // 2) tally wins and head-to-head
    const simW = new Array(T).fill(0);
    const h2hPts = {}, h2hGames = {};
    for (const a of abbrs) {
      h2hPts[a] = { ...baseH2HPts[a] };
      h2hGames[a] = { ...baseH2HGames[a] };
    }
    for (let gi = 0; gi < games.length; gi++) {
      const g = games[gi];
      const w = outcome[gi] ? g.home : g.away;
      const l = outcome[gi] ? g.away : g.home;
      simW[w]++;
      const wa = abbrs[w], la = abbrs[l];
      h2hPts[wa][la] = (h2hPts[wa][la] || 0) + 2;
      h2hGames[wa][la] = (h2hGames[wa][la] || 0) + 1;
      h2hGames[la][wa] = (h2hGames[la][wa] || 0) + 1;
    }

    // 3) final standings: points = 2*wins + derby losses
    const entries = teams.map((t, ti) => ({
      abbr: t.abbr,
      pts: 2 * (t.W + simW[ti]) + (t.derbyLosses || 0),
      gp: t.GP + remaining[ti],
    }));
    const order = rankTeams(entries, h2hPts, h2hGames, rand);
    const seeds = order.slice(0, 4).map((a) => idx[a]);

    for (let si = 0; si < 4; si++) {
      seedCount[seeds[si]][si]++;
      playoffCount[seeds[si]]++;
    }
    for (let ti = 0; ti < T; ti++) {
      const fw = teams[ti].W + simW[ti];
      sumWins[ti] += fw;
      winHist[ti][fw] = (winHist[ti][fw] || 0) + 1;
    }

    // 4) bracket: 1v4, 2v3 best-of-3; winners meet in a best-of-3 final.
    //    Uses this season's shocked strengths: the roster that limps into
    //    the playoffs is the roster that plays them.
    const semi1 = playBestOf3(seeds[0], seeds[3], mIter, rand);
    const semi2 = playBestOf3(seeds[1], seeds[2], mIter, rand);
    // higher regular-season seed hosts the final
    const s1 = seeds.indexOf(semi1), s2 = seeds.indexOf(semi2);
    const champ = s1 < s2
      ? playBestOf3(semi1, semi2, mIter, rand)
      : playBestOf3(semi2, semi1, mIter, rand);
    titleCount[champ]++;

    // 5) focus-team extras
    if (focus != null) {
      const made = seeds.includes(focus);
      const fw = teams[focus].W + simW[focus];
      const bin = (byFinalWins[fw] = byFinalWins[fw] || { made: 0, n: 0 });
      bin.n++;
      if (made) bin.made++;

      // Per-game leverage, measured CAUSALLY: inside this same simulated
      // season, flip just this one game's outcome and re-rank the standings.
      // Comparing "seasons where the team happened to win game X" against
      // "seasons where it lost" would be badly confounded: with roster churn,
      // winning any given game correlates with having drawn a hot roster all
      // season, which inflates every game's apparent importance. The paired
      // flip isolates what THIS game does, holding the rest of the season
      // fixed.
      for (let fi = 0; fi < focusGames.length; fi++) {
        const g = focusGames[fi];
        const gi = games.indexOf(g);
        const focusWon = outcome[gi] === (g.home === focus);
        const oppIdx = g.home === focus ? g.away : g.home;
        const wIdx = focusWon ? focus : oppIdx;   // actual winner
        const lIdx = focusWon ? oppIdx : focus;   // actual loser
        const wa = abbrs[wIdx], la = abbrs[lIdx];

        // flip: loser takes the 2 points and the head-to-head credit
        entries[wIdx].pts -= 2;
        entries[lIdx].pts += 2;
        h2hPts[wa][la] -= 2;
        h2hPts[la][wa] = (h2hPts[la][wa] || 0) + 2;

        const flippedOrder = rankTeams(entries, h2hPts, h2hGames, rand);
        const madeFlipped = flippedOrder.slice(0, 4).includes(abbrs[focus]);

        // restore
        entries[wIdx].pts += 2;
        entries[lIdx].pts -= 2;
        h2hPts[wa][la] += 2;
        h2hPts[la][wa] -= 2;

        const t = gameLev[fi];
        if (focusWon) {
          t.winMade += made ? 1 : 0;
          t.lossMade += madeFlipped ? 1 : 0;
        } else {
          t.lossMade += made ? 1 : 0;
          t.winMade += madeFlipped ? 1 : 0;
        }
      }
    }
  }

  // --- shape the output ------------------------------------------------------
  const pct = (c) => c / n;
  const percentile = (hist, p) => {
    const keys = Object.keys(hist).map(Number).sort((a, b) => a - b);
    let cum = 0;
    for (const k of keys) { cum += hist[k]; if (cum >= p * n) return k; }
    return keys[keys.length - 1] ?? 0;
  };

  const out = {
    nSims: n,
    settings: {
      hfaGlobal: s.hfaGlobal,
      useTeamHFA: s.useTeamHFA,
      pythWeight: s.pythWeight,
      regressPrior: s.regressPrior,
      rosterChurn: s.rosterChurn,
      dials: s.dials,
      forcedOutcomes: s.forcedOutcomes,
      lowellForce: s.lowellForce,
    },
    gamesCompleted: teams.reduce((sum, t) => sum + t.GP, 0) / 2,
    teams: {},
  };

  teams.forEach((t, ti) => {
    const gpFinal = t.GP + remaining[ti];
    const expWins = sumWins[ti] / n;
    out.teams[t.abbr] = {
      playoffPct: pct(playoffCount[ti]),
      titlePct: pct(titleCount[ti]),
      seedPct: seedCount[ti].map(pct),
      expWins,
      expLosses: gpFinal - expWins,
      winsP10: percentile(winHist[ti], 0.10),
      winsP90: percentile(winHist[ti], 0.90),
    };
  });

  if (focus != null) {
    const oddsByFinalWins = {};
    for (const [w, bin] of Object.entries(byFinalWins)) {
      oddsByFinalWins[w] = {
        pct: bin.made / bin.n,
        sims: bin.n,
        lowConfidence: bin.n < 100,
      };
    }
    const gameProbs = focusGames.map((g, fi) => {
      const gi = games.indexOf(g);
      const home = g.home === focus;
      const winProb = home ? pGame[gi] : 1 - pGame[gi];
      const t = gameLev[fi];
      return {
        date: g.date,
        opp: abbrs[home ? g.away : g.home],
        homeAway: home ? "home" : "away",
        winProb,
        // causal: P(playoffs | this game won) - P(playoffs | this game lost),
        // all else in the season held fixed
        leverage: Math.abs(t.winMade - t.lossMade) / n,
      };
    });
    out.lowell = { oddsByFinalWins, gameProbs };
  }

  return out;
}
