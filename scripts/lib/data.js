// Pure data-shaping helpers (no network, no HTML), unit tested directly.

// Canonical identity for one physical game. `seq` disambiguates doubleheader
// games that share date/teams/time (numbered by row order on the source page,
// which is identical on both teams' pages).
export function gameKey(g) {
  return [g.date, g.home, g.away, g.time || "TBD", g.seq || 1].join("|");
}

// Assign seq numbers to games that share (date, home, away, time) within ONE
// team's parsed page, so doubleheaders survive deduplication even with TBD
// or identical listed times.
export function assignSeq(games) {
  const counts = new Map();
  return games.map((g) => {
    const k = [g.date, g.home, g.away, g.time || "TBD"].join("|");
    const seq = (counts.get(k) || 0) + 1;
    counts.set(k, seq);
    return { ...g, seq };
  });
}

// Union of all teams' schedule pages -> each game appears twice (once per
// team). Dedupe by (date, home, away, time, seq); prefer entries that carry a
// gameId. Games with a gameId dedupe by gameId directly.
export function dedupeSchedule(allGames) {
  const byKey = new Map();
  for (const g of allGames) {
    const k = g.gameId || gameKey(g);
    const existing = byKey.get(k);
    if (!existing || (g.gameId && !existing.gameId)) byKey.set(k, g);
  }
  return [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "") || (a.seq || 1) - (b.seq || 1)
  );
}

// Dedupe completed games (each appears on both teams' pages). gameId is the
// primary key when present.
export function dedupeResults(allResults) {
  const byKey = new Map();
  for (const r of allResults) {
    const k = r.gameId || gameKey(r);
    if (!byKey.has(k)) byKey.set(k, r);
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// A game is "newly final" if it's in the fresh results but not the previous
// results.json. This is what gates history.json appends.
export function detectNewlyFinal(prevResults, freshResults) {
  const prevKeys = new Set(prevResults.map((r) => r.gameId || gameKey(r)));
  return freshResults.filter((r) => !prevKeys.has(r.gameId || gameKey(r)));
}

// Validation gate. Throws on hard failures (never publish bad data); returns
// a list of loud warnings for soft anomalies.
export function validate(teams, results, schedule) {
  const warnings = [];
  let totalW = 0, totalL = 0;

  for (const t of teams) {
    const wins = results.filter((r) => r.winner === t.abbr).length;
    const losses = results.filter(
      (r) => (r.home === t.abbr || r.away === t.abbr) && r.winner !== t.abbr
    ).length;
    if (wins !== t.W || losses !== t.L) {
      throw new Error(
        `${t.abbr}: parsed game results give ${wins}-${losses} but the schedule page's Overall line says ${t.W}-${t.L}. Refusing to publish.`
      );
    }
    if (t.W + t.L !== t.GP) {
      throw new Error(`${t.abbr}: W+L (${t.W + t.L}) != GP (${t.GP}). Refusing to publish.`);
    }
    const remaining = schedule.filter((g) => g.home === t.abbr || g.away === t.abbr).length;
    if (t.GP + remaining !== 60) {
      warnings.push(
        `${t.abbr}: GP (${t.GP}) + remaining (${remaining}) = ${t.GP + remaining}, not 60. ` +
          `OK only if the league cancelled games; check the schedule page.`
      );
    }
    totalW += t.W;
    totalL += t.L;
  }

  if (totalW !== totalL) {
    throw new Error(`League total wins (${totalW}) != total losses (${totalL}). Refusing to publish.`);
  }
  return warnings;
}
