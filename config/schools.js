// School prestige tiers for roster quality.
//
// Tiers describe the level of baseball a player faces in the spring:
//   1 = power-conference Division I / elite baseball programs
//   2 = all other Division I
//   3 = Division II and junior-college programs
//   4 = Division III / NAIA / small colleges
//   0 = unknown (blank or unrecognized; treated as league-average)
//
// The tier does NOT directly add or subtract value. The model measures how
// each tier's players actually hit and pitch in THIS league, and uses that
// tier average as the regression prior for small samples. If tiers turn out
// not to predict FCBL performance, their influence washes out automatically.

const ALIASES = {
  // -- big programs and their nicknames
  "uconn": "connecticut", "connecticut": "connecticut",
  "la tech": "louisiana tech", "louisiana tech": "louisiana tech",
  "umaine": "maine", "university of maine": "maine", "maine": "maine",
  "umass": "massachusetts", "massachusetts": "massachusetts",
  "uri": "rhode island", "urir": "rhode island",
  "gwu": "george washington",
  "shu": "sacred heart", "sacred heart": "sacred heart",
  "snhu": "southern nh", "southern nh": "southern nh",
  "st johns": "st johns", "st john's": "st johns",
  "mount saint mary's": "mount st marys", "mount st mary's": "mount st marys",
  "mount st mary's univ": "mount st marys",
  "st as": "saint anselm", "st anslem": "saint anselm", "saint anselm": "saint anselm",
  "salve": "salve regina", "salve regina": "salve regina",
  "wne": "western new england", "western new england": "western new england",
  "jwu": "johnson & wales", "johnson & wales": "johnson & wales",
  "ecsu": "eastern connecticut", "eastern ct state universit": "eastern connecticut",
  "eastern ct state universi": "eastern connecticut",
  "ccsu": "central connecticut", "central connecticut": "central connecticut",
  "scsu": "southern connecticut", "southern connecticut": "southern connecticut",
  "southern ct state": "southern connecticut",
  "uconn avery point": "avery point", "uconn ap": "avery point",
  "uconn-avery point": "avery point",
  "umass lowell": "umass lowell", "umass-lowell": "umass lowell",
  "umass boston": "umass boston", "umass-boston": "umass boston",
  "umass-dartmouth": "umass dartmouth",
  "univ of southern maine": "southern maine", "southern maine": "southern maine",
  "st joseph's pa": "saint josephs pa", "saint joseph's pa": "saint josephs pa",
  "st joseph's ct": "saint josephs ct", "st joseph's-ct": "saint josephs ct",
  "university of st joseph": "saint josephs ct", "usj": "saint josephs ct",
  "st joseph's-me": "saint josephs me", "saint joseph's-me": "saint josephs me",
  "saint joseph's": "saint josephs unknown",
  "brandies": "brandeis",
  "azuza pacific": "azusa pacific",
  "castleton state": "castleton", "castleton": "castleton",
  "wentworth it": "wentworth", "wentworth": "wentworth",
  "trinity tx": "trinity tx", "trinity": "trinity college",
  "usc": "southern california",
  "aic": "american international", "american international": "american international",
  "stevens institute of technolo": "stevens", "stevens": "stevens",
  "quinsigamond cc": "quinsigamond",
  "lsu eunice": "lsu eunice",
  "post": "post",
};

