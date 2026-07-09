// Roster quality: how good is each team's CURRENT roster, player by player?
//
// The formula, in plain English:
//   1. Every hitter gets a wOBA-style rate (walks and extra bases weighted
//      properly), every pitcher a FIP-style rate (strikeouts, walks, homers;
//      defense-independent).
//   2. Small samples are regressed toward a prior. The prior starts as the
//      average of players from the same school tier (power D1 / other D1 /
//      D2-JuCo / D3), measured IN THIS LEAGUE, then is refined per player by
//      the BACKGROUND layer (config/player-backgrounds.js): recruiting
//      pedigree shifts the prior LEVEL, and class year scales how much the
//      summer sample is trusted vs the prior (freshmen regressed harder).
//      A highly-recruited freshman's hot 60-AB start is believed more than a
//      walk-on's; a senior's line is believed more than a freshman's. Players
//      with no background entry use the plain tier prior (unchanged). The tier
//      averages are calibrated from the league's own data, so if prestige
//      turns out not to predict FCBL performance, its influence shrinks
//      automatically.
//   3. Only ACTIVE players count (the roster page marks Inactive/Injured),
//      weighted by playing-time share. A team that lost its best arm to the
//      draft loses his innings from the rating immediately.
//   4. Hitting and pitching convert to runs per game above league average,
//      then to a win-percentage-scale index (RQI): .500 = average roster.
//
// Data: scripts/data/snapshot-*.txt (rosters + player stats pulled from the
// league site through a real browser; the site blocks automated fetches).

import { TEAMS, ABBRS } from "../../config/teams.js";
import { schoolTier } from "../../config/schools.js";
import { departed, returned } from "../../config/roster-moves.js";
import { backgrounds, CLASS_YEAR_TRUST } from "../../config/player-backgrounds.js";

// wOBA-style linear weights and priors
const W = { walk: 0.69, single: 0.88, double: 1.25, triple: 1.58, hr: 2.05 };
const HIT_PRIOR_PA = 60;    // regression prior per hitter
const PIT_PRIOR_IP = 25;    // regression prior per pitcher
const TIER_PRIOR_PA = 1000; // shrink applied to tier averages themselves
const TIER_PRIOR_IP = 250;
const RUNS_PER_WOBA = 1.15; // wOBA points -> runs, standard scale
const TEAM_PA_PER_GAME = 38; // this league scores a lot
const WPCT_PER_RUN = 0.09;  // pythagenpat slope at ~11.5 runs/game

// background layer: a pedigree point moves a player's PRIOR by this much
// (pedigree 3 = neutral, so unknown players are unchanged)
const PEDIGREE_WOBA = 0.010; // wOBA per pedigree point above/below 3
const PEDIGREE_FIP = 0.10;   // FIP-core per pedigree point (higher pedigree = lower core = better)

// resolve a player's background: explicit pedigree, else draft => 5, else
// neutral 3; plus class-year trust multiplier on the prior weight
export function backgroundFor(bg) {
  if (!bg) return { pedigree: 3, trust: 1 };
  const pedigree = bg.pedigree != null ? bg.pedigree : (bg.drafted ? 5 : 3);
  const trust = bg.classYr && CLASS_YEAR_TRUST[bg.classYr] ? CLASS_YEAR_TRUST[bg.classYr] : 1;
  return { pedigree, trust };
}

