// Regenerates docs/data/ from the embedded July 5 snapshot.
// Run with:  npm run seed
// You should never need this after the first live scrape — it exists so the
// site works out of the box and so the repo can be reset to a known state.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulate } from "../src/sim.js";
import { TEAMS, derbyLossOverrides } from "../config/teams.js";
import { SEED_TEAMS, SEED_SCHEDULE, SEED_AS_OF } from "./lib/seed-data.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "docs", "data");
fs.mkdirSync(dataDir, { recursive: true });

const teams = SEED_TEAMS.map((t) => ({
  ...t,
  name: TEAMS[t.abbr].name,
  teamId: TEAMS[t.abbr].teamId,
  derbyLosses: derbyLossOverrides[t.abbr] || t.derbyLosses || 0,
  asOf: SEED_AS_OF,
}));

const schedule = SEED_SCHEDULE.map((g) => ({
  date: g.d,
  home: g.h,
  away: g.a,
  time: null,
  gameId: null,
  note: g.dh ? `Doubleheader game ${g.dh}` : "",
}));

const results = [];

// sanity: per-team remaining counts must match the snapshot
for (const t of teams) {
  const count = schedule.filter((g) => g.home === t.abbr || g.away === t.abbr).length;
  if (count !== t.gamesRemaining) {
    throw new Error(`Seed mismatch for ${t.abbr}: schedule has ${count} games, expected ${t.gamesRemaining}`);
  }
}

console.log("Simulating 25,000 seasons from seed data...");
const sim = simulate({ teams, schedule, results, settings: { nSims: 25000, seed: 20260705 } });

const odds = {
  asOf: SEED_AS_OF,
  gamesCompleted: sim.gamesCompleted,
  nSims: sim.nSims,
  settings: sim.settings,
  teams: sim.teams,
  lowell: sim.lowell,
};

const history = [
  {
    timestamp: SEED_AS_OF,
    date: "2026-07-05",
    gamesCompleted: sim.gamesCompleted,
    teams: Object.fromEntries(
      Object.entries(sim.teams).map(([abbr, t]) => [
        abbr,
        { playoffPct: t.playoffPct, titlePct: t.titlePct },
      ])
    ),
  },
];

const write = (name, obj) => {
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(obj, null, 2) + "\n");
  console.log(`wrote docs/data/${name}`);
};

write("teams.json", teams);
write("schedule.json", schedule);
write("results.json", results);
write("odds.json", odds);
write("history.json", history);

console.log("\nSeed odds:");
for (const [abbr, t] of Object.entries(sim.teams)) {
  console.log(
    `  ${abbr.padEnd(4)} playoffs ${(t.playoffPct * 100).toFixed(1).padStart(5)}%  title ${(t.titlePct * 100).toFixed(1).padStart(5)}%  proj ${t.expWins.toFixed(1)}-${t.expLosses.toFixed(1)}`
  );
}