const TIERS = {
  // tier 1: power-conference D1 / elite baseball
  "boston college": 1, "virginia": 1, "kansas state": 1, "maryland": 1,
  "penn state": 1, "rutgers": 1, "northwestern": 1, "indiana": 1,
  "southern california": 1, "mississippi state": 1, "notre dame": 1,
  "coastal carolina": 1, "connecticut": 1, "louisiana tech": 1, "st johns": 1,

  // tier 2: other Division I
  "northeastern": 2, "maine": 2, "bryant": 2, "stony brook": 2, "monmouth": 2,
  "quinnipiac": 2, "fairfield": 2, "towson": 2, "hofstra": 2, "rider": 2,
  "lehigh": 2, "lafayette": 2, "columbia": 2, "harvard": 2, "brown": 2,
  "yale": 2, "princeton": 2, "cornell": 2, "high point": 2, "dayton": 2,
  "fordham": 2, "vcu": 2, "marist": 2, "binghamton": 2, "central connecticut": 2,
  "sacred heart": 2, "umass lowell": 2, "massachusetts": 2, "rhode island": 2,
  "holy cross": 2, "navy": 2, "utah valley": 2, "iona": 2, "siena": 2,
  "george washington": 2, "winthrop": 2, "usc upstate": 2,
  "college of charleston": 2, "james madison": 2, "bucknell": 2,
  "mount st marys": 2, "lasalle": 2, "william & mary": 2, "richmond": 2,
  "seton hall": 2, "pepperdine": 2, "elon": 2, "fairleigh dickinson": 2,
  "njit": 2, "stetson": 2, "alabama a&m": 2, "merrimack": 2, "stonehill": 2,
  "saint josephs pa": 2,

  // tier 3: Division II and junior colleges
  "saint anselm": 3, "assumption": 3, "bentley": 3, "franklin pierce": 3,
  "southern connecticut": 3, "new haven": 3, "american international": 3,
  "bridgeport": 3, "gannon": 3, "millersville": 3, "clarion": 3,
  "wheeling": 3, "montevallo": 3, "catawba": 3, "usc-aiken": 3, "usc aiken": 3,
  "cal poly pomona": 3, "azusa pacific": 3, "post": 3, "southern nh": 3,
  "lsu eunice": 3, "arizona western": 3, "orange coast": 3,
  "orange coast college": 3, "avery point": 3, "quinsigamond": 3,
  "saint michaels": 3, "saint josephs unknown": 3,

  // tier 4: Division III / NAIA / small colleges
  "colby": 4, "tufts": 4, "bates": 4, "bowdoin": 4, "middlebury": 4,
  "amherst": 4, "wesleyan": 4, "trinity college": 4, "trinity tx": 4,
  "babson": 4, "brandeis": 4, "clark": 4, "worcester state": 4,
  "westfield state": 4, "keene state": 4, "castleton": 4,
  "rhode island college": 4, "salve regina": 4, "roger williams": 4,
  "western new england": 4, "endicott": 4, "wheaton": 4, "nichols": 4,
  "lasell": 4, "fisher": 4, "johnson & wales": 4, "wentworth": 4,
  "springfield": 4, "hood": 4, "hobart": 4, "oberlin": 4, "swarthmore": 4,
  "union": 4, "stevens": 4, "arcadia": 4, "keystone": 4,
  "montclair state": 4, "montclair st": 4, "husson": 4, "suny maritime": 4,
  "southern maine": 4, "bard": 4, "nichols college": 4,
  "colby sawyer": 4, "bard": 4, "eastern connecticut": 4, "umass boston": 4,
  "umass dartmouth": 4, "saint josephs me": 4, "saint josephs ct": 4,
  "chapman": 4, "catholic": 4,
};

// normalize a raw roster string ("Bryant University", "Univ of Southern
// Maine", "St. Joseph's-ME") to a canonical key. Tries the full cleaned name
// FIRST (so "Boston College" is never stripped to "boston"), then falls back
// to progressively removing University/College suffixes.
export function normalizeSchool(raw) {
  if (!raw) return "";
  const base = raw.toLowerCase().trim()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .replace(/^university of /, "univ of ");
  const candidates = [base];
  let s = base.replace(/ (university|college|univ)$/i, "").trim();
  candidates.push(s);
  s = s.replace(/ (university|college|univ)$/i, "").trim();
  candidates.push(s);
  for (const c of candidates) {
    if (ALIASES[c]) return ALIASES[c];
    if (TIERS[c] !== undefined) return c;
    const noPrefix = c.replace(/^univ of /, "");
    if (ALIASES[noPrefix]) return ALIASES[noPrefix];
    if (TIERS[noPrefix] !== undefined) return noPrefix;
  }
  return candidates[candidates.length - 1];
}

// tier for a raw school string; 0 = unknown
export function schoolTier(raw) {
  const key = normalizeSchool(raw);
  return TIERS[key] ?? 0;
}
