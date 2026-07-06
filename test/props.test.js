import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlayersPage } from "../scripts/lib/parse.js";
import { computeProps } from "../docs/js/props.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (f) => fs.readFileSync(path.join(fixtures, f), "utf8");

const LEAGUE = { ab: 7500, h: 2100, d2: 380, t3 : 60, hr: 150, bb: 900 };
const TEAMS_STUB = [
  { abbr: "LOW", RA: 239, GP: 35 },
  { abbr: "NSH", RA: 151, GP: 32 },
  { abbr: "WF", RA: 218, GP: 33 },
];
const SCHEDULE_STUB = [{ date: "2026-07-06", home: "NSH", away: "LOW" }];

test("REAL player stats page parses Lowell hitters (captured Jul 5, 2026)", () => {
  const hitters = parsePlayersPage(read("real-players-lowell.html"));
  assert.ok(hitters.length >= 10, `parsed ${hitters.length} hitters`);
  const top = hitters.sort((a, b) => b.ab - a.ab)[0];
  assert.equal(top.name, "Esteban Dessureault");
  assert.equal(top.ab, 96);
  assert.equal(top.h, 26);
  // dot-padding stripped, dashes converted to zeros
  assert.ok(hitters.every((h) => !/\./.test(h.name)));
  assert.ok(hitters.every((h) => Number.isFinite(h.hr) && h.hr >= 0));
});

test("props pricing is sane and ordered", () => {
  const hitters = [
    { name: "Hot Hitter", gp: 25, ab: 100, h: 35, d2: 8, t3: 1, hr: 5, tb: 60, bb: 12, hbp: 2, so: 20, r: 20, rbi: 25 },
    { name: "Cold Hitter", gp: 25, ab: 100, h: 18, d2: 3, t3: 0, hr: 1, tb: 24, bb: 6, hbp: 1, so: 35, r: 8, rbi: 9 },
  ];
  const out = computeProps({
    players: { hitters, league: LEAGUE },
    teams: TEAMS_STUB,
    schedule: SCHEDULE_STUB,
  });
  assert.ok(out, "props computed");
  assert.equal(out.game.opp, "NSH");
  assert.equal(out.game.homeAway, "away");
  const hot = out.rows.find((r) => r.name === "Hot Hitter");
  const cold = out.rows.find((r) => r.name === "Cold Hitter");
  for (const r of [hot, cold]) {
    for (const p of Object.values(r.props)) assert.ok(p > 0 && p < 1);
    assert.ok(r.props.hit1 > r.props.hit2, "1+ hit beats 2+ hits");
    assert.ok(r.props.hit1 > r.props.hr1, "a hit is likelier than a homer");
  }
  assert.ok(hot.props.hit1 > cold.props.hit1);
  assert.ok(hot.props.hr1 > cold.props.hr1);
  // facing the league's best pitching staff should deflate odds
  assert.ok(out.oppFactor < 1, `opp factor ${out.oppFactor}`);
});

test("props hide gracefully without data", () => {
  assert.equal(computeProps({ players: null, teams: TEAMS_STUB, schedule: SCHEDULE_STUB }), null);
  assert.equal(computeProps({ players: { hitters: [], league: LEAGUE }, teams: TEAMS_STUB, schedule: SCHEDULE_STUB }), null);
});

test("trackman contact quality nudges rates", () => {
  const hitters = [{ name: "Trackman Guy", gp: 25, ab: 100, h: 25, d2: 5, t3: 0, hr: 2, tb: 36, bb: 10, hbp: 0, so: 25, r: 12, rbi: 12 }];
  const base = computeProps({ players: { hitters, league: LEAGUE }, teams: TEAMS_STUB, schedule: SCHEDULE_STUB });
  const boosted = computeProps({
    players: { hitters, league: LEAGUE }, teams: TEAMS_STUB, schedule: SCHEDULE_STUB,
    trackman: { "Trackman Guy": { n: 60, avgEV: 92, hardHitPct: 0.52 } },
  });
  assert.ok(boosted.rows[0].usedTrackman);
  assert.ok(boosted.rows[0].props.hit1 > base.rows[0].props.hit1, "hard contact raises hit odds");
  // too few tracked balls: ignored
  const ignored = computeProps({
    players: { hitters, league: LEAGUE }, teams: TEAMS_STUB, schedule: SCHEDULE_STUB,
    trackman: { "Trackman Guy": { n: 10, avgEV: 92, hardHitPct: 0.52 } },
  });
  assert.ok(!ignored.rows[0].usedTrackman);
});
