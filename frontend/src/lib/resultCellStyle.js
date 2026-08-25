// Shared presentation for a standings score cell in the PDF export.
// Kept free of any PDF/DOM dependency so the decision logic is unit-testable.
//
// Precedence (highest first):
//   1. Discarded result  -> grey italic text (whatever its code — DNC, DNS,
//      DNF, DSQ, RET, OOD/duty, a combined MINI day, …). Discard always wins.
//   2. Genuine finishing position 1st/2nd/3rd -> gold/silver/bronze fill.
//      Only a FINISHED result whose score is exactly 1, 2 or 3 qualifies:
//      tied-place splits (1.5), duty averages, manual DPI/RDG scores and
//      penalised SCP/ZFP places never do.
//   3. Non-finish scoring codes -> red text (existing penalty highlighting).

// Bold, unmistakable medal fills — rich enough to read as gold/silver/bronze
// at a glance while staying light enough that the dark result text (which is
// also emboldened) remains readable on screen, in print and in any PDF viewer.
export const PODIUM_FILLS = {
  1: [250, 199, 20], // gold
  2: [180, 195, 216], // silver
  3: [216, 132, 60], // bronze
};

export const PODIUM_TEXT = [28, 25, 16]; // near-black, keeps contrast on the fills

export const DISCARD_TEXT = [148, 163, 184]; // grey (matches the web table)
export const PENALTY_TEXT = [220, 38, 38]; // red

// Codes that flag a counting (non-discarded) cell in red. Mirrors the
// pre-existing PDF export behaviour exactly.
const PENALTY_RE = /\b(DNC|DNF|RET|DSQ|UFD|OCS|ZFP|BFD|DGM)\b/;

export const fmtScore = (s) => {
  if (!s) return "";
  const val = Number.isInteger(s.points) ? String(s.points) : s.points.toFixed(1);
  // MINI is the synthetic code for a combined mini-series day — the header
  // already names it, so just show the daily-average value.
  const showCode = s.code && s.code !== "FINISHED" && s.code !== "MINI";
  const label = showCode ? `${val} ${s.code}` : val;
  return s.discarded ? `(${label})` : label;
};

// The podium place of a standings score cell, or null when the cell is not a
// genuine 1st/2nd/3rd finishing position. Shared by the PDF export and the
// web standings tables so both render identically.
//
// Only a counting FINISHED result whose score is exactly 1, 2 or 3 qualifies:
// a discarded result (discard always wins), a tied-place split (1.5), a duty
// average, a manual DPI/RDG score, a combined MINI day or a penalised SCP/ZFP
// place never does.
export function podiumPlace(s) {
  if (!s || typeof s !== "object") return null;
  if (s.discarded) return null;
  if (s.code === "FINISHED" && (s.points === 1 || s.points === 2 || s.points === 3)) {
    return s.points;
  }
  return null;
}

// Decide how one race-result cell is styled. `s` is a standings score object
// ({points, code, discarded}) or a falsy/primitive value for empty or header
// cells. Returns {textColor, fontStyle, fillColor} with nulls meaning "no
// override" — safe to spread onto a cell's styles.
export function raceCellStyle(s) {
  const base = { textColor: null, fontStyle: null, fillColor: null };
  if (!s || typeof s !== "object") return base;
  // Discard takes priority over every other highlight — a discarded 1st/2nd/3rd
  // shows the discard style, never the podium fill.
  if (s.discarded) {
    return { ...base, textColor: DISCARD_TEXT, fontStyle: "italic" };
  }
  const place = podiumPlace(s);
  if (place) {
    // Bold the medal value too, so the highlight is obvious even in print.
    return { ...base, fillColor: PODIUM_FILLS[place], textColor: PODIUM_TEXT, fontStyle: "bold" };
  }
  if (PENALTY_RE.test(fmtScore(s))) {
    return { ...base, textColor: PENALTY_TEXT };
  }
  return base;
}
