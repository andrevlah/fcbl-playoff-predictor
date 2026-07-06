// Team config: the single source of truth for team identity, colors, and IDs.
// Shared by the browser (loaded directly) and the Node scraper (via config/teams.js).

// chart / chartDark: line-and-bar colors tuned separately for light and dark
// backgrounds (Nashua charts as near-black on white and near-white on dark;
// the navies get lifted so they stay legible).
export const TEAMS = {
  LOW: { name: "Lowell Spinners",       shortName: "Spinners",       teamId: "t5qjkc7rx8vjsu24", primary: "#C8102E", secondary: "#8DB9CA", chart: "#C8102E", chartDark: "#F04A5E" },
  NSH: { name: "Nashua Silver Knights", shortName: "Silver Knights", teamId: "j5erfjk6t2kb66yc", primary: "#1A1A1A", secondary: "#C8102E", chart: "#1A1A1A", chartDark: "#E6E6E6" },
  NB:  { name: "New Britain Bees",      shortName: "Bees",           teamId: "lwmmi7lzr16uegj9", primary: "#FDB913", secondary: "#101820", chart: "#E0A800", chartDark: "#FDB913" },
  NOR: { name: "Norwich Sea Unicorns",  shortName: "Sea Unicorns",   teamId: "h9yhw99erz9r8n9s", primary: "#0C2340", secondary: "#FFC72C", chart: "#0C2340", chartDark: "#6B93D6" },
  VT:  { name: "Vermont Lake Monsters", shortName: "Lake Monsters",  teamId: "dol7ec9h5ajz5i3t", primary: "#0B2E4F", secondary: "#84BD00", chart: "#84BD00", chartDark: "#9BD82A" },
  WF:  { name: "Westfield Starfires",   shortName: "Starfires",      teamId: "8zu7i09aj67rkv31", primary: "#003087", secondary: "#FFC72C", chart: "#3366CC", chartDark: "#6699F0" },
  WOR: { name: "Worcester Bravehearts", shortName: "Bravehearts",    teamId: "dz3zpsm7jzrzugyv", primary: "#13294B", secondary: "#007A33", chart: "#007A33", chartDark: "#2FBF71" },
};

export const ABBRS = Object.keys(TEAMS);

export function logoURL(abbr) {
  return `https://cdn.prestosports.com/action/cdn/logos/id/${TEAMS[abbr].teamId}.png`;
}

// Theme-aware chart color. Safe to import from Node (the scraper), where it
// simply always returns the light-mode color.
export function isDarkTheme() {
  if (typeof document === "undefined") return false;
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit === "dark";
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function chartColor(abbr) {
  return isDarkTheme() ? (TEAMS[abbr].chartDark || TEAMS[abbr].chart) : TEAMS[abbr].chart;
}

// ---------------------------------------------------------------------------
// MANUAL OVERRIDES: Andre, these two are yours to edit.
// ---------------------------------------------------------------------------

// Home-Run-Derby losses. The league awards 1 point for a loss decided by the
// derby, but the website does not mark derby games, so record them here by
// hand if one ever happens. Example: if Lowell loses a derby game, change to
//   export const derbyLossOverrides = { LOW: 1 };
export const derbyLossOverrides = {};

// Roster news shown next to the team-strength dials. Plain text, one note per
// line. Add / remove / edit freely, no code knowledge needed.
export const newsNotes = [
  "MLB Draft July 11-12: draft-eligible standouts may depart mid-July",
  "Nashua: Navy players Steed & Gopal depart ~end of June/July (military obligations)",
  "Westfield: 5 players in the June 30 Northeast Prospects Game, so scout attention means departure risk; top arm Thomas Pirog is the needle-mover",
];
