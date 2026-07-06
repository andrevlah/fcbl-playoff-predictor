// Trackman import: turns raw Trackman CSV exports into the contact-quality
// summary the Props Lab uses.
//
// How Andre uses it:
//   1. Export game CSVs from Trackman (the standard pitch-by-pitch export).
//   2. Drop them into a folder named  trackman/  at the top of this project.
//   3. Run:  npm run trackman
//   4. Commit the updated docs/data/trackman.json (GitHub Desktop: Commit,
//      then Push). Players with 25+ tracked batted balls get a contact-quality
//      nudge in the Props Lab, marked with a satellite icon.
//
// The importer is deliberately forgiving about column names: it looks for a
// batter-name column and an exit-velocity column among the common Trackman
// header variants, and only counts rows that look like batted balls.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const inDir = path.join(root, "trackman");
const outFile = path.join(root, "docs", "data", "trackman.json");

const BATTER_COLS = ["batter", "battername", "batter name", "hitter"];
const EV_COLS = ["exitspeed", "exit speed", "exitvelo", "exit velocity", "launchspeed", "hitspeed"];
const ANGLE_COLS = ["angle", "launchangle", "launch angle", "hitangle"];

function parseCSV(text) {
  // simple CSV parser (handles quoted fields, no embedded newlines)
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const out = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  });
}

function findCol(headers, candidates) {
  const lower = headers.map((h) => h.toLowerCase().replace(/[^a-z ]/g, ""));
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
}

// Trackman names are usually "Last, First"; the league site uses "First Last"
function normalizeName(raw) {
  const m = raw.match(/^\s*([^,]+),\s*(.+)$/);
  return (m ? `${m[2]} ${m[1]}` : raw).replace(/\s+/g, " ").trim();
}

function main() {
  if (!fs.existsSync(inDir)) {
    console.log(`No ${inDir} folder found.`);
    console.log("Create a folder named 'trackman' next to package.json, drop Trackman CSV exports in it, and re-run.");
    process.exit(0);
  }
  const files = fs.readdirSync(inDir).filter((f) => f.toLowerCase().endsWith(".csv"));
  if (!files.length) {
    console.log(`No .csv files in ${inDir}. Drop Trackman exports there and re-run.`);
    process.exit(0);
  }

  const players = {}; // name -> { evs: [] }
  for (const file of files) {
    const rows = parseCSV(fs.readFileSync(path.join(inDir, file), "utf8"));
    if (rows.length < 2) continue;
    const headers = rows[0];
    const bCol = findCol(headers, BATTER_COLS);
    const evCol = findCol(headers, EV_COLS);
    if (bCol === -1 || evCol === -1) {
      console.warn(`${file}: couldn't find batter/exit-speed columns, skipped (headers: ${headers.slice(0, 8).join(", ")}...)`);
      continue;
    }
    let used = 0;
    for (const row of rows.slice(1)) {
      const name = normalizeName(row[bCol] || "");
      const ev = parseFloat(row[evCol]);
      if (!name || !Number.isFinite(ev) || ev < 20 || ev > 125) continue; // batted balls only
      (players[name] = players[name] || { evs: [] }).evs.push(ev);
      used++;
    }
    console.log(`${file}: ${used} batted balls`);
  }

  const out = {};
  for (const [name, p] of Object.entries(players)) {
    const n = p.evs.length;
    const avgEV = p.evs.reduce((a, b) => a + b, 0) / n;
    const hardHitPct = p.evs.filter((v) => v >= 95).length / n;
    out[name] = { n, avgEV: +avgEV.toFixed(1), hardHitPct: +hardHitPct.toFixed(3) };
  }

  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote docs/data/trackman.json with ${Object.keys(out).length} hitters`);
  console.log("Players with 25+ batted balls will get the contact-quality nudge in Props Lab.");
  console.log("Remember to commit and push the updated file so the live site sees it.");
}

main();
