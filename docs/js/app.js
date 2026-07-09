// FCBL Playoff Predictor: main application.
// Loads the published data, renders everything, and re-simulates client-side
// (in a Web Worker running the identical engine) whenever a dial moves.

import { TEAMS, ABBRS, logoURL, newsNotes, chartColor, isDarkTheme } from "./teams.js";
import { DEFAULT_SETTINGS } from "./sim.js";
import { renderHistoryChart, renderLowellCurve, hideTip } from "./charts.js";

const $ = (id) => document.getElementById(id);

const state = {
  teams: [], schedule: [], results: [], history: [],
  serverOdds: null,   // official numbers from odds.json
  odds: null,         // what's currently displayed (server or what-if)
  prevShown: {},      // last displayed pcts, for count-up animation
  settings: {
    nSims: 10000,
    hfaGlobal: DEFAULT_SETTINGS.hfaGlobal,
    useTeamHFA: true,
    pythWeight: DEFAULT_SETTINGS.pythWeight,
    rosterChurn: DEFAULT_SETTINGS.rosterChurn,
    recencyWeight: DEFAULT_SETTINGS.recencyWeight,
    dials: {},
    forcedOutcomes: {},
    lowellForce: null,
  },
  sort: { key: "playoffPct", asc: false },
  oddsFormat: "pct", // "pct" | "american"
  historyMetric: "playoffPct",
  scenarioFilter: "LOW",
};

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------

const fmtPct = (p) => (p * 100 < 0.05 && p > 0 ? "<0.1%" : (p * 100).toFixed(1) + "%");

// American odds: negative for favorites (p >= 0.5), positive for underdogs.
// No thousands separators, sportsbook style (-3164, not -3,164). Simulated
// probabilities can land exactly at 0 or 1 with enough sims; those have no
// finite line, so show the conventional betting-market cap instead of
// dividing by zero.
const AMERICAN_CAP = 99900;
function toAmericanOdds(p) {
  if (p <= 0) return "+" + AMERICAN_CAP;
  if (p >= 1) return "-" + AMERICAN_CAP;
  if (p >= 0.5) {
    return String(Math.max(Math.round(-100 * (p / (1 - p))), -AMERICAN_CAP));
  }
  return "+" + Math.min(Math.round(100 * ((1 - p) / p)), AMERICAN_CAP);
}
const fmtAmerican = (p) => toAmericanOdds(p);
const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

function logoEl(abbr, cls = "team-logo") {
  const img = document.createElement("img");
  img.className = cls;
  img.src = logoURL(abbr);
  img.alt = "";
  img.loading = "lazy";
  img.onerror = () => {
    const fb = document.createElement("div");
    fb.className = "logo-fallback";
    fb.style.background = TEAMS[abbr].primary;
    fb.textContent = abbr;
    img.replaceWith(fb);
  };
  return img;
}

