// Compute roster quality from the latest snapshot and publish
// docs/data/rosters.json. Run:  npm run rosters
//
// The snapshot itself changes rarely (roster moves, not game results), so
// this is a run-occasionally script, not part of the regular update loop.
// Refresh the snapshot by asking Claude to pull a new one through the
// browser, then re-run this.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeRosterQuality } from "./lib/roster.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "scripts", "data");

// newest snapshot file wins
const snap = fs.readdirSync(dataDir)
  .filter((f) => f.startsWith("snapshot-") && f.endsWith(".txt"))
  .sort()
  .pop();
if (!snap) throw new Error("no snapshot file in scripts/data/");
const asOf = snap.replace("snapshot-", "").replace(".txt", "");

const rq = computeRosterQuality(fs.readFileSync(path.join(dataDir, snap), "utf8"));

const out = { asOf, ...rq };
fs.writeFileSync(
  path.join(root, "docs", "data", "rosters.json"),
  JSON.stringify(out, null, 2) + "\n"
);

console.log(`rosters.json written from ${snap}`);
console.log(`players: ${rq.counts.hitters} hitters, ${rq.counts.pitchers} pitchers, match rate ${(rq.matchRate * 100).toFixed(0)}%`);
console.log("\ntier calibration (hitting wOBA / pitching FIP core):");
for (const t of [1, 2, 3, 4]) {
  console.log(`  tier ${t}: ${rq.tierCalibration.hitting[t].toFixed(3)} / ${rq.tierCalibration.pitching[t].toFixed(2)}`);
}
console.log(`  league: ${rq.league.woba.toFixed(3)} / ${rq.league.fipCore.toFixed(2)}`);
console.log("\nroster quality (RQI, .500 = average):");
for (const [abbr, t] of Object.entries(rq.teams).sort((a, b) => b[1].rqi - a[1].rqi)) {
  console.log(`  ${abbr.padEnd(4)} ${t.rqi.toFixed(3)}  hit ${String(t.dHit).padStart(5)} r/g  pitch ${String(t.dPitch).padStart(5)} r/g  active PA/IP share ${t.activePAShare}/${t.activeIPShare}`);
}
