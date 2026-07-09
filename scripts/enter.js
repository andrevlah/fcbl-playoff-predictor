// Manual result entry: `npm run enter`.
//
// The league site now sits behind bot protection that blocks automated
// scraping, so the reliable way to keep the predictor current is to record
// final scores by hand. This starts a tiny local web page (nobody else can
// see it) that lists the unplayed games, lets you type in the final score for
// ANY team's game, then recomputes every team's odds and publishes to the
// live site for you. No terminal typing, no editing files, no git.
//
// Usage:  npm run enter   ->  open the printed http://localhost:4600 link.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TEAMS } from "../config/teams.js";
import { rebuild } from "./lib/recompute.js";
import { dedupeResults, detectNewlyFinal } from "./lib/data.js";
import { parseCompositePaste } from "./lib/parse.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "docs", "data");
const PORT = 4600;

const readJSON = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));
const writeJSON = (name, obj) =>
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(obj, null, 2) + "\n");

const nm = (abbr) => (TEAMS[abbr] ? TEAMS[abbr].shortName : abbr);
const fullDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
};

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

// ---- core actions ----------------------------------------------------------

function saveResult(index, homeR, awayR) {
  const schedule = readJSON("schedule.json");
  const results = readJSON("results.json");
  const g = schedule[index];
  if (!g) throw new Error("That game is no longer on the schedule (already entered?).");
  if (!Number.isInteger(homeR) || !Number.isInteger(awayR) || homeR < 0 || awayR < 0) {
    throw new Error("Scores must be whole numbers, 0 or more.");
  }
  if (homeR === awayR) throw new Error("A game can't end in a tie. Check the final score.");

  const seq = results.filter((r) => r.gameId && r.gameId.startsWith(`manual_${g.date}`)).length + 1;
  const result = {
    date: g.date,
    home: g.home,
    away: g.away,
    homeR, awayR,
    winner: homeR > awayR ? g.home : g.away,
    gameId: g.gameId || `manual_${g.date}_${g.away}_${g.home}_${seq}`,
    innings: null,
    time: g.time || null,
    manual: true,
  };

  const newResults = dedupeResults([...results, result]);
  const newSchedule = schedule.filter((_, i) => i !== index);
  const { pushNote } = publish(newResults, newSchedule);
  return `Recorded: ${nm(g.away)} ${awayR} at ${nm(g.home)} ${homeR}. Winner: ${nm(result.winner)}.${pushNote}`;
}

// Import a batch of finals from text copied off the league's composite page.
// Each final consumes its matching schedule entry (same date + teams first,
// then a TBD-makeup placeholder for the same pairing); already-recorded games
// are skipped so pasting the same day twice is harmless.
function importPaste(text) {
  const finals = parseCompositePaste(text || "");
  if (!finals.length) {
    throw new Error("Couldn't find any final scores in that paste. Copy the whole composite-schedule page (Cmd+A, Cmd+C) and try again.");
  }
  let schedule = readJSON("schedule.json");
  const results = readJSON("results.json");
  const added = [];
  let skipped = 0, unscheduled = 0;

  for (const f of finals) {
    const already =
      results.some((r) => r.date === f.date && r.home === f.home && r.away === f.away && r.homeR === f.homeR && r.awayR === f.awayR) ||
      added.some((r) => r.date === f.date && r.home === f.home && r.away === f.away && r.homeR === f.homeR && r.awayR === f.awayR);
    if (already) { skipped++; continue; }

    // consume the matching schedule entry
    let idx = schedule.findIndex((g) => g.date === f.date && g.home === f.home && g.away === f.away);
    if (idx === -1) {
      idx = schedule.findIndex((g) => g.home === f.home && g.away === f.away && /TBD/i.test(g.note || ""));
    }
    if (idx === -1) unscheduled++;
    else schedule = schedule.filter((_, i) => i !== idx);

    added.push({
      ...f,
      gameId: `manual_${f.date}_${f.away}_${f.home}_${added.length + 1}`,
      innings: null,
      manual: true,
    });
  }

  if (!added.length) {
    return `Nothing new: all ${skipped} game${skipped === 1 ? " was" : "s were"} already recorded.`;
  }
  const { pushNote } = publish(dedupeResults([...results, ...added]), schedule);
  const bits = [`Imported ${added.length} final${added.length === 1 ? "" : "s"}: ` +
    added.map((r) => `${nm(r.away)} ${r.awayR} at ${nm(r.home)} ${r.homeR}`).join("; ") + "."];
  if (skipped) bits.push(`${skipped} already recorded.`);
  if (unscheduled) bits.push(`${unscheduled} had no matching scheduled game (recorded anyway; check the schedule looks right).`);
  return bits.join(" ") + pushNote;
}