function animateNumber(el, from, to, fmt, ms = 650) {
  // hidden tabs pause requestAnimationFrame, so never leave the number blank
  el.textContent = fmt(from);
  if (document.hidden) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(from + (to - from) * ease(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function isOfficialSettings(s) {
  return s.hfaGlobal === DEFAULT_SETTINGS.hfaGlobal &&
    s.useTeamHFA === true &&
    s.pythWeight === DEFAULT_SETTINGS.pythWeight &&
    s.rosterChurn === DEFAULT_SETTINGS.rosterChurn &&
    s.recencyWeight === DEFAULT_SETTINGS.recencyWeight &&
    Object.values(s.dials).every((v) => !v) &&
    Object.keys(s.forcedOutcomes).length === 0 &&
    !s.lowellForce;
}

// ---------------------------------------------------------------------------
// odds table
// ---------------------------------------------------------------------------

function tableRows() {
  const leader = state.teams
    .map((t) => ({ t, pct: (2 * t.W + (t.derbyLosses || 0)) / (2 * t.GP) }))
    .sort((a, b) => b.pct - a.pct)[0].t;

  return state.teams.map((t) => {
    const o = state.odds.teams[t.abbr];
    return {
      abbr: t.abbr,
      name: TEAMS[t.abbr].name,
      record: `${t.W}-${t.L}`,
      streak: t.streak,
      ptsPct: (2 * t.W + (t.derbyLosses || 0)) / (2 * t.GP),
      gb: ((leader.W - t.W) + (t.L - leader.L)) / 2,
      runDiff: t.RS - t.RA,
      playoffPct: o.playoffPct,
      titlePct: o.titlePct,
      seed1: o.seedPct[0], seed2: o.seedPct[1], seed3: o.seedPct[2], seed4: o.seedPct[3],
      expWins: o.expWins, expLosses: o.expLosses,
      winsP10: o.winsP10, winsP90: o.winsP90,
    };
  });
}

function renderTable() {
  const tbody = $("odds-tbody");
  const rows = tableRows();
  const { key, asc } = state.sort;
  rows.sort((a, b) => {
    const va = a[key], vb = b[key];
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return asc ? cmp : -cmp;
  });

  document.querySelectorAll("#odds-table th").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.sort === key);
    th.classList.toggle("asc", th.dataset.sort === key && asc);
  });

  const whatIf = state.odds !== state.serverOdds;
  const prevHist = state.history.length > 1 ? state.history[state.history.length - 2] : null;

  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    if (r.abbr === "LOW") tr.className = "row-lowell";

    // team
    const tdTeam = document.createElement("td");
    const cell = document.createElement("div");
    cell.className = "team-cell";
    cell.appendChild(logoEl(r.abbr));
    const nm = document.createElement("div");
    nm.innerHTML = `<div class="team-name">${r.name}</div><div class="team-streak">${r.streak || ""}</div>`;
    cell.appendChild(nm);
    tdTeam.appendChild(cell);
    tr.appendChild(tdTeam);

    // record / pts% / GB
    tr.insertAdjacentHTML("beforeend", `<td class="num-cell">${r.record}</td>`);
    tr.insertAdjacentHTML("beforeend", `<td class="num-cell">${r.ptsPct.toFixed(3).replace(/^0/, "")}</td>`);
    tr.insertAdjacentHTML("beforeend", `<td class="num-cell">${r.gb === 0 ? "-" : r.gb}</td>`);
    tr.insertAdjacentHTML("beforeend",
      `<td class="num-cell ${r.runDiff > 0 ? "rd-pos" : r.runDiff < 0 ? "rd-neg" : ""}">${r.runDiff > 0 ? "+" : ""}${r.runDiff}</td>`);

    // big prob cells
    const fmt = state.oddsFormat === "american" ? fmtAmerican : fmtPct;
    for (const metric of ["playoffPct", "titlePct"]) {
      const td = document.createElement("td");
      td.className = "prob-cell";
      const num = document.createElement("span");
      num.className = "prob-num";
      const prevKey = r.abbr + metric;
      const from = state.prevShown[prevKey] ?? 0;
      animateNumber(num, from, r[metric], fmt);
      state.prevShown[prevKey] = r[metric];
      td.appendChild(num);

      if (whatIf) {
        const base = state.serverOdds.teams[r.abbr][metric];
        const d = r[metric] - base;
        if (Math.abs(d) >= 0.001) {
          const span = document.createElement("span");
          span.className = "prob-delta " + (d > 0 ? "up" : "down");
          span.textContent = (d > 0 ? "▲" : "▼") + Math.abs(d * 100).toFixed(1);
          td.appendChild(span);
        }
      }

      const track = document.createElement("div");
      track.className = "prob-bar-track";
      const bar = document.createElement("div");
      bar.className = "prob-bar";
      bar.style.background = chartColor(r.abbr);
      track.appendChild(bar);
      td.appendChild(track);
      requestAnimationFrame(() => { bar.style.width = (r[metric] * 100).toFixed(1) + "%"; });

      // hover: exact value in both formats + comparison to the previous official update
      const both = (p) => `${fmtPct(p)} (${fmtAmerican(p)})`;
      td.title = whatIf
        ? `${both(r[metric])} in this what-if, official: ${both(state.serverOdds.teams[r.abbr][metric])}`
        : prevHist
          ? `${both(r[metric])}, was ${both(prevHist.teams[r.abbr]?.[metric] ?? 0)} at the previous update`
          : both(r[metric]);
      tr.appendChild(td);
    }

    // seeds
    for (const s of ["seed1", "seed2", "seed3", "seed4"]) {
      tr.insertAdjacentHTML("beforeend", `<td class="seed-cell">${(r[s] * 100).toFixed(0)}%</td>`);
    }

    // projection
    const td = document.createElement("td");
    td.className = "num-cell";
    td.innerHTML = `${r.expWins.toFixed(1)}–${r.expLosses.toFixed(1)}
      <span class="proj-band">${r.winsP10}–${r.winsP90} win range</span>`;
    tr.appendChild(td);

    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------------------------
// Lowell panel
// ---------------------------------------------------------------------------

function renderLowell() {
  const low = state.teams.find((t) => t.abbr === "LOW");
  const o = state.odds.teams.LOW;
  const lw = state.odds.lowell;
  if (!low || !lw) return;

  $("lowell-summary").textContent =
    `${low.W}-${low.L} (${((2 * low.W + (low.derbyLosses || 0)) / (2 * low.GP)).toFixed(3).replace(/^0/, "")}), ` +
    `${low.gamesRemaining} games left · ${fmtPct(o.playoffPct)} to make the playoffs · ` +
    `${fmtPct(o.titlePct)} to win it all`;

  renderLowellCurve($("lowell-curve"), lw.oddsByFinalWins, low.W);

  // schedule with win-prob bars; flag the top-3 leverage games
  const list = $("lowell-schedule");
  list.innerHTML = "";
  const topLev = [...lw.gameProbs]
    .map((g, i) => ({ ...g, i }))
    .sort((a, b) => b.leverage - a.leverage)
    .slice(0, 3)
    .map((g) => g.i);

  lw.gameProbs.forEach((g, i) => {
    const div = document.createElement("div");
    div.className = "lgame" + (topLev.includes(i) ? " flagged" : "");
    const dateEl = document.createElement("div");
    dateEl.className = "lgame-date";
    dateEl.textContent = fmtDate(g.date);
    const oppEl = document.createElement("div");
    oppEl.className = "lgame-opp";
    oppEl.appendChild(logoEl(g.opp, "team-logo"));
    oppEl.insertAdjacentHTML("beforeend",
      `<span>${g.homeAway === "home" ? "vs" : "at"} ${TEAMS[g.opp].shortName}</span>
       <span class="ha">${g.homeAway === "home" ? "HOME" : "AWAY"}</span>
       ${topLev.includes(i) ? '<span class="lgame-flag" title="High-leverage game">⚑</span>' : ""}`);
    const probEl = document.createElement("div");
    probEl.className = "lgame-prob";
    probEl.innerHTML = `<div class="prob-bar-track"><div class="prob-bar" style="background:${chartColor("LOW")};width:${(g.winProb * 100).toFixed(0)}%"></div></div>
      <span class="pnum">${(g.winProb * 100).toFixed(0)}%</span>`;
    div.title = `Win probability ${(g.winProb * 100).toFixed(1)}%. Leverage: winning this game swings Lowell's playoff odds by about ${(g.leverage * 100).toFixed(1)} points.`;
    div.append(dateEl, oppEl, probEl);
    list.appendChild(div);
  });

  // one-line explanation of the biggest series
  const flagged = topLev.map((i) => lw.gameProbs[i]).sort((a, b) => b.leverage - a.leverage);
  if (flagged.length) {
    const f = flagged[0];
    const note = document.createElement("p");
    note.className = "biggest-note";
    note.textContent = `⚑ Biggest game left: ${fmtDate(f.date)} ${f.homeAway === "home" ? "vs" : "at"} ${TEAMS[f.opp].name}. Winning it swings Lowell's playoff odds by about ${(f.leverage * 100).toFixed(1)} percentage points.`;
    list.appendChild(note);
  }
}

// ---------------------------------------------------------------------------
// dials + scenario tool
// ---------------------------------------------------------------------------

function buildDials() {
  const wrap = $("team-dials");
  wrap.innerHTML = "";
  for (const abbr of ABBRS) {
    const row = document.createElement("div");
    row.className = "team-dial";
    const name = document.createElement("div");
    name.className = "td-name";
    name.appendChild(logoEl(abbr));
    name.insertAdjacentHTML("beforeend", `<span>${abbr}</span>`);
    const input = document.createElement("input");
    input.type = "range";
    input.min = -20; input.max = 20; input.step = 1; input.value = 0;
    input.dataset.abbr = abbr;
    const val = document.createElement("div");
    val.className = "td-val";
    val.textContent = "0%";
    input.addEventListener("input", () => {
      val.textContent = (input.value > 0 ? "+" : "") + input.value + "%";
      // slider % maps to a talent shift of half its size (±20% -> ±0.10)
      state.settings.dials[abbr] = (input.value / 100) * 0.5;
      queueSim();
    });
    row.append(name, input, val);
    wrap.appendChild(row);
  }

  const news = $("news-notes");
  news.innerHTML = `<p class="nn-label">Roster intel: why you might move these dials</p>` +
    newsNotes.map((n) => `<p>· ${n}</p>`).join("");
}

// today's calendar date in the league's timezone, for hiding games that have
// already been played from the "what-if" scenario list
function leagueToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function buildScenarioList() {
  const list = $("scenario-list");
  list.innerHTML = "";
  const filter = state.scenarioFilter;
  const today = leagueToday();
  let pastHidden = 0;

  state.schedule.forEach((g, i) => {
    if (filter !== "ALL" && g.home !== filter && g.away !== filter) return;
    // a scenario is a what-if about a game still to be played; once a game's
    // date has passed it has already happened, so drop it from the list
    // (its real result gets recorded via `npm run enter`)
    if (g.date < today) { pastHidden++; return; }
    const row = document.createElement("div");
    row.className = "sgame";
    row.innerHTML = `<div class="sgame-date">${fmtDate(g.date)}</div>
      <div>${TEAMS[g.away].shortName} at <b>${TEAMS[g.home].shortName}</b>
        ${g.note ? `<span class="sgame-note">${g.note}</span>` : ""}</div>`;
    const toggle = document.createElement("div");
    toggle.className = "outcome-toggle";
    const opts = [
      { key: "away", label: `${g.away} wins` },
      { key: null, label: "sim" },
      { key: "home", label: `${g.home} wins` },
    ];
    for (const opt of opts) {
      const b = document.createElement("button");
      b.textContent = opt.label;
      const isOn = () => (state.settings.forcedOutcomes[i] ?? null) === opt.key;
      b.classList.toggle("on", isOn());
      b.addEventListener("click", () => {
        if (opt.key === null) delete state.settings.forcedOutcomes[i];
        else state.settings.forcedOutcomes[i] = opt.key;
        buildScenarioList();
        queueSim();
      });
      toggle.appendChild(b);
    }
    row.appendChild(toggle);
    list.appendChild(row);
  });

  if (pastHidden > 0) {
    const note = document.createElement("div");
    note.className = "sgame-note";
    note.style.padding = "8px 10px";
    note.textContent = `${pastHidden} game${pastHidden > 1 ? "s have" : " has"} already been played and ` +
      `${pastHidden > 1 ? "are" : "is"} awaiting a final score (run "npm run enter" to record ${pastHidden > 1 ? "them" : "it"}).`;
    list.prepend(note);
  }
  if (!list.children.length) {
    list.innerHTML = `<div class="sgame-note" style="padding:8px 10px">No upcoming games to play with.</div>`;
  }
}

function wireControls() {
  $("hfa-slider").addEventListener("input", (e) => {
    state.settings.hfaGlobal = +e.target.value;
    $("hfa-val").textContent = "+" + (state.settings.hfaGlobal * 100).toFixed(1) + "%";
    queueSim();
  });

  $("team-hfa-toggle").addEventListener("change", (e) => {
    state.settings.useTeamHFA = e.target.checked;
    queueSim();
  });

  $("churn-slider").addEventListener("input", (e) => {
    state.settings.rosterChurn = +e.target.value;
    $("churn-val").textContent = "±" + Math.round(state.settings.rosterChurn * 100) + "%";
    queueSim();
  });

  $("pyth-slider").addEventListener("input", (e) => {
    state.settings.pythWeight = +e.target.value;
    $("pyth-val").textContent = Math.round(state.settings.pythWeight * 100) + "%";
    queueSim();
  });

  $("recency-slider").addEventListener("input", (e) => {
    state.settings.recencyWeight = +e.target.value;
    $("recency-val").textContent = Math.round(state.settings.recencyWeight * 100) + "%";
    queueSim();
  });

  $("sims-slider").addEventListener("input", (e) => {
    state.settings.nSims = +e.target.value;
    $("sims-val").textContent = state.settings.nSims.toLocaleString();
    queueSim();
  });

  const lowRemaining = state.schedule.filter((g) => g.home === "LOW" || g.away === "LOW").length;
  const lf = $("lowell-force-slider");
  lf.max = lowRemaining;
  lf.addEventListener("input", () => {
    const v = +lf.value;
    if (v < 0) {
      state.settings.lowellForce = null;
      $("lowell-force-val").textContent = "Off";
    } else {
      state.settings.lowellForce = { w: v };
      $("lowell-force-val").textContent = `${v}–${lowRemaining - v}`;
    }
    queueSim();
  });

  $("scenario-filter").addEventListener("change", (e) => {
    state.scenarioFilter = e.target.value;
    buildScenarioList();
  });

  $("clear-forced").addEventListener("click", () => {
    state.settings.forcedOutcomes = {};
    buildScenarioList();
    queueSim();
  });

  $("reset-official").addEventListener("click", resetToOfficial);

  const themeBtn = $("theme-toggle");
  const syncThemeButton = () => { themeBtn.textContent = isDarkTheme() ? "☀️" : "🌙"; };
  syncThemeButton();
  themeBtn.addEventListener("click", () => {
    const next = isDarkTheme() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("fcbl-theme", next); } catch { /* ignore */ }
    syncThemeButton();
    // charts and bars bake colors in at render time, so re-render everything
    updateAll();
    renderHistoryChart($("history-chart"), state.history, state.historyMetric);
  });

  document.querySelectorAll("#odds-table th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.asc = !state.sort.asc;
      else state.sort = { key, asc: key === "name" || key === "gb" };
      renderTable();
    });
  });

  $("history-metric").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-metric]");
    if (!btn) return;
    state.historyMetric = btn.dataset.metric;
    document.querySelectorAll("#history-metric .chip").forEach((c) =>
      c.classList.toggle("active", c === btn));
    renderHistoryChart($("history-chart"), state.history, state.historyMetric);
  });

  $("odds-format").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-format]");
    if (!btn) return;
    state.oddsFormat = btn.dataset.format;
    document.querySelectorAll("#odds-format .chip").forEach((c) =>
      c.classList.toggle("active", c === btn));
    // prevShown holds the raw probability (not a formatted string), so on a
    // pure format switch "from" equals "to" and animateNumber renders the
    // new format immediately with no count-up motion
    renderTable();
  });

  window.addEventListener("resize", debounce(() => {
    renderHistoryChart($("history-chart"), state.history, state.historyMetric);
    if (state.odds?.lowell) {
      const low = state.teams.find((t) => t.abbr === "LOW");
      renderLowellCurve($("lowell-curve"), state.odds.lowell.oddsByFinalWins, low.W);
    }
  }, 200));

  window.addEventListener("scroll", hideTip, { passive: true });
}

