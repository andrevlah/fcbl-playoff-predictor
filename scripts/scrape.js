// FCBL Playoff Predictor: scheduled scraper.
//
// Flow: fetch 7 team schedule print pages + 1 stats page (+ composite pages
// for today/yesterday as a corroborating signal) -> parse -> VALIDATE ->
// detect newly-final games -> re-simulate 25,000 seasons -> rewrite
// docs/data/*.json -> append history.json when new finals landed.
//
// Safety promise: if anything fails to fetch, parse, or validate, this script
// logs the problem, exits nonzero, and leaves every published file untouched.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEAMS, ABBRS, derbyLossOverrides } from "../config/teams.js";
import { simulate } from "../src/sim.js";
import { politeFetch } from "./lib/fetch.js";
import { parseSchedulePage, parseStatsPage } from "./lib/parse.js";
import { assignSeq, dedupeSchedule, dedupeResults, detectNewlyFinal, validate } from "./lib/data.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "docs", "data");

// NOTE: the futuresleague.prestosports.com subdomain 403s non-browser
// clients; the identical PrestoSports pages on the main domain accept our
// polite User-Agent, so all fetches go through thefuturesleague.com.
const SCHEDULE_URL = (teamId) =>
  `https://thefuturesleague.com/sports/bsb/2026/schedule?teamId=${teamId}&dec=printer-decorator`;
const STATS_URL = "https://thefuturesleague.com/sports/bsb/2026/teams?sort=r&r=0&pos=br";
const COMPOSITE_URL = (d) => `https://thefuturesleague.com/composite?d=${d}`;

const readJSON = (name, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));
  } catch {
    return fallback;
  }
};
const writeJSON = (name, obj) =>
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(obj, null, 2) + "\n");

const etDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
};

