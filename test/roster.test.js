import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSchool, schoolTier } from "../config/schools.js";
import { computeRosterQuality, parseSnapshot } from "../scripts/lib/roster.js";
import { talentFor } from "../src/sim.js";

const snapPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..",
  "scripts", "data", "snapshot-2026-07-08.txt");
const snapshot = fs.readFileSync(snapPath, "utf8");

test("school normalizer collapses the site's name variants", () => {
  assert.equal(normalizeSchool("Bryant University"), normalizeSchool("Bryant"));
  assert.equal(normalizeSchool("UCONN"), normalizeSchool("Connecticut"));
  assert.equal(normalizeSchool("Salve"), normalizeSchool("Salve Regina University"));
  assert.equal(normalizeSchool("Univ of Southern Maine"), "southern maine");
  assert.equal(schoolTier("Boston College"), 1);
  assert.equal(schoolTier("Kansas State"), 1);
  assert.equal(schoolTier("Stonehill College"), 2); // D1 since 2022
  assert.equal(schoolTier("Saint Anselm College"), 3);
  assert.equal(schoolTier("Colby"), 4);
  assert.equal(schoolTier(""), 0);
  assert.equal(schoolTier("Some Unknown Place"), 0);
});

test("snapshot parses completely", () => {
  const { roster, hitters, pitchers } = parseSnapshot(snapshot);
  assert.equal(hitters.length, 125);
  assert.equal(pitchers.length, 125);
  assert.ok(roster.length > 350, `roster ${roster.length}`);
  // every stat line's team resolved to an abbreviation
  for (const h of [...hitters, ...pitchers]) {
    assert.ok(h.team.length <= 3, `unresolved team: ${h.team}`);
  }
});

test("roster quality: all 7 teams scored, sane range, high match rate", () => {
  const rq = computeRosterQuality(snapshot);
  assert.equal(Object.keys(rq.teams).length, 7);
  assert.ok(rq.matchRate >= 0.9, `match rate ${rq.matchRate}`);
  for (const [abbr, t] of Object.entries(rq.teams)) {
    assert.ok(t.rqi >= 0.35 && t.rqi <= 0.65, `${abbr} rqi ${t.rqi}`);
    assert.ok(t.activePAShare > 0 && t.activePAShare <= 1);
  }
  // league-average check: PA-share-weighted RQIs shouldn't all sit on one side
  const vals = Object.values(rq.teams).map((t) => t.rqi);
  assert.ok(Math.min(...vals) < 0.5 && Math.max(...vals) > 0.5, "RQIs straddle .500");
});

test("inactive players are excluded from a team's rating", () => {
  // two teams, one slugger each; LOW's slugger is Active, NSH's is Inactive.
  // identical stat lines, so any difference comes purely from status.
  const synth = [
    "LOW~Here Slugger~OF~Active~Boston College",
    "LOW~Meh Batter~OF~Active~Colby",
    "NSH~Gone Slugger~OF~Inactive~Boston College",
    "NSH~Meh Hitter~OF~Active~Colby",
    "H~H Slugger~Lowell Spinners~20~80~40~10~2~8~10~2~10",
    "H~M Batter~Lowell Spinners~20~80~16~2~0~0~4~1~20",
    "H~G Slugger~Nashua Silver Knights~20~80~40~10~2~8~10~2~10",
    "H~M Hitter~Nashua Silver Knights~20~80~16~2~0~0~4~1~20",
  ].join("\n");
  const rq = computeRosterQuality(synth);
  assert.ok(rq.teams.LOW.rqi > rq.teams.NSH.rqi,
    `LOW keeps its slugger (${rq.teams.LOW.rqi}), NSH lost theirs (${rq.teams.NSH.rqi})`);
});

test("rqi shifts sim talent by rosterWeight", () => {
  const base = { abbr: "X", W: 16, L: 16, GP: 32, RS: 190, RA: 190 };
  const strongRoster = { ...base, rqi: 0.56 };
  const weakRoster = { ...base, rqi: 0.44 };
  const t0 = talentFor(base, 0, { rosterWeight: 0.15 });
  const tUp = talentFor(strongRoster, 0, { rosterWeight: 0.15 });
  const tDn = talentFor(weakRoster, 0, { rosterWeight: 0.15 });
  assert.ok(Math.abs(tUp - t0 - 0.15 * 0.06) < 1e-9, `up shift ${tUp - t0}`);
  assert.ok(Math.abs(t0 - tDn - 0.15 * 0.06) < 1e-9, `down shift ${t0 - tDn}`);
  // weight 0 disables it
  assert.equal(talentFor(strongRoster, 0, { rosterWeight: 0 }), t0);
});
