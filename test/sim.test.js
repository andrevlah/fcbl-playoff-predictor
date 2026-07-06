import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pythagenpat, talentFor, log5, clamp, teamHFA, gameWinProb,
  rankTeams, simulate, mulberry32,
} from "../src/sim.js";
import { SEED_TEAMS, SEED_SCHEDULE } from "../scripts/lib/seed-data.js";

const LOWELL = { abbr: "LOW", W: 13, L: 22, GP: 35, homeW: 8, homeL: 7, awayW: 5, awayL: 15, RS: 177, RA: 239 };
const VERMONT = { abbr: "VT", W: 22, L: 10, GP: 32, homeW: 13, homeL: 4, awayW: 9, awayL: 6, RS: 214, RA: 180 };

test("worked example from the spec reproduces within ±0.001", () => {
  const low = pythagenpat(LOWELL.RS, LOWELL.RA, LOWELL.GP);
  assert.ok(Math.abs(low.k - 2.035) < 0.001, `Lowell k = ${low.k}`);
  assert.ok(Math.abs(low.pyth - 0.352) < 0.001, `Lowell pyth = ${low.pyth}`);
  assert.ok(Math.abs(talentFor(LOWELL) - 0.394) < 0.001, `Lowell talent = ${talentFor(LOWELL)}`);

  const vt = pythagenpat(VERMONT.RS, VERMONT.RA, VERMONT.GP);
  assert.ok(Math.abs(vt.pyth - 0.588) < 0.001, `Vermont pyth = ${vt.pyth}`);
  assert.ok(Math.abs(talentFor(VERMONT) - 0.586) < 0.001, `Vermont talent = ${talentFor(VERMONT)}`);

  // Lowell at Vermont with GLOBAL HFA only: P(Vermont) = .720
  const pVT = gameWinProb(VERMONT, LOWELL, { useTeamHFA: false, hfaGlobal: 0.035 });
  assert.ok(Math.abs(pVT - 0.720) < 0.001, `P(Vermont home) = ${pVT}`);
  assert.ok(Math.abs((1 - pVT) - 0.280) < 0.001);

  // log5 of Lowell's side matches the spec's .315
  const l5 = log5(talentFor(LOWELL), talentFor(VERMONT));
  assert.ok(Math.abs(l5 - 0.315) < 0.001, `Lowell log5 = ${l5}`);
});

test("team-specific HFA regresses Lowell's extreme split sanely", () => {
  const hfa = teamHFA(LOWELL, 0.035, true);
  // raw split (.533-.250)/2 ≈ .142 -> regressed to ≈ .074 at GP=35
  assert.ok(hfa > 0.06 && hfa < 0.09, `Lowell HFA = ${hfa}`);
  assert.equal(teamHFA(LOWELL, 0.035, false), 0.035);
});

test("points% ranking, including a derby-loss point", () => {
  // A: 10-5 (20 pts / 30) = .667; B: 9-5 + 1 derby loss (19 / 28) = .679 -> B first
  const entries = [
    { abbr: "A", pts: 20, gp: 15 },
    { abbr: "B", pts: 19, gp: 14 },
  ];
  const order = rankTeams(entries, {}, {}, mulberry32(1));
  assert.deepEqual(order, ["B", "A"]);
});

test("total points breaks a points% tie", () => {
  // C: 12-8 (.600, 24 pts) vs D: 9-6 (.600, 18 pts) -> C first on total points
  const entries = [
    { abbr: "D", pts: 18, gp: 15 },
    { abbr: "C", pts: 24, gp: 20 },
  ];
  const order = rankTeams(entries, {}, {}, mulberry32(1));
  assert.deepEqual(order, ["C", "D"]);
});

test("3-way tie resolved by head-to-head points% among the tied group", () => {
  const entries = [
    { abbr: "X", pts: 20, gp: 10 },
    { abbr: "Y", pts: 20, gp: 10 },
    { abbr: "Z", pts: 20, gp: 10 },
  ];
  // among the trio: X beat Y twice and Z twice (8 pts / 4 g), Y beat Z twice
  const h2hPts = { X: { Y: 4, Z: 4 }, Y: { Z: 4 }, Z: {} };
  const h2hGames = { X: { Y: 2, Z: 2 }, Y: { X: 2, Z: 2 }, Z: { X: 2, Y: 2 } };
  const order = rankTeams(entries, h2hPts, h2hGames, mulberry32(1));
  assert.deepEqual(order, ["X", "Y", "Z"]);
});