function undoLast() {
  const results = readJSON("results.json");
  const schedule = readJSON("schedule.json");
  // most recently appended manual result
  let idx = -1;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].manual) { idx = i; break; }
  }
  if (idx === -1) throw new Error("No hand-entered results to undo.");
  const g = results[idx];
  const newResults = results.filter((_, i) => i !== idx);
  // put the game back on the schedule
  const restored = { date: g.date, home: g.home, away: g.away, time: g.time || null,
    gameId: g.gameId && g.gameId.startsWith("manual_") ? null : g.gameId, note: "" };
  const newSchedule = [...schedule, restored].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
  const { pushNote } = publish(newResults, newSchedule);
  return `Undid: ${nm(g.away)} ${g.awayR} at ${nm(g.home)} ${g.homeR}. It's back on the schedule.${pushNote}`;
}

function publish(results, schedule) {
  const prevResults = readJSON("results.json");
  const asOf = new Date().toISOString();
  const { teams, odds } = rebuild(results, schedule, { asOf, nSims: 25000 });

  writeJSON("teams.json", teams.map((t) => ({ ...t, asOf })));
  writeJSON("schedule.json", schedule);
  writeJSON("results.json", results);
  writeJSON("odds.json", odds);

  const history = readJSON("history.json");
  if (detectNewlyFinal(prevResults, results).length > 0 || detectNewlyFinal(results, prevResults).length > 0) {
    history.push({
      timestamp: asOf,
      date: asOf.slice(0, 10),
      gamesCompleted: odds.gamesCompleted,
      teams: Object.fromEntries(
        Object.entries(odds.teams).map(([a, t]) => [a, { playoffPct: t.playoffPct, titlePct: t.titlePct }])),
    });
    writeJSON("history.json", history);
  }

  // commit + push so the live site updates. If push fails (e.g. offline), the
  // data is still saved locally; report it rather than throwing.
  try {
    git(["add", "docs/data"]);
    // commit with an explicit identity so this works even if the user has
    // never configured git on this machine (same bot identity the automated
    // update workflow uses)
    git([
      "-c", "user.name=fcbl-predictor-bot",
      "-c", "user.email=actions@users.noreply.github.com",
      "commit", "-m", `data: manual result entry ${asOf}`,
    ]);
  } catch {
    // nothing staged (identical data) - not an error worth surfacing
    return { pushed: false, pushNote: "" };
  }
  try {
    git(["push", "origin", "main"]);
    return { pushed: true, pushNote: " The website will refresh in about a minute." };
  } catch (err) {
    return {
      pushed: false,
      pushNote: ` (Saved on this computer, but couldn't publish to the web: ${String(err.message).split("\n")[0]}. Check your internet and click Save again.)`,
    };
  }
}

// ---- the page --------------------------------------------------------------

