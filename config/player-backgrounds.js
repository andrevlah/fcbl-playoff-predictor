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
  // --- Lowell (its league page has no class year, so set it here) ---
  "LOW|Zander Bratspis": { classYr: "FR", pedigree: 4, note: "Kansas State commit; Perfect Game national prospect; .378 HS senior yr (incoming FR)" },
  "LOW|Quincy Kerr": { classYr: "FR", pedigree: 4, note: "#1 ranked SS in MA; IMG Academy; Northeastern D1 commit (incoming FR)" },
  "LOW|Lorenzo Camilleri": { classYr: "FR", pedigree: 4, note: "NJIT D1 (America East) All-Rookie Team; 6 HR as a true FR" },
  "LOW|Esteban Dessureault": { classYr: "FR", pedigree: 3, note: "Stetson D1; Team Canada Jr; 3-for-30 as a college FR (tiny sample)" },
  "LOW|Jordan Henriquez": { classYr: "FR", pedigree: 3, note: "Dayton D1 (A-10); redshirt FR, no college games yet; Lawrence Academy" },
  "LOW|Hayden Schimoler": { classYr: "FR", pedigree: 3, note: "Maine D1 two-way FR; Exeter prep; rough summer on the mound" },
  "LOW|Chris Klueber": { classYr: "FR", pedigree: 3, note: "UMass Lowell D1 FR RHP; Tabor Academy prep" },
  "LOW|Quinn Murphy": { classYr: "SO", pedigree: 3, note: "Maine D1 (America East) sophomore OF; .229 as a FR" },
  "LOW|Caden Smith": { classYr: "JR", pedigree: 3, note: "Saint Anselm D2 (NE10) junior LHP; strong college season; Lowell native" },
  "LOW|Ian Keusch": { classYr: "JR", pedigree: 3, note: "Brown (Ivy) junior RHP; 25.1 IP as a soph, modest college line" },

  // --- pedigree overrides for notable players on other teams ---
  // (class year for these comes from the bulk file; only pedigree set here)
  "NB|George Slauson": { pedigree: 5, note: "D2 3rd-Team All-American + NE10 Player of the Year at Saint Anselm; transferring to UConn; 6th nationally in BA" },
  "VT|Jack Fitzgerald": { pedigree: 5, note: "Montevallo D2 (Gulf South) ABCA All-America 2nd Team; .317, 14 HR, 1.006 OPS" },
  "NSH|Connor Smith": { pedigree: 4, note: "Gannon D2 (PSAC); two-time All-PSAC West; redshirt junior" },
  "NSH|Nate Kearney": { pedigree: 4, note: "Stonehill D1 (NEC) junior 1B; preseason Perfect Game honoree, .351" },
  "NSH|Malcolm Klingler": { pedigree: 4, note: "Northeastern D1 signee (incoming); Loomis Chaffee prep RHP" },
  "NSH|Phoenix Williams": { pedigree: 4, note: "Mount St. Mary's D1 (MAAC) All-Rookie; .312 in 93 AB" },
  "NOR|Mike Fiatarone": { pedigree: 4, note: "Bryant D1 (America East); Salisbury School prep standout; NOR's leading hitter" },
  "NOR|TJ Baer": { pedigree: 4, note: "Marist D1 (MAAC); 2025 GametimeCT First-Team All-State" },
  "VT|Bryan Richman": { pedigree: 4, note: "Cal Poly Pomona D2 (CCAA); All-SCC 1st Team, .353/.902 OPS" },
  "VT|Patrick Shrake": { pedigree: 4, note: "Colby D3 (NESCAC); two-time All-NESCAC First Team SS" },
  "VT|Elias Huber": { pedigree: 4, note: "Arizona Western (JuCo); ACCAC Player of the Week; Germany U23 national team" },
  "WF|Easton Sanders": { pedigree: 4, note: "Louisiana Tech D1 (CUSA); first-team all-state prep, .394 recruit" },
};

// class year -> multiplier on the regression prior weight. >1 = trust the
// summer sample LESS (heavier prior); <1 = trust it more. Unknown year = 1.0.
export const CLASS_YEAR_TRUST = {
  FR: 1.4,   // freshmen: lean on the prior, small/no track record
  SO: 1.1,
  JR: 0.9,
  SR: 0.75,  // seniors: their sample is more believable
};
