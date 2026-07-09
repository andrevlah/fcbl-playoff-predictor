// Rebuild the whole published dataset from the results log + remaining
// schedule. Every team stat (record, home/away splits, RS/RA, recent form,
// streak, games remaining) is derived purely from results.json, which
// reconciles exactly with the scraped numbers. This is what lets results be
// entered by hand when the league site can't be scraped: one appended game,
// and everything downstream recomputes.

import { TEAMS, ABBRS, derbyLossOverrides } from "../../config/teams.js";
import { simulate } from "../../src/sim.js";

// Derive a team's full stat line from the completed-results log.
export function teamStatsFromResults(abbr, results, schedule) {
  const games = results
    .filter((r) => r.home === abbr || r.away === abbr)
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

  let W = 0, L = 0, homeW = 0, homeL = 0, awayW = 0, awayL = 0, RS = 0, RA = 0;
  const streakGames = [];
  for (const g of games) {
    const isHome = g.home === abbr;
    const won = g.winner === abbr;
    RS += isHome ? g.homeR : g.awayR;
    RA += isHome ? g.awayR : g.homeR;
    if (won) { W++; isHome ? homeW++ : awayW++; } else { L++; isHome ? homeL++ : awayL++; }
    streakGames.push(won);
  }

  // streak = trailing run of same result
  let streak = "";
  if (streakGames.length) {
    const last = streakGames[streakGames.length - 1];
    let n = 0;
    for (let i = streakGames.length - 1; i >= 0 && streakGames[i] === last; i--) n++;
    streak = `${last ? "W" : "L"}${n}`;
  }

  // recent form = run totals over the last 12 games
  const recent = games.slice(-12);
  let recentRS = 0, recentRA = 0;
  for (const g of recent) {
    const isHome = g.home === abbr;
    recentRS += isHome ? g.homeR : g.awayR;
    recentRA += isHome ? g.awayR : g.homeR;
  }

  const gamesRemaining = schedule.filter((g) => g.home === abbr || g.away === abbr).length;

  return {
    abbr,
    name: TEAMS[abbr].name,
    teamId: TEAMS[abbr].teamId,
    W, L, GP: W + L,
    homeW, homeL, awayW, awayL,
    RS, RA,
    recentRS, recentRA, recentGP: recent.length,
    streak,
    derbyLosses: derbyLossOverrides[abbr] || 0,
    gamesRemaining,
  };
}

// Full rebuild. Returns { teams, odds } ready to write. asOf/nSims injected by
// the caller so this stays free of Date.now() (keeps it testable).
// rosterByTeam: optional { ABBR: { rosterShift, rqi, activePA } } (from
// docs/data/rosters.json) merged onto the team objects so the model and UI
// see the roster signal.
export function rebuild(results, schedule, { asOf, nSims = 25000, rosterByTeam = {} } = {}) {
  const teams = ABBRS.map((abbr) => ({
    ...teamStatsFromResults(abbr, results, schedule),
    ...(rosterByTeam[abbr] || {}),
    asOf,
  }));
  const sim = simulate({ teams, schedule, results, settings: { nSims } });
  const odds = {
    asOf,
    gamesCompleted: sim.gamesCompleted,
    nSims: sim.nSims,
    settings: sim.settings,
    teams: sim.teams,
    lowell: sim.lowell,
  };
  return { teams, odds };
}