const num = (s) => {
  if (s === "-" || s === "" || s == null) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// "27.2" innings means 27 and 2/3
const parseIP = (s) => {
  const [whole, frac] = String(s).split(".");
  return num(whole) + (frac === "1" ? 1 / 3 : frac === "2" ? 2 / 3 : 0);
};

// match "P Williams" (stats) to "Phoenix Williams" (roster):
// first initial + all remaining name tokens, normalized
const nameKey = (name) => {
  const clean = name.replace(/[.'']/g, "").trim().toLowerCase();
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return clean;
  return parts[0][0] + "|" + parts.slice(1).join(" ");
};

const TEAM_BY_NAME = Object.fromEntries(
  Object.entries(TEAMS).map(([abbr, t]) => [t.name.toLowerCase(), abbr])
);

export function parseSnapshot(text) {
  const roster = [], hitters = [], pitchers = [];
  for (const line of text.split("\n")) {
    const p = line.trim().split("~");
    if (ABBRS.includes(p[0]) && p.length >= 5) {
      roster.push({ team: p[0], name: p[1], pos: p[2], status: p[3], school: p[4] });
    } else if (p[0] === "H" && p.length >= 11) {
      hitters.push({
        name: p[1], team: TEAM_BY_NAME[p[2].toLowerCase()] || p[2],
        gp: num(p[3]), ab: num(p[4]), h: num(p[5]), d2: num(p[6]), t3: num(p[7]),
        hr: num(p[8]), bb: num(p[9]), hbp: num(p[10]), so: num(p[11]),
      });
    } else if (p[0] === "P" && p.length >= 10) {
      pitchers.push({
        name: p[1], team: TEAM_BY_NAME[p[2].toLowerCase()] || p[2],
        app: num(p[3]), ip: parseIP(p[4]), h: num(p[5]), r: num(p[6]),
        er: num(p[7]), bb: num(p[8]), k: num(p[9]), hr: num(p[10]),
      });
    }
  }
  return { roster, hitters, pitchers };
}

export function computeRosterQuality(snapshotText) {
  const { roster, hitters, pitchers } = parseSnapshot(snapshotText);

  // roster lookup: (team, initial|lastname) -> { status, tier }. On the rare
  // same-team initial+lastname collision, prefer the Active entry: the player
  // producing current stats is more plausibly the one still on the roster.
  const byKey = new Map();
  for (const r of roster) {
    const key = r.team + "|" + nameKey(r.name);
    const existing = byKey.get(key);
    if (existing && /^active$/i.test(existing.status) && !/^active$/i.test(r.status)) continue;
    byKey.set(key, { status: r.status, tier: schoolTier(r.school) });
  }
  // manual overrides (config/roster-moves.js): Andre's front-office knowledge
  // beats the last snapshot's status. A departed player is forced inactive; a
  // returned player is forced active.
  const override = new Map();
  for (const m of departed) override.set(m.team + "|" + nameKey(m.name), "inactive");
  for (const m of returned) override.set(m.team + "|" + nameKey(m.name), "active");

  const lookup = (team, name) => {
    const info = byKey.get(team + "|" + nameKey(name));
    const ov = override.get(team + "|" + nameKey(name));
    if (!info) return ov ? { status: ov, tier: 0 } : undefined;
    if (ov) return { ...info, status: ov };
    return info;
  };

  // background layer keyed the same way (team|first-initial+lastname)
  const bgByKey = new Map();
  for (const [key, bg] of Object.entries(backgrounds)) {
    const [team, ...rest] = key.split("|");
    bgByKey.set(team + "|" + nameKey(rest.join("|")), bg);
  }
  const bgFor = (team, name) => backgroundFor(bgByKey.get(team + "|" + nameKey(name)));

  // ---- hitters ----
  const hs = hitters
    .map((h) => {
      const pa = h.ab + h.bb + h.hbp;
      if (pa < 10) return null;
      const singles = h.h - h.d2 - h.t3 - h.hr;
      const woba = (W.walk * (h.bb + h.hbp) + W.single * singles + W.double * h.d2 +
        W.triple * h.t3 + W.hr * h.hr) / pa;
      const info = lookup(h.team, h.name);
      const bg = bgFor(h.team, h.name);
      return {
        ...h, pa, woba,
        tier: info ? info.tier : 0,
        pedigree: bg.pedigree, trust: bg.trust,
        active: info ? /^active$/i.test(info.status) : true, // unmatched: assume active
        matched: !!info,
      };
    })
    .filter(Boolean);

  const lgPA = hs.reduce((s, h) => s + h.pa, 0);
  const lgWOBA = lgPA ? hs.reduce((s, h) => s + h.woba * h.pa, 0) / lgPA : 0.32;

  // empirical tier averages, shrunk toward league
  const hitTier = {};
  for (const t of [1, 2, 3, 4]) {
    const grp = hs.filter((h) => h.tier === t);
    const pa = grp.reduce((s, h) => s + h.pa, 0);
    const sum = grp.reduce((s, h) => s + h.woba * h.pa, 0);
    hitTier[t] = (sum + lgWOBA * TIER_PRIOR_PA) / (pa + TIER_PRIOR_PA);
  }
  hitTier[0] = lgWOBA;

  for (const h of hs) {
    // prior LEVEL shifts with pedigree; prior WEIGHT scales with class-year trust
    const prior = hitTier[h.tier] + (h.pedigree - 3) * PEDIGREE_WOBA;
    const w = HIT_PRIOR_PA * h.trust;
    h.est = (h.woba * h.pa + prior * w) / (h.pa + w);
  }

  // ---- pitchers ----
  const ps = pitchers
    .map((p) => {
      if (p.ip < 3) return null;
      const core = (13 * p.hr + 3 * p.bb - 2 * p.k) / p.ip; // FIP core, lower = better
      const info = lookup(p.team, p.name);
      const bg = bgFor(p.team, p.name);
      return {
        ...p, core,
        tier: info ? info.tier : 0,
        pedigree: bg.pedigree, trust: bg.trust,
        active: info ? /^active$/i.test(info.status) : true,
        matched: !!info,
      };
    })
    .filter(Boolean);

  const lgIP = ps.reduce((s, p) => s + p.ip, 0);
  const lgCore = lgIP ? ps.reduce((s, p) => s + p.core * p.ip, 0) / lgIP : 0;

  const pitTier = {};
  for (const t of [1, 2, 3, 4]) {
    const grp = ps.filter((p) => p.tier === t);
    const ip = grp.reduce((s, p) => s + p.ip, 0);
    const sum = grp.reduce((s, p) => s + p.core * p.ip, 0);
    pitTier[t] = (sum + lgCore * TIER_PRIOR_IP) / (ip + TIER_PRIOR_IP);
  }
  pitTier[0] = lgCore;

  for (const p of ps) {
    // higher pedigree -> lower (better) FIP prior; class-year trust scales weight
    const prior = pitTier[p.tier] - (p.pedigree - 3) * PEDIGREE_FIP;
    const w = PIT_PRIOR_IP * p.trust;
    p.est = (p.core * p.ip + prior * w) / (p.ip + w);
  }

  // ---- aggregate to teams -------------------------------------------------
  // Two views per team:
  //   FULL   = every player who logged stats (what the RESULTS already reflect)
  //   ACTIVE = only players still on the roster (what's available GOING FORWARD)
  // The FULL rating is ~collinear with run differential (they're the same
  // information decomposed to players), so feeding it to the model just
  // double-counts run diff. The orthogonal, results-independent signal is the
  // DIFFERENCE: rosterShift = how much better/worse the active roster is than
  // the one that produced the season's numbers. Intact team -> ~0. Lost its
  // ace -> negative. Only shed scrubs -> ~0 or positive.
  const runsFor = (hitters, pitchers) => {
    const paSum = hitters.reduce((s, h) => s + h.pa, 0);
    const ipSum = pitchers.reduce((s, p) => s + p.ip, 0);
    const wobA = paSum ? hitters.reduce((s, h) => s + h.est * h.pa, 0) / paSum : lgWOBA;
    const core = ipSum ? pitchers.reduce((s, p) => s + p.est * p.ip, 0) / ipSum : lgCore;
    return {
      dHit: ((wobA - lgWOBA) / RUNS_PER_WOBA) * TEAM_PA_PER_GAME,
      dPitch: lgCore - core,
      pa: paSum, ip: ipSum,
    };
  };

  const teams = {};
  for (const abbr of ABBRS) {
    const allTh = hs.filter((h) => h.team === abbr);
    const allTp = ps.filter((p) => p.team === abbr);
    const actTh = allTh.filter((h) => h.active);
    const actTp = allTp.filter((p) => p.active);

    const full = runsFor(allTh, allTp);
    const active = runsFor(actTh, actTp);

    // absolute roster level (for display/reference; correlates with run diff)
    const dHit = active.dHit, dPitch = active.dPitch;
    const rqi = Math.min(0.65, Math.max(0.35, 0.5 + WPCT_PER_RUN * (dHit + dPitch)));

    // the signal that actually feeds the model: talent-scale adjustment for
    // how the current roster differs from the one that earned the results
    const rosterShift = WPCT_PER_RUN *
      ((active.dHit - full.dHit) + (active.dPitch - full.dPitch));

    const paAll = full.pa || 1;
    const ipAll = full.ip || 1;
    const paSum = active.pa, ipSum = active.ip;

    teams[abbr] = {
      rqi: Math.round(rqi * 1000) / 1000,
      rosterShift: Math.round(rosterShift * 1000) / 1000,
      dHit: Math.round(dHit * 100) / 100,
      dPitch: Math.round(dPitch * 100) / 100,
      activePAShare: Math.round((paSum / paAll) * 100) / 100,
      activeIPShare: Math.round((ipSum / ipAll) * 100) / 100,
      hitters: actTh.length,
      pitchers: actTp.length,
    };
  }

  const matched = [...hs, ...ps].filter((x) => x.matched).length;
  const withBg = [...hs, ...ps].filter((x) => x.pedigree !== 3 || x.trust !== 1).length;
  return {
    teams,
    league: { woba: lgWOBA, fipCore: lgCore },
    tierCalibration: { hitting: hitTier, pitching: pitTier },
    matchRate: Math.round((matched / (hs.length + ps.length)) * 100) / 100,
    counts: { hitters: hs.length, pitchers: ps.length, roster: roster.length, backgrounds: Object.keys(backgrounds).length, playersWithBackground: withBg },
  };
}