test("clamp bounds hold", () => {
  assert.equal(clamp(1.5, 0.02, 0.98), 0.98);
  assert.equal(clamp(-1, 0.02, 0.98), 0.02);
});

test("full simulation smoke test on seed data", () => {
  const teams = SEED_TEAMS.map((t) => ({ ...t }));
  const sim = simulate({
    teams,
    schedule: SEED_SCHEDULE,
    results: [],
    settings: { nSims: 5000, seed: 42 },
  });

  const all = Object.values(sim.teams);
  // exactly 4 playoff spots and 1 title per simulated season
  const seedSum = all.reduce((s, t) => s + t.seedPct.reduce((a, b) => a + b, 0), 0);
  const titleSum = all.reduce((s, t) => s + t.titlePct, 0);
  const playoffSum = all.reduce((s, t) => s + t.playoffPct, 0);
  assert.ok(Math.abs(seedSum - 4) < 1e-9, `seed sum = ${seedSum}`);
  assert.ok(Math.abs(titleSum - 1) < 1e-9, `title sum = ${titleSum}`);
  assert.ok(Math.abs(playoffSum - 4) < 1e-9, `playoff sum = ${playoffSum}`);

  assert.ok(sim.teams.VT.playoffPct > sim.teams.LOW.playoffPct, "VT should beat LOW");
  assert.ok(sim.teams.VT.playoffPct > 0.9);

  // expected records land on each team's true final GP (VT and NOR sit at 59
  // in the seed because their July 5 game was in progress at snapshot time)
  for (const t of teams) {
    const o = sim.teams[t.abbr];
    const finalGP = t.GP + SEED_SCHEDULE.filter((g) => g.h === t.abbr || g.a === t.abbr).length;
    assert.ok(Math.abs(o.expWins + o.expLosses - finalGP) < 1e-9, `${t.abbr} final GP`);
    assert.ok(o.winsP10 <= o.expWins && o.expWins <= o.winsP90, `${t.abbr} percentile band`);
  }

  // Lowell extras exist and are sane
  assert.equal(sim.lowell.gameProbs.length, 25);
  for (const g of sim.lowell.gameProbs) {
    assert.ok(g.winProb > 0 && g.winProb < 1);
    assert.ok(g.leverage >= 0 && g.leverage <= 1);
  }
  const bins = Object.entries(sim.lowell.oddsByFinalWins);
  assert.ok(bins.length > 3, "should see a spread of final win totals");
  // more Lowell wins should never make the playoffs less likely (monotone-ish
  // across well-populated bins)
  const solid = bins.filter(([, b]) => b.sims >= 300).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < solid.length; i++) {
    assert.ok(solid[i][1].pct >= solid[i - 1][1].pct - 0.02,
      `odds-by-wins roughly monotone at ${solid[i][0]} wins`);
  }
});

test("scenario tools: forced outcomes and forced Lowell record", () => {
  const teams = SEED_TEAMS.map((t) => ({ ...t }));
  // force Lowell to win out: playoff odds must jump vs baseline
  const baseline = simulate({ teams, schedule: SEED_SCHEDULE, results: [], settings: { nSims: 3000, seed: 7 } });
  const winOut = simulate({
    teams, schedule: SEED_SCHEDULE, results: [],
    settings: { nSims: 3000, seed: 7, lowellForce: { w: 25 } },
  });
  assert.ok(winOut.teams.LOW.playoffPct > baseline.teams.LOW.playoffPct + 0.3,
    `win-out ${winOut.teams.LOW.playoffPct} vs baseline ${baseline.teams.LOW.playoffPct}`);
  assert.ok(Math.abs(winOut.teams.LOW.expWins - 38) < 1e-9, "13 + 25 forced wins = 38");

  // forcing a single game pins its outcome
  const idx = SEED_SCHEDULE.findIndex((g) => g.h === "NSH" && g.a === "LOW");
  const forced = simulate({
    teams, schedule: SEED_SCHEDULE, results: [],
    settings: { nSims: 1000, seed: 7, forcedOutcomes: { [idx]: "away" } },
  });
  const g0 = forced.lowell.gameProbs.find((g, i) => i === 0);
  assert.ok(g0, "focus game list still present");
  assert.ok(forced.teams.LOW.expWins > baseline.teams.LOW.expWins, "a forced win nudges expected wins up");
});
