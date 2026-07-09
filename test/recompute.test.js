import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { teamStatsFromResults, rebuild } from "../scripts/lib/recompute.js";
import { dedupeResults } from "../scripts/lib/data.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));

test("recompute reproduces the published team stats from results alone", () => {
  const teams = read("teams.json");
  const results = read("results.json");
  const schedule = read("schedule.json");

  for (const published of teams) {
    const derived = teamStatsFromResults(published.abbr, results, schedule);
    for (const key of ["W", "L", "GP", "homeW", "homeL", "awayW", "awayL", "RS", "RA", "gamesRemaining"]) {
      assert.equal(derived[key], published[key],
        `${published.abbr}.${key}: recomputed ${derived[key]} vs published ${published[key]}`);
    }
  }
});

test("entering a result moves it from schedule to record and updates GP+remaining", () => {
  const results = read("results.json");
  const schedule = read("schedule.json");
  const g = schedule[0];

  // simulate what enter.js does: append the game as a home win, drop from schedule
  const played = {
    date: g.date, home: g.home, away: g.away, homeR: 7, awayR: 3,
    winner: g.home, gameId: `manual_${g.date}_${g.away}_${g.home}_1`, manual: true,
  };
  const newResults = dedupeResults([...results, played]);
  const newSchedule = schedule.filter((_, i) => i !== 0);

  const beforeHome = teamStatsFromResults(g.home, results, schedule);
  const afterHome = teamStatsFromResults(g.home, newResults, newSchedule);
  assert.equal(afterHome.W, beforeHome.W + 1, "home team gains a win");
  assert.equal(afterHome.GP, beforeHome.GP + 1, "home team GP +1");
  assert.equal(afterHome.gamesRemaining, beforeHome.gamesRemaining - 1, "home team one fewer remaining");
  assert.equal(afterHome.RS, beforeHome.RS + 7);
  assert.equal(afterHome.RA, beforeHome.RA + 3);

  const afterAway = teamStatsFromResults(g.away, newResults, newSchedule);
  const beforeAway = teamStatsFromResults(g.away, results, schedule);
  assert.equal(afterAway.L, beforeAway.L + 1, "away team takes the loss");

  // full rebuild stays internally consistent: every team's W+L == GP, and
  // GP+remaining is unchanged by simply recording a game (still totals to 60)
  const { teams } = rebuild(newResults, newSchedule, { asOf: "2026-07-08T00:00:00Z", nSims: 800 });
  for (const t of teams) {
    assert.equal(t.W + t.L, t.GP, `${t.abbr} W+L==GP`);
    assert.equal(t.GP + t.gamesRemaining, 60, `${t.abbr} totals 60`);
  }
});
