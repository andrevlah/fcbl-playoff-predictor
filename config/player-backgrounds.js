// PER-PLAYER BACKGROUND -- recruiting pedigree, class year, and draft status.
//
// This is the "who is this player, beyond his summer stats" layer. In a
// freshman-heavy developmental league most players have little or no college
// track record, so their BACKGROUND (how highly recruited, how far along, was
// he drafted) is real signal the box score can't yet show. It refines each
// player's regression prior:
//   - a highly-recruited freshman with a hot 60-AB sample is probably real
//   - a walk-on freshman with the same sample is probably running hot
//   - a senior is trusted more than a freshman with the identical line
//
// Keyed by "TEAM|Full Name" exactly as the name appears on the league roster.
// Every field is optional; a player with no entry falls back to the school
// tier prior (unchanged behavior), so this can be filled in incrementally --
// start with the players who get the most playing time, they move the ratings.
//
//   pedigree : 1-5. 5 = elite / drafted / top recruit, 3 = league-average
//              (the default, no effect), 1 = depth / project. Refines the
//              prior LEVEL on top of the school tier.
//   classYr  : "FR" | "SO" | "JR" | "SR". Sets how much the model trusts his
//              summer sample vs the prior (freshmen regressed harder).
//   drafted  : true, or a label like "2025 R14". Auto-sets pedigree to 5 when
//              pedigree is not given.
//   note     : free text -- why, and where the info came from.

export const backgrounds = {
  // --- seeded from research, Jul 2026 (highest-playing-time players first) ---
  // Lowell core
  "LOW|Zander Bratspis": { classYr: "FR", pedigree: 4, note: "Kansas State commit; Perfect Game national prospect; .378 HS senior yr (incoming FR)" },
  "LOW|Quincy Kerr": { classYr: "FR", pedigree: 4, note: "#1 ranked SS in MA; IMG Academy; Northeastern D1 commit (incoming FR)" },
  "LOW|Esteban Dessureault": { classYr: "FR", pedigree: 3, note: "Stetson D1; Team Canada Jr; 3-for-30 as a college FR (tiny sample)" },
  "LOW|Jordan Henriquez": { classYr: "FR", pedigree: 3, note: "Dayton D1 (A-10); redshirt FR, no college games yet; Lawrence Academy" },
  "LOW|Caden Smith": { classYr: "JR", pedigree: 3, note: "Saint Anselm D2 (NE10) junior LHP; strong college season; Lowell native" },
  "LOW|Ian Keusch": { classYr: "JR", pedigree: 3, note: "Brown (Ivy) junior RHP; 25.1 IP as a soph, modest college line" },
  // league standouts on other teams
  "NSH|Phoenix Williams": { classYr: "FR", pedigree: 4, note: "Mount St. Mary's D1 (MAAC) All-Rookie; .312 in 93 AB as a true FR" },
  "VT|Bryan Richman": { classYr: "JR", pedigree: 4, note: "Cal Poly Pomona D2 (CCAA) junior; All-SCC 1st Team, .353/.902 OPS" },
};

// class year -> multiplier on the regression prior weight. >1 = trust the
// summer sample LESS (heavier prior); <1 = trust it more. Unknown year = 1.0.
export const CLASS_YEAR_TRUST = {
  FR: 1.4,   // freshmen: lean on the prior, small/no track record
  SO: 1.1,
  JR: 0.9,
  SR: 0.75,  // seniors: their sample is more believable
};
