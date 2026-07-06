// HTML parsers for the two PrestoSports page types we rely on.
// Both are deliberately defensive: the validation gate in data.js is the real
// safety net: if the site's markup shifts and parsing goes wrong, records
// won't reconcile and the scraper refuses to publish.

import * as cheerio from "cheerio";
import { TEAMS } from "../../config/teams.js";

const SEASON_YEAR = 2026;

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// Distinctive tokens per team so "vs Worcester", "at Bravehearts", or the
// full club name all resolve to an abbreviation.
const TEAM_TOKENS = {
  LOW: ["lowell", "spinners"],
  NSH: ["nashua", "silver knights"],
  NB:  ["new britain", "bees"],
  NOR: ["norwich", "sea unicorns"],
  VT:  ["vermont", "lake monsters"],
  WF:  ["westfield", "starfires"],
  WOR: ["worcester", "bravehearts"],
};

export function matchTeamAbbr(text) {
  const t = text.toLowerCase();
  for (const [abbr, tokens] of Object.entries(TEAM_TOKENS)) {
    if (tokens.some((tok) => t.includes(tok))) return abbr;
  }
  return null;
}

function parseDate(text) {
  // "07/04/2026" or "07/04"
  let m = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(SEASON_YEAR);
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // "Jul 4", "July 4", "Sat, Jul 4"
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (m) return `${SEASON_YEAR}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  return null;
}

function normalizeTime(text) {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i);
  if (!m) return null;
  return `${m[1]}:${m[2] || "00"} ${m[3].toUpperCase()}M`;
}

function extractRecord(text, label) {
  const re = new RegExp(`${label}[^0-9]{0,10}(\\d+)\\s*-\\s*(\\d+)`, "i");
  const m = text.match(re);
  return m ? { W: parseInt(m[1], 10), L: parseInt(m[2], 10) } : null;
}

// Parse one team's schedule print page.
// Returns { record, home, away, streak, completed: [...], remaining: [...] }
// completed:  { date, home, away, homeR, awayR, winner, gameId, innings, time }
// remaining:  { date, home, away, time, gameId: null, note }
export function parseSchedulePage(html, teamAbbr) {
  const $ = cheerio.load(html);
  const pageText = $("body").text().replace(/\s+/g, " ");

  const record = extractRecord(pageText, "Overall");
  const home = extractRecord(pageText, "Home");
  const away = extractRecord(pageText, "Away");
  const streakM = pageText.match(/Streak[^A-Za-z0-9]{0,5}([WL])\s*-?\s*(\d+)/i);
  const streak = streakM ? `${streakM[1].toUpperCase()}${streakM[2]}` : null;

  const completed = [];
  const remaining = [];

  $("tr").each((_, tr) => {
    const cells = $(tr).find("td, th").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get();
    const rowText = cells.join(" | ");
    if (!cells.length) return;

    // locate the opponent cell ("vs X" = we're home, "at X" = we're away)
    let oppCell = null, isHome = null;
    for (const c of cells) {
      const m = c.match(/^\s*(vs\.?|at)\s+(.+)$/i);
      if (m && matchTeamAbbr(m[2])) {
        oppCell = m[2];
        isHome = /^vs/i.test(m[1]);
        break;
      }
    }
    if (oppCell === null) return; // header/filler row

    const date = parseDate(rowText);
    if (!date) return;

    const opp = matchTeamAbbr(oppCell);
    const homeAbbr = isHome ? teamAbbr : opp;
    const awayAbbr = isHome ? opp : teamAbbr;

    const gameIdM = $(tr).find('a[href*="boxscore"]').attr("href")?.match(/boxscores?\/([A-Za-z0-9_-]+?)(?:\.xml)?(?:[?#]|$)/);
    const gameId = gameIdM ? gameIdM[1] : null;
    const time = normalizeTime(rowText);

    // Result like "W, 10-5" / "L 3-4"; first score is OUR runs (Presto style)
    const resM = rowText.match(/\b([WL])\s*,?\s+(\d+)\s*-\s*(\d+)/);
    const postponed = /\b(ppd|postponed|susp)\b/i.test(rowText);
    const cancelled = /\b(cancelled|canceled)\b/i.test(rowText);

    if (resM) {
      const won = resM[1].toUpperCase() === "W";
      const ourR = parseInt(resM[2], 10);
      const theirR = parseInt(resM[3], 10);
      // scores are listed winner-first on some templates; the W/L letter is
      // authoritative, so orient runs to make it consistent
      const [hi, lo] = ourR >= theirR ? [ourR, theirR] : [theirR, ourR];
      const ourRuns = won ? hi : lo;
      const theirRuns = won ? lo : hi;
      const inningsM = rowText.match(/(\d{1,2})\s+inning/i);
      completed.push({
        date,
        home: homeAbbr,
        away: awayAbbr,
        homeR: isHome ? ourRuns : theirRuns,
        awayR: isHome ? theirRuns : ourRuns,
        winner: won ? teamAbbr : opp,
        gameId,
        innings: inningsM ? parseInt(inningsM[1], 10) : null,
        time,
      });
    } else if (!postponed && !cancelled) {
      remaining.push({
        date,
        home: homeAbbr,
        away: awayAbbr,
        time,
        gameId,
        note: "",
      });
    }
    // postponed/cancelled originals are intentionally dropped: the makeup
    // game shows up as its own (often doubleheader) row on the new date
  });

  return { record, home, away, streak, completed, remaining };
}

// Parse the all-teams stats page. RS = "R" column of the baserunning table,
// RA = "R" column of the pitching table.
// Returns { ABBR: { RS, RA, GP } }
export function parseStatsPage(html) {
  const $ = cheerio.load(html);
  const out = {};

  $("table").each((_, table) => {
    const headers = $(table).find("tr").first().find("th, td")
      .map((_, c) => $(c).text().trim().toLowerCase()).get();
    if (!headers.length) return;

    const has = (h) => headers.some((x) => x === h || x.startsWith(h + " "));
    const isPitching = has("era") || has("ip");
    const isBaserunning = has("sb") && !has("ab") && !isPitching;
    if (!isPitching && !isBaserunning) return;

    const rIdx = headers.findIndex((h) => h === "r");
    const gpIdx = headers.findIndex((h) => h === "gp" || h === "g");
    if (rIdx === -1) return;

    $(table).find("tr").slice(1).each((_, tr) => {
      const cells = $(tr).find("td, th").map((_, c) => $(c).text().trim()).get();
      if (cells.length <= rIdx) return;
      const abbr = matchTeamAbbr(cells.join(" "));
      if (!abbr) return;
      const r = parseInt(cells[rIdx].replace(/,/g, ""), 10);
      if (!Number.isFinite(r)) return;
      out[abbr] = out[abbr] || {};
      if (isBaserunning) out[abbr].RS = r;
      if (isPitching) out[abbr].RA = r;
      if (gpIdx !== -1) {
        const gp = parseInt(cells[gpIdx], 10);
        if (Number.isFinite(gp)) out[abbr].GP = gp;
      }
    });
  });

  const missing = Object.keys(TEAMS).filter((a) => !out[a] || out[a].RS == null || out[a].RA == null);
  if (missing.length) {
    throw new Error(`Stats page parse incomplete, missing RS/RA for: ${missing.join(", ")}`);
  }
  return out;
}