async function main() {
  console.log(`FCBL scraper starting ${new Date().toISOString()}`);
  const prevResults = readJSON("results.json", []);
  const history = readJSON("history.json", []);

  // --- 1) fetch + parse the 7 authoritative schedule pages ------------------
  const pages = {};
  for (const abbr of ABBRS) {
    console.log(`fetching schedule: ${TEAMS[abbr].name}`);
    const html = await politeFetch(SCHEDULE_URL(TEAMS[abbr].teamId));
    const parsed = parseSchedulePage(html, abbr);
    if (!parsed.record) throw new Error(`${abbr}: could not find the Overall record on the schedule page`);
    parsed.completed = assignSeq(parsed.completed);
    parsed.remaining = assignSeq(parsed.remaining);
    pages[abbr] = parsed;
  }

  // --- 2) fetch + parse team run totals --------------------------------------
  console.log("fetching team stats (RS/RA)");
  const stats = parseStatsPage(await politeFetch(STATS_URL));

  // --- 3) composite pages (corroborating signal only; never authoritative) ---
  for (const d of [etDate(0), etDate(-1)]) {
    try {
      const html = await politeFetch(COMPOSITE_URL(d));
      const finals = (html.match(/Final/gi) || []).length;
      const live = (html.match(/Live stats/gi) || []).length;
      console.log(`composite ${d}: ~${finals} final marker(s), ~${live} live game(s)`);
    } catch (err) {
      console.warn(`composite ${d} unavailable (non-fatal): ${err.message}`);
    }
  }

  // --- 4) assemble the dataset ------------------------------------------------
  const results = dedupeResults(ABBRS.flatMap((a) => pages[a].completed));
  const schedule = dedupeSchedule(ABBRS.flatMap((a) => pages[a].remaining));
  const asOf = new Date().toISOString();

  // recent form: run rates over each team's last 12 games, feeding the
  // model's recency blend ("who are they NOW", not "who were they in June")
  const recentForm = (abbr) => {
    const games = results
      .filter((r) => r.home === abbr || r.away === abbr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-12);
    let recentRS = 0, recentRA = 0;
    for (const g of games) {
      const isHome = g.home === abbr;
      recentRS += isHome ? g.homeR : g.awayR;
      recentRA += isHome ? g.awayR : g.homeR;
    }
    return { recentRS, recentRA, recentGP: games.length };
  };

  const teams = ABBRS.map((abbr) => {
    const p = pages[abbr];
    // splits: prefer the page's Home/Away lines; fall back to counting results
    const homeGames = results.filter((r) => r.home === abbr);
    const awayGames = results.filter((r) => r.away === abbr);
    const homeW = p.home?.W ?? homeGames.filter((r) => r.winner === abbr).length;
    const homeL = p.home?.L ?? homeGames.filter((r) => r.winner !== abbr).length;
    const awayW = p.away?.W ?? awayGames.filter((r) => r.winner === abbr).length;
    const awayL = p.away?.L ?? awayGames.filter((r) => r.winner !== abbr).length;
    return {
      abbr,
      name: TEAMS[abbr].name,
      teamId: TEAMS[abbr].teamId,
      W: p.record.W,
      L: p.record.L,
      GP: p.record.W + p.record.L,
      homeW, homeL, awayW, awayL,
      RS: stats[abbr].RS,
      RA: stats[abbr].RA,
      ...recentForm(abbr),
      streak: p.streak || "",
      derbyLosses: derbyLossOverrides[abbr] || 0,
      gamesRemaining: schedule.filter((g) => g.home === abbr || g.away === abbr).length,
      asOf,
    };
  });

  // --- 5) validation gate -------------------------------------------------------
  const warnings = validate(teams, results, schedule);
  for (const w of warnings) console.warn(`WARNING: ${w}`);

  // --- 6) newly-final detection --------------------------------------------------
  const newlyFinal = detectNewlyFinal(prevResults, results);
  console.log(`${results.length} completed games (${newlyFinal.length} newly final), ${schedule.length} remaining`);
  for (const g of newlyFinal) {
    console.log(`  NEW FINAL: ${g.date} ${g.away} ${g.awayR} at ${g.home} ${g.homeR}`);
  }

  // --- 7) simulate ---------------------------------------------------------------
  console.log("simulating 25,000 seasons...");
  const sim = simulate({ teams, schedule, results, settings: { nSims: 25000 } });
  const odds = {
    asOf,
    gamesCompleted: sim.gamesCompleted,
    nSims: sim.nSims,
    settings: sim.settings,
    teams: sim.teams,
    lowell: sim.lowell,
  };

  // --- 8) publish ------------------------------------------------------------------
  writeJSON("teams.json", teams);
  writeJSON("schedule.json", schedule.map(({ seq, ...g }) => g));
  writeJSON("results.json", results);
  writeJSON("odds.json", odds);

  if (newlyFinal.length > 0 || history.length === 0) {
    history.push({
      timestamp: asOf,
      date: etDate(0),
      gamesCompleted: sim.gamesCompleted,
      teams: Object.fromEntries(
        Object.entries(sim.teams).map(([abbr, t]) => [
          abbr,
          { playoffPct: t.playoffPct, titlePct: t.titlePct },
        ])
      ),
    });
    writeJSON("history.json", history);
    console.log("history.json: appended a new entry");
  } else {
    console.log("history.json: no newly-final games, nothing appended");
  }

  console.log("done, dataset published");
}

main().catch((err) => {
  // Rate limiting is weather, not breakage: the site will let the next
  // scheduled run through, and the published data is untouched. Exit clean
  // with a workflow warning so red X's stay meaningful (parse/validation
  // failures, which need a human, still fail loudly).
  if (/HTTP (403|405|429)/.test(err.message || "")) {
    console.warn("\nSCRAPE SKIPPED: the league site is rate-limiting us right now.");
    console.warn("Previous data left untouched; the next scheduled run will catch up.");
    console.warn(`::warning::Scrape skipped (rate limited): ${err.message}`);
    process.exit(0);
  }
  console.error("\nSCRAPE FAILED: previous data left untouched.");
  console.error(err.stack || err.message);
  process.exit(1);
});
