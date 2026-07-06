// Verified snapshot of the 2026 FCBL season as of July 5, 2026.
// Used to generate the initial docs/data/ files so the site works before its
// first live scrape. One game (Norwich at Vermont, Jul 5) was in progress at
// snapshot time and is deliberately excluded from BOTH records and the
// remaining schedule — the first scrape reconciles it automatically.

export const SEED_AS_OF = "2026-07-05T12:00:00-04:00";

export const SEED_TEAMS = [
  { abbr: "VT",  W: 22, L: 10, GP: 32, homeW: 13, homeL: 4,  awayW: 9,  awayL: 6,  RS: 214, RA: 180, streak: "W4", derbyLosses: 0, gamesRemaining: 27 },
  { abbr: "WOR", W: 19, L: 15, GP: 34, homeW: 10, homeL: 8,  awayW: 9,  awayL: 7,  RS: 243, RA: 193, streak: "W1", derbyLosses: 0, gamesRemaining: 26 },
  { abbr: "NB",  W: 18, L: 14, GP: 32, homeW: 7,  homeL: 9,  awayW: 11, awayL: 5,  RS: 162, RA: 160, streak: "L1", derbyLosses: 0, gamesRemaining: 28 },
  { abbr: "NSH", W: 16, L: 16, GP: 32, homeW: 10, homeL: 6,  awayW: 6,  awayL: 10, RS: 200, RA: 151, streak: "W1", derbyLosses: 0, gamesRemaining: 28 },
  { abbr: "NOR", W: 14, L: 18, GP: 32, homeW: 5,  homeL: 8,  awayW: 9,  awayL: 10, RS: 171, RA: 194, streak: "L1", derbyLosses: 0, gamesRemaining: 27 },
  { abbr: "WF",  W: 13, L: 20, GP: 33, homeW: 7,  homeL: 13, awayW: 6,  awayL: 7,  RS: 168, RA: 218, streak: "L1", derbyLosses: 0, gamesRemaining: 27 },
  { abbr: "LOW", W: 13, L: 22, GP: 35, homeW: 8,  homeL: 7,  awayW: 5,  awayL: 15, RS: 177, RA: 239, streak: "W1", derbyLosses: 0, gamesRemaining: 25 },
];