function resetToOfficial() {
  state.settings = {
    nSims: 10000,
    hfaGlobal: DEFAULT_SETTINGS.hfaGlobal,
    useTeamHFA: true,
    pythWeight: DEFAULT_SETTINGS.pythWeight,
    rosterChurn: DEFAULT_SETTINGS.rosterChurn,
    recencyWeight: DEFAULT_SETTINGS.recencyWeight,
    dials: {},
    forcedOutcomes: {},
    lowellForce: null,
  };
  $("hfa-slider").value = DEFAULT_SETTINGS.hfaGlobal;
  $("hfa-val").textContent = "+3.5%";
  $("team-hfa-toggle").checked = true;
  $("churn-slider").value = DEFAULT_SETTINGS.rosterChurn;
  $("churn-val").textContent = "±" + Math.round(DEFAULT_SETTINGS.rosterChurn * 100) + "%";
  $("pyth-slider").value = DEFAULT_SETTINGS.pythWeight;
  $("pyth-val").textContent = Math.round(DEFAULT_SETTINGS.pythWeight * 100) + "%";
  $("recency-slider").value = DEFAULT_SETTINGS.recencyWeight;
  $("recency-val").textContent = Math.round(DEFAULT_SETTINGS.recencyWeight * 100) + "%";
  $("sims-slider").value = 10000;
  $("sims-val").textContent = "10,000";
  $("lowell-force-slider").value = -1;
  $("lowell-force-val").textContent = "Off";
  document.querySelectorAll("#team-dials input").forEach((i) => {
    i.value = 0;
    i.parentElement.querySelector(".td-val").textContent = "0%";
  });
  buildScenarioList();
  state.odds = state.serverOdds;
  $("scenario-delta").hidden = true;
  updateAll();
}

