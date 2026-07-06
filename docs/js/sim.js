// ---------------------------------------------------------------------------
// FCBL Playoff Predictor — simulation engine (single source of truth).
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

// talent = 0.70*pyth + 0.30*win%, regressed toward .500 with a 12-game prior,
// then shifted by the user's strength dial and clamped.
export function talentFor(team, dial = 0) {
  if (!team.GP) return clamp(0.5 + dial, 0.05, 0.95);
  const { pyth } = pythagenpat(team.RS, team.RA, team.GP);
  const winPct = team.W / team.GP;
  const raw = 0.70 * pyth + 0.30 * winPct;
  const talent = 0.5 + (raw - 0.5) * (team.GP / (team.GP + 12));
  return clamp(talent + dial, 0.05, 0.95);
}

export function log5(pA, pB) {
  const den = pA + pB - 2 * pA * pB;
  if (den === 0) return 0.5;
  return (pA - pA * pB) / den;
}

// Team-specific HFA: half the (home win% - away win%) split, regressed hard
// toward the global value with a 60-game prior. Only the HOME team's HFA is
// applied to a game.
export function teamHFA(team, hfaGlobal, useTeamHFA) {
  if (!useTeamHFA) return hfaGlobal;
  const hg = team.homeW + team.homeL;
  const ag = team.awayW + team.awayL;
  if (!hg || !ag) return hfaGlobal;
  const raw = (team.homeW / hg - team.awayW / ag) / 2;
  return hfaGlobal + (raw - hfaGlobal) * (team.GP / (team.GP + 60));
}

// P(home team wins a single game).
export function gameWinProb(homeTeam, awayTeam, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const th = talentFor(homeTeam, s.dials[homeTeam.abbr] || 0);
  const ta = talentFor(awayTeam, s.dials[awayTeam.abbr] || 0);
  const hfa = teamHFA(homeTeam, s.hfaGlobal, s.useTeamHFA);
  return clamp(log5(th, ta) + hfa, 0.02, 0.98);
}

// --- standings & tiebreakers -------------------------------------------------

// entries: [{ abbr, pts, gp }]  (pts = 2*wins + derby losses; gp = games played)
// h2hPts / h2hGames: { A: { B: number } } — points A earned vs B / games A-B.
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
      // a team with 0 h2h games has undefined pct — treat as 0.5 share.
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

  const talents = teams.map((t) => talentFor(t, s.dials[t.abbr] || 0));
  const hfas = teams.map((t) => teamHFA(t, s.hfaGlobal, s.useTeamHFA));

  // pMatrix[h][a] = P(home team h beats away team a)
  const pMatrix = [];
  for (let h = 0; h < T; h++) {
    pMatrix[h] = [];
    for (let a = 0; a < T; a++) {
      pMatrix[h][a] = h === a ? 0.5
        : clamp(log5(talents[h], talents[a]) + hfas[h], 0.02, 0.98);
    }
  }
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
  const forceW = s.lowellForce && Number.isFinite(s.lowellForce.w)
    ? clamp(Math.round(s.lowellForce.w), 0, focusUnforced.length) : null;

  // tallies
  const playoffCount = new Array(T).fill(0);
  const titleCount = new Array(T).fill(0);
  const seedCount = abbrs.map(() => [0, 0, 0, 0]);
  const winHist = abbrs.map(() => ({}));
  const sumWins = new Array(T).fill(0);
  const byFinalWins = {};                 // focus: finalWins -> {made, n}
  const gameLev = focusGames.map(() => ({ winMade: 0, winN: 0, lossMade: 0, lossN: 0 }));

  const outcome = new Array(games.length); // true = home team won

  for (let iter = 0; iter < n; iter++) {
    // 1) play the season
    for (let gi = 0; gi < games.length; gi++) {
      const f = forced[games[gi].i];
      outcome[gi] = f ? f === "home" : rand() < pGame[gi];
    }

    // optional: force the focus team's aggregate record, distributing wins
    // across its un-forced games weighted by each game's win probability
    if (forceW !== null && focusUnforced.length) {
      const pool = focusUnforced.map((g) => {
        const gi = games.indexOf(g);
        const pFocusWin = g.home === focus ? pGame[gi] : 1 - pGame[gi];
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

    // 3) final standings — points = 2*wins + derby losses
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

    // 4) bracket: 1v4, 2v3 best-of-3; winners meet in a best-of-3 final
    const semi1 = playBestOf3(seeds[0], seeds[3], pMatrix, rand);
    const semi2 = playBestOf3(seeds[1], seeds[2], pMatrix, rand);
    // higher regular-season seed hosts the final
    const s1 = seeds.indexOf(semi1), s2 = seeds.indexOf(semi2);
    const champ = s1 < s2
      ? playBestOf3(semi1, semi2, pMatrix, rand)
      : playBestOf3(semi2, semi1, pMatrix, rand);
    titleCount[champ]++;

    // 5) focus-team extras
    if (focus != null) {
      const made = seeds.includes(focus);
      const fw = teams[focus].W + simW[focus];
      const bin = (byFinalWins[fw] = byFinalWins[fw] || { made: 0, n: 0 });
      bin.n++;
      if (made) bin.made++;
      for (let fi = 0; fi < focusGames.length; fi++) {
        const g = focusGames[fi];
        const gi = games.indexOf(g);
        const focusWon = outcome[gi] === (g.home === focus);
        const t = gameLev[fi];
        if (focusWon) { t.winN++; if (made) t.winMade++; }
        else { t.lossN++; if (made) t.lossMade++; }
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
      const pWin = t.winN ? t.winMade / t.winN : 0;
      const pLoss = t.lossN ? t.lossMade / t.lossN : 0;
      return {
        date: g.date,
        opp: abbrs[home ? g.away : g.home],
        homeAway: home ? "home" : "away",
        winProb,
        leverage: (t.winN && t.lossN) ? Math.abs(pWin - pLoss) : 0,
      };
    });
    out.lowell = { oddsByFinalWins, gameProbs };
  }

  return out;
}