// 94 remaining games, deduplicated. dh = doubleheader game number.
export const SEED_SCHEDULE = [
  { d: "2026-07-06", h: "NSH", a: "LOW" }, { d: "2026-07-06", h: "WF",  a: "NB" },  { d: "2026-07-06", h: "VT",  a: "NOR" },
  { d: "2026-07-07", h: "LOW", a: "NB" },  { d: "2026-07-07", h: "NSH", a: "VT" },  { d: "2026-07-07", h: "WF",  a: "WOR" },
  { d: "2026-07-08", h: "LOW", a: "WOR" }, { d: "2026-07-08", h: "NSH", a: "VT" },  { d: "2026-07-08", h: "NOR", a: "WF" },
  { d: "2026-07-09", h: "LOW", a: "NB" },  { d: "2026-07-09", h: "NOR", a: "WOR", dh: 1 }, { d: "2026-07-09", h: "NOR", a: "WOR", dh: 2 },
  { d: "2026-07-10", h: "NSH", a: "NB" },  { d: "2026-07-10", h: "WOR", a: "NOR" }, { d: "2026-07-10", h: "VT",  a: "WF" },
  { d: "2026-07-11", h: "LOW", a: "NSH" }, { d: "2026-07-11", h: "NB",  a: "WOR" }, { d: "2026-07-11", h: "VT",  a: "WF" },
  { d: "2026-07-12", h: "LOW", a: "NOR" }, { d: "2026-07-12", h: "NSH", a: "NB" },  { d: "2026-07-12", h: "VT",  a: "WF" },
  { d: "2026-07-13", h: "NOR", a: "LOW" }, { d: "2026-07-13", h: "NB",  a: "VT" },  { d: "2026-07-13", h: "WOR", a: "WF" },
  { d: "2026-07-14", h: "LOW", a: "WF" },  { d: "2026-07-14", h: "NOR", a: "NSH" }, { d: "2026-07-14", h: "NB",  a: "VT" },
  { d: "2026-07-15", h: "LOW", a: "NOR" }, { d: "2026-07-15", h: "NSH", a: "WOR" }, { d: "2026-07-15", h: "WF",  a: "VT" },
  { d: "2026-07-16", h: "NB",  a: "NSH" }, { d: "2026-07-16", h: "NOR", a: "VT" },  { d: "2026-07-16", h: "WOR", a: "WF" },
  { d: "2026-07-17", h: "NB",  a: "LOW" }, { d: "2026-07-17", h: "NSH", a: "WOR" }, { d: "2026-07-17", h: "NOR", a: "VT" },
  { d: "2026-07-18", h: "NOR", a: "LOW" }, { d: "2026-07-18", h: "NSH", a: "WF" },  { d: "2026-07-18", h: "NB",  a: "WOR" },
  { d: "2026-07-19", h: "VT",  a: "NSH", dh: 1 }, { d: "2026-07-19", h: "VT", a: "NSH", dh: 2 }, { d: "2026-07-19", h: "WOR", a: "NB" }, { d: "2026-07-19", h: "NOR", a: "WF" },
  { d: "2026-07-23", h: "LOW", a: "VT" },  { d: "2026-07-23", h: "NB",  a: "NSH" }, { d: "2026-07-23", h: "WOR", a: "WF" },
  { d: "2026-07-24", h: "NB",  a: "LOW" }, { d: "2026-07-24", h: "NOR", a: "NSH" }, { d: "2026-07-24", h: "WOR", a: "VT" },
  { d: "2026-07-25", h: "NOR", a: "NB" },  { d: "2026-07-25", h: "WF",  a: "NSH" }, { d: "2026-07-25", h: "WOR", a: "VT" },
  { d: "2026-07-26", h: "NOR", a: "LOW" }, { d: "2026-07-26", h: "WOR", a: "NSH" }, { d: "2026-07-26", h: "NB", a: "WF", dh: 1 }, { d: "2026-07-26", h: "NB", a: "WF", dh: 2 },
  { d: "2026-07-27", h: "LOW", a: "WOR" }, { d: "2026-07-27", h: "NB",  a: "NSH" }, { d: "2026-07-27", h: "VT",  a: "WF" },
  { d: "2026-07-28", h: "LOW", a: "NOR" }, { d: "2026-07-28", h: "WOR", a: "NB" },  { d: "2026-07-28", h: "VT",  a: "WF" },
  { d: "2026-07-29", h: "LOW", a: "NSH" }, { d: "2026-07-29", h: "VT",  a: "NB" },  { d: "2026-07-29", h: "NOR", a: "WF" },
  { d: "2026-07-30", h: "NSH", a: "NOR" }, { d: "2026-07-30", h: "VT",  a: "NB" },  { d: "2026-07-30", h: "WOR", a: "WF" },
  { d: "2026-07-31", h: "LOW", a: "NB" },  { d: "2026-07-31", h: "WF",  a: "NSH" }, { d: "2026-07-31", h: "NOR", a: "WOR" },
  { d: "2026-08-01", h: "LOW", a: "WF" },  { d: "2026-08-01", h: "NSH", a: "VT" },  { d: "2026-08-01", h: "NB",  a: "NOR" },
  { d: "2026-08-02", h: "VT",  a: "LOW" }, { d: "2026-08-02", h: "NSH", a: "WF" },  { d: "2026-08-02", h: "NB",  a: "WOR" },
  { d: "2026-08-03", h: "VT",  a: "LOW" }, { d: "2026-08-03", h: "NSH", a: "NOR" }, { d: "2026-08-03", h: "WOR", a: "WF" },
  { d: "2026-08-04", h: "VT",  a: "LOW" }, { d: "2026-08-04", h: "NOR", a: "NB" },
  { d: "2026-08-05", h: "LOW", a: "WOR" }, { d: "2026-08-05", h: "NB",  a: "NSH" }, { d: "2026-08-05", h: "NOR", a: "WF" },
  { d: "2026-08-06", h: "NSH", a: "WF" },  { d: "2026-08-06", h: "NOR", a: "NB" },  { d: "2026-08-06", h: "VT",  a: "WOR" },
  { d: "2026-08-07", h: "LOW", a: "NB" },  { d: "2026-08-07", h: "NSH", a: "NOR" }, { d: "2026-08-07", h: "VT",  a: "WOR" },
  { d: "2026-08-08", h: "WOR", a: "LOW" }, { d: "2026-08-08", h: "VT",  a: "NSH" }, { d: "2026-08-08", h: "WF",  a: "NOR" },
];
