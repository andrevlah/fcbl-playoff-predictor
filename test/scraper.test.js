import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchedulePage, parseStatsPage, matchTeamAbbr } from "../scripts/lib/parse.js";
import { assignSeq, dedupeSchedule, dedupeResults, detectNewlyFinal, validate } from "../scripts/lib/data.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (f) => fs.readFileSync(path.join(fixtures, f), "utf8");

test("team-name matching handles city and nickname forms", () => {
  assert.equal(matchTeamAbbr("vs. Worcester"), "WOR");
  assert.equal(matchTeamAbbr("at Bravehearts"), "WOR");
  assert.equal(matchTeamAbbr("Vermont Lake Monsters"), "VT");
  assert.equal(matchTeamAbbr("New Britain"), "NB");
  assert.equal(matchTeamAbbr("Boston Red Sox"), null);
});

test("schedule print page: records, results, remaining, postponed, doubleheaders", () => {
  const p = parseSchedulePage(read("schedule-lowell.html"), "LOW");

  assert.deepEqual(p.record, { W: 2, L: 1 });
  assert.deepEqual(p.home, { W: 1, L: 0 });
  assert.deepEqual(p.away, { W: 1, L: 1 });
  assert.equal(p.streak, "W1");

  assert.equal(p.completed.length, 3);
  const [g1, g2, g3] = p.completed;

  // home win: "vs Worcester", W 5-4
  assert.deepEqual(
    { date: g1.date, home: g1.home, away: g1.away, homeR: g1.homeR, awayR: g1.awayR, winner: g1.winner, gameId: g1.gameId },
    { date: "2026-06-12", home: "LOW", away: "WOR", homeR: 5, awayR: 4, winner: "LOW", gameId: "20260612_ab12" }
  );
  // road loss: "at Vermont", L 3-10
  assert.equal(g2.home, "VT");
  assert.equal(g2.away, "LOW");
  assert.equal(g2.winner, "VT");
  assert.equal(g2.homeR, 10);
  assert.equal(g2.awayR, 3);
  // extra-inning road win: a final is a final regardless of innings
  assert.equal(g3.winner, "LOW");
  assert.equal(g3.innings, 10);

  // the postponed original must NOT appear in remaining; the two July 9
  // doubleheader games must both appear
  assert.equal(p.remaining.length, 2);
  assert.ok(p.remaining.every((g) => g.date === "2026-07-09" && g.home === "LOW" && g.away === "NB"));
});

test("doubleheader with TBD times survives cross-page deduplication", () => {
  const mk = (home, away) => [
    { date: "2026-07-09", home, away, time: null, gameId: null, note: "" },
    { date: "2026-07-09", home, away, time: null, gameId: null, note: "" },
  ];
  // same two physical games as seen from both teams' pages
  const fromNor = assignSeq(mk("NOR", "WOR"));
  const fromWor = assignSeq(mk("NOR", "WOR"));
  const deduped = dedupeSchedule([...fromNor, ...fromWor]);
  assert.equal(deduped.length, 2, "two DH games, not one, not four");
});

test("results dedupe by gameId across both teams' pages", () => {
  const a = { date: "2026-07-04", home: "LOW", away: "VT", homeR: 6, awayR: 2, winner: "LOW", gameId: "20260704_iy4s" };
  const b = { ...a }; // same game parsed from Vermont's page
  assert.equal(dedupeResults([a, b]).length, 1);
});

test("newly-final detection", () => {
  const prev = [
    { date: "2026-07-03", home: "LOW", away: "VT", winner: "VT", gameId: "20260703_aa11" },
  ];
  const fresh = [
    ...prev,
    { date: "2026-07-04", home: "LOW", away: "VT", winner: "LOW", gameId: "20260704_iy4s" },
  ];
  const nf = detectNewlyFinal(prev, fresh);
  assert.equal(nf.length, 1);
  assert.equal(nf[0].gameId, "20260704_iy4s");
  assert.equal(detectNewlyFinal(fresh, fresh).length, 0);
});

test("validation gate rejects records that don't reconcile", () => {
  const teams = [
    { abbr: "LOW", W: 1, L: 0, GP: 1 },
    { abbr: "VT", W: 0, L: 1, GP: 1 },
  ];
  const results = [{ date: "2026-07-04", home: "LOW", away: "VT", winner: "LOW", gameId: "x" }];
  assert.deepEqual(validate(teams, results, []).filter((w) => !w.includes("not 60")), []);

  const bad = [{ ...teams[0], W: 2, L: 0, GP: 2 }, teams[1]];
  assert.throws(() => validate(bad, results, []), /Refusing to publish/);

  // a win against a team missing from the dataset passes per-team checks but
  // must trip the league-wide wins-equal-losses invariant
  const lopsided = [{ abbr: "LOW", W: 1, L: 0, GP: 1 }];
  assert.throws(() => validate(lopsided, [
    { date: "2026-07-04", home: "LOW", away: "XX", winner: "LOW", gameId: "x" },
  ], []), /total wins/);
});

test("REAL live-site schedule page parses and reconciles (captured Jul 5, 2026)", () => {
  const p = parseSchedulePage(read("real-schedule-lowell.html"), "LOW");
  assert.deepEqual(p.record, { W: 13, L: 22 });
  assert.deepEqual(p.home, { W: 8, L: 7 });
  assert.deepEqual(p.away, { W: 5, L: 15 });
  assert.equal(p.streak, "W1");
  assert.equal(p.completed.length, 35);
  assert.equal(p.remaining.length, 25);
  assert.equal(p.completed.length + p.remaining.length, 60);
  const wins = p.completed.filter((g) => g.winner === "LOW").length;
  assert.equal(wins, 13, "parsed wins must reproduce the Overall line");
  // the live site pre-assigns box-score ids to future games
  assert.ok(p.remaining.every((g) => g.gameId), "remaining games carry gameIds");
  assert.ok(p.remaining.every((g) => g.date >= "2026-07-06"), "no stale dates in remaining");
});

test("REAL live-site stats page parses all 7 teams (captured Jul 5, 2026)", () => {
  const stats = parseStatsPage(read("real-stats.html"));
  assert.equal(Object.keys(stats).length, 7);
  assert.equal(stats.LOW.RS, 177);
  assert.equal(stats.LOW.RA, 239);
});

test("stats page: RS from baserunning table, RA from pitching table", () => {
  const stats = parseStatsPage(read("stats.html"));
  assert.equal(stats.VT.RS, 214);
  assert.equal(stats.VT.RA, 180);
  assert.equal(stats.LOW.RS, 177);
  assert.equal(stats.LOW.RA, 239);
  assert.equal(Object.keys(stats).length, 7);
});