function page(message, isError) {
  const schedule = readJSON("schedule.json");
  const results = readJSON("results.json");
  const odds = readJSON("odds.json");

  // group unplayed games by date, nearest first
  const byDate = {};
  schedule.forEach((g, i) => {
    (byDate[g.date] = byDate[g.date] || []).push({ ...g, index: i });
  });
  const dates = Object.keys(byDate).sort();

  const standings = Object.entries(odds.teams)
    .sort((a, b) => b[1].playoffPct - a[1].playoffPct)
    .map(([a, t]) => `<tr><td>${nm(a)}</td><td>${(100 * t.playoffPct).toFixed(1)}%</td></tr>`)
    .join("");

  const recentManual = results.filter((r) => r.manual).slice(-6).reverse()
    .map((r) => `<li>${fullDate(r.date)}: ${nm(r.away)} ${r.awayR} at ${nm(r.home)} ${r.homeR}</li>`)
    .join("") || "<li>None yet.</li>";

  const gameRows = dates.slice(0, 8).map((d) => `
    <h3>${fullDate(d)}</h3>
    ${byDate[d].map((g) => `
      <form class="game" method="POST" action="/save">
        <input type="hidden" name="index" value="${g.index}">
        <span class="away">${nm(g.away)}</span>
        <input class="score" name="awayR" type="number" min="0" inputmode="numeric" placeholder="-" aria-label="${nm(g.away)} runs">
        <span class="at">at</span>
        <input class="score" name="homeR" type="number" min="0" inputmode="numeric" placeholder="-" aria-label="${nm(g.home)} runs">
        <span class="home">${nm(g.home)}</span>
        ${g.time ? `<span class="time">${g.time}</span>` : ""}
        <button type="submit">Save</button>
      </form>`).join("")}
  `).join("");

  return `<!doctype html><html><head><meta charset="utf-8">
<title>FCBL - Enter Results</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: "Helvetica Neue", Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 24px; color: #222; }
  h1 { font-size: 24px; margin-bottom: 2px; }
  .sub { color: #666; font-size: 14px; margin-top: 0; }
  h3 { margin: 22px 0 6px; font-size: 15px; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; }
  .game { display: flex; align-items: center; gap: 8px; padding: 7px 0; flex-wrap: wrap; }
  .away, .home { font-weight: 600; min-width: 96px; }
  .home { text-align: left; }
  .at { color: #999; }
  .time { color: #999; font-size: 12px; }
  .score { width: 52px; padding: 6px; font-size: 16px; text-align: center; border: 1px solid #bbb; border-radius: 6px; }
  button { font: inherit; font-weight: 600; padding: 6px 14px; border: 1px solid #C8102E; background: #C8102E; color: #fff; border-radius: 999px; cursor: pointer; }
  button:hover { background: #a50d24; }
  .msg { padding: 12px 14px; border-radius: 6px; margin: 14px 0; font-size: 14px; }
  .ok { background: #eaf7ee; border: 1px solid #a6d9b6; }
  .err { background: #fdeaea; border: 1px solid #e0a6a6; }
  .cols { display: flex; gap: 40px; flex-wrap: wrap; }
  .side { font-size: 13px; color: #444; }
  table { border-collapse: collapse; } td { padding: 2px 10px 2px 0; }
  .undo { background: #fff; color: #222; border-color: #bbb; }
  .undo:hover { background: #f0f0f0; }
  ul { padding-left: 18px; margin: 6px 0; } li { font-size: 13px; margin: 2px 0; }
</style></head><body>
<h1>FCBL Playoff Predictor</h1>
<p class="sub">Enter a final score for any game. When you click Save, the website updates automatically in about a minute.</p>
${message ? `<div class="msg ${isError ? "err" : "ok"}">${message}</div>` : ""}
<details style="margin:14px 0">
  <summary style="cursor:pointer; font-weight:600">Import a whole day at once (fastest)</summary>
  <p style="font-size:13px; color:#666; margin:8px 0">Open
    <a href="https://thefuturesleague.com/composite" target="_blank">thefuturesleague.com/composite</a>
    in your browser, select the whole page (Cmd+A), copy it (Cmd+C), paste it below, click Import.
    Every final score on the page gets recorded in one shot; games already entered are skipped.</p>
  <form method="POST" action="/paste">
    <textarea name="text" rows="5" style="width:100%; font: 12px monospace; border:1px solid #bbb; border-radius:6px; padding:8px" placeholder="Paste the copied page here..."></textarea>
    <button type="submit" style="margin-top:6px">Import scores</button>
  </form>
</details>
${gameRows || "<p>No remaining games on the schedule.</p>"}
<div class="cols" style="margin-top:28px">
  <div class="side">
    <h3>Playoff odds right now</h3>
    <table>${standings}</table>
  </div>
  <div class="side">
    <h3>Recently entered by hand</h3>
    <ul>${recentManual}</ul>
    <form method="POST" action="/undo" onsubmit="return confirm('Undo the last hand-entered result?')">
      <button class="undo" type="submit">Undo last entry</button>
    </form>
  </div>
</div>
</body></html>`;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const p = {};
      for (const pair of b.split("&")) {
        const [k, v] = pair.split("=");
        if (k) p[decodeURIComponent(k)] = decodeURIComponent((v || "").replace(/\+/g, " "));
      }
      resolve(p);
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/save") {
      const b = await parseBody(req);
      const msg = saveResult(Number(b.index), Number(b.homeR), Number(b.awayR));
      res.writeHead(303, { Location: "/?m=" + encodeURIComponent(msg) });
      return res.end();
    }
    if (req.method === "POST" && req.url === "/paste") {
      const b = await parseBody(req);
      const msg = importPaste(b.text || "");
      res.writeHead(303, { Location: "/?m=" + encodeURIComponent(msg) });
      return res.end();
    }
    if (req.method === "POST" && req.url === "/undo") {
      const msg = undoLast();
      res.writeHead(303, { Location: "/?m=" + encodeURIComponent(msg) });
      return res.end();
    }
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const m = url.searchParams.get("m");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(m, false));
  } catch (err) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("Couldn't save that: " + err.message, true));
  }
});

server.listen(PORT, () => {
  console.log(`\n  FCBL result entry is running.`);
  console.log(`  Open this in your browser:  http://localhost:${PORT}\n`);
  console.log(`  Type in final scores, click Save, and the site updates itself.`);
  console.log(`  When you're done, come back here and press Ctrl+C to stop.\n`);
});
