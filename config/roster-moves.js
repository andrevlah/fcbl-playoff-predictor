// MANUAL ROSTER MOVES -- Andre, this is yours to edit.
//
// The roster snapshot (scripts/data/snapshot-*.txt) is pulled from the league
// site occasionally, but you'll usually KNOW about a departure or a signing
// before the site updates. List those here and the roster-quality numbers
// update the moment you save + push -- no scraping needed.
//
// Use each player's name as it appears on the roster (last name is enough if
// it's unique on that team). After editing, run `npm run rosters` (or just
// commit -- the next data update recomputes automatically).

// Players who have LEFT (drafted, went back to school, injured for the year).
// They stop counting toward their team's active roster immediately.
//   departed: [{ team: "WF", name: "Thomas Pirog" }, ...]
export const departed = [
  // 2026 MLB Draft (July 11-12). Both were already off the active roster
  // before the draft, so these are for the record -- no ratings effect.
  { team: "VT", name: "Kaiden McCarthy" }, // 2nd round; HS RHP, 2 June games then left for the combine
];

// Players who have RETURNED or newly SIGNED and belong on the active roster
// even if the last snapshot marked them Inactive.
//   returned: [{ team: "LOW", name: "Bradley McCafferty" }, ...]
export const returned = [];