// ---------------------------------------------------------------------------
// worker plumbing
// ---------------------------------------------------------------------------

const worker = new Worker("js/worker.js", { type: "module" });
let simId = 0;
let simTimer = null;

worker.onmessage = (e) => {
  const { id, out, error, ms } = e.data;
  if (id !== simId) return; // stale
  $("sim-status").classList.remove("working");
  if (error) {
    $("sim-status").textContent = "simulation error: " + error;
    return;
  }
  $("sim-status").textContent = `${out.nSims.toLocaleString()} seasons in ${ms}ms`;
  state.odds = out;
  updateAll();
  renderScenarioDelta();
};

function queueSim() {
  clearTimeout(simTimer);
  simTimer = setTimeout(runSim, 130);
}

function runSim() {
  if (isOfficialSettings(state.settings)) {
    state.odds = state.serverOdds;
    $("sim-status").textContent = "";
    $("scenario-delta").hidden = true;
    updateAll();
    return;
  }
  simId++;
  $("sim-status").classList.add("working");
  $("sim-status").textContent = "";
  worker.postMessage({
    id: simId,
    payload: {
      teams: state.teams,
      schedule: state.schedule,
      results: state.results,
      settings: { ...state.settings, seed: 1234567 },
    },
  });
}

function renderScenarioDelta() {
  const el = $("scenario-delta");
  const active = state.settings.lowellForce || Object.keys(state.settings.forcedOutcomes).length;
  if (!active || state.odds === state.serverOdds) { el.hidden = true; return; }
  const before = state.serverOdds.teams.LOW.playoffPct;
  const after = state.odds.teams.LOW.playoffPct;
  const arrow = after >= before ? "▲" : "▼";
  el.hidden = false;
  const bothActive = state.settings.lowellForce && Object.keys(state.settings.forcedOutcomes).length;
  el.innerHTML = `In this scenario, Lowell's playoff odds go
    <b>${fmtPct(before)}</b> → <b>${fmtPct(after)}</b>
    <span class="prob-delta ${after >= before ? "up" : "down"}">${arrow} ${Math.abs((after - before) * 100).toFixed(1)} pts</span>
    ${bothActive ? '<br><span class="mini-note">The record slider is Lowell\'s TOTAL rest-of-way record; wins you forced on specific games count toward it.</span>' : ""}`;
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function updateAll() {
  const whatIf = state.odds !== state.serverOdds;
  $("whatif-banner").hidden = !whatIf;
  renderTable();
  renderLowell();
}

async function load(name) {
  const res = await fetch(`data/${name}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`failed to load ${name}`);
  return res.json();
}

async function init() {
  const [teams, schedule, results, odds, history] = await Promise.all([
    load("teams.json"), load("schedule.json"), load("results.json"),
    load("odds.json"), load("history.json"),
  ]);
  Object.assign(state, { teams, schedule, results, history });
  state.serverOdds = odds;
  state.odds = odds;

  // header
  const asOf = new Date(odds.asOf);
  $("as-of").textContent = asOf.toLocaleString("en-US", {
    month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York", timeZoneName: "short",
  });
  $("games-completed").textContent = odds.gamesCompleted;
  $("n-sims").textContent = odds.nSims.toLocaleString();
  $("lowell-logo").src = logoURL("LOW");
  $("lowell-logo").onerror = () => { $("lowell-logo").style.display = "none"; };

  buildDials();
  buildScenarioList();
  wireControls();
  updateAll();
  renderHistoryChart($("history-chart"), state.history, state.historyMetric);
}

init().catch((err) => {
  document.querySelector("main").insertAdjacentHTML("afterbegin",
    `<div class="whatif-banner"><span>⚠️ Couldn't load the data files (${err.message}).
     If you just deployed, run the "Update FCBL data" workflow once from the Actions tab, then refresh.</span></div>`);
  console.error(err);
});
