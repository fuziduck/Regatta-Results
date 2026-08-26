export function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  } catch {
    return "—";
  }
}

export function fmtDate(dstr) {
  if (!dstr) return "";
  try {
    return new Date(dstr + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dstr;
  }
}

export function fmtDateShort(dstr) {
  if (!dstr) return "";
  try {
    return new Date(dstr + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return dstr;
  }
}

export function fmtClock(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function fmtElapsed(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  const neg = ms < 0;
  let total = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  total %= 3600;
  const m = Math.floor(total / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const body = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return neg ? `−${body}` : body;
}

// Best known race start instant (mirrors the backend _race_start_time):
// the start gun, else the scheduled class start on the race date.
export function raceStart(race) {
  if (!race) return null;
  if (race.actual_start) return race.actual_start;
  if (race.date && race.start_time) {
    // Scheduled start is timezone-less club time. Finish times are captured
    // from the officer's device as UTC, so anchor the scheduled start to the
    // device's UTC offset (captured at race creation) to keep the elapsed
    // math consistent. Falls back to UTC when no offset was recorded.
    const off = race.start_tz_offset_minutes;
    if (off != null) {
      const sign = off >= 0 ? "+" : "-";
      const m = Math.abs(off);
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      return `${race.date}T${race.start_time}:00${sign}${hh}:${mm}`;
    }
    return `${race.date}T${race.start_time}:00Z`;
  }
  return null;
}

// Whole-second elapsed time of a recorded finish vs the race start (null if
// either is missing). Used to prefill the editable elapsed-time input.
export function elapsedSecondsOf(finishTime, race) {
  const start = raceStart(race);
  if (!finishTime || !start) return null;
  const e = Date.parse(finishTime) - Date.parse(start);
  return Number.isFinite(e) && e >= 0 ? Math.round(e / 1000) : null;
}

// Corrected time in seconds for a handicap class — mirrors the backend
// _corrected_time_sec / _py_corrected_sec. "irc": elapsed x TCC; "py"
// (Portsmouth Yardstick): elapsed x 1000 / PY. Both rounded to the nearest
// second, 0.5 up. Returns null when the elapsed time or rating is missing.
export function correctedSecondsOf(finishTime, race, rating, mode = "irc") {
  // Use the exact elapsed (not the whole-second-rounded display value) so the
  // corrected time matches the backend's official calculation — e.g. two
  // finishes 0.6s apart can score different corrected times.
  const start = raceStart(race);
  if (!finishTime || !start || !rating) return null;
  const e = Date.parse(finishTime) - Date.parse(start);
  if (!Number.isFinite(e) || e < 0) return null;
  const el = e / 1000;
  if (mode === "py") return Math.round((el * 1000) / rating);
  return Math.round(el * rating);
}

// Format whole seconds as H:MM:SS (or MM:SS under an hour).
export function fmtSeconds(total) {
  if (total == null || Number.isNaN(total)) return "—";
  const neg = total < 0;
  let t = Math.round(Math.abs(total));
  const h = Math.floor(t / 3600);
  t %= 3600;
  const m = Math.floor(t / 60);
  const s = t % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return neg ? `−${body}` : body;
}

const DARK = "dark:bg-white/10 dark:text-red-300 dark:border-red-500/40";

export const CODE_COLORS = {
  FINISHED: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40",
  DNC: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/40",
  DNS: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40",
  DNF: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/40",
  OCS: `bg-red-100 text-red-800 border-red-300 ${DARK}`,
  UFD: `bg-red-100 text-red-800 border-red-300 ${DARK}`,
  BFD: `bg-red-100 text-red-800 border-red-300 ${DARK}`,
  ZFP: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-500/15 dark:text-fuchsia-300 dark:border-fuchsia-500/40",
  SCP: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-500/15 dark:text-fuchsia-300 dark:border-fuchsia-500/40",
  NSC: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/40",
  RET: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/40",
  DSQ: `bg-red-100 text-red-800 border-red-300 ${DARK}`,
  DNE: "bg-red-200 text-red-900 border-red-400 dark:bg-red-500/25 dark:text-red-300 dark:border-red-500/60",
  DPI: `bg-red-100 text-red-800 border-red-300 ${DARK}`,
  RDG: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/40",
  OOD: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/40",
};

export const CURRENT_YEAR = new Date().getFullYear();

// Boat-name wrapping threshold for results tables. Names longer than this
// many characters wrap onto a second line at a space so a long name cannot
// widen the whole results table (mirroring how the helm line wraps naturally
// — the boat name simply stops forcing a single unbroken line). The threshold
// is the NAME's character count, not its rendered pixel width, so it is
// decided in code here and only the wrapping/width classes are applied via
// CSS. Exactly at the limit the name still shows on one line.
export const BOAT_NAME_WRAP_LIMIT = 14;
export const shouldWrapBoatName = (name) =>
  typeof name === "string" && name.length > BOAT_NAME_WRAP_LIMIT;

// The display form of a boat name in results tables. Names over the limit
// break onto a second line at the last space inside the first 14 characters
// (e.g. "The Flying Fish" → "The Flying\nFish"), so the wrap is decided by
// the name's character count, not by the rendered pixel width. Names without
// a suitable space (a single word longer than the limit) are returned
// unchanged and rely on the cell's overflow-wrap instead, so a long unbroken
// word is only ever broken when it would otherwise overflow the column.
// Render the result with whitespace-pre-line for the newline to take effect.
export function wrapBoatName(name) {
  if (!shouldWrapBoatName(name)) return name;
  const head = name.slice(0, BOAT_NAME_WRAP_LIMIT);
  const space = head.lastIndexOf(" ");
  if (space <= 0) return name; // no usable space — leave natural wrapping
  return `${name.slice(0, space)}\n${name.slice(space + 1)}`;
}

// Passcode policy hint — mirrors the backend validate_password_policy().
export const PASSCODE_HINT =
  "At least 6 characters, with at least one number and one special character (e.g. sail1!).";

// Returns an error message when the passcode fails the policy, else null.
export function passcodeError(p) {
  if (!p || p.length < 6) return "Passcode must be at least 6 characters";
  if (!/\d/.test(p)) return "Passcode must contain at least one number";
  if (!/[^A-Za-z0-9\s]/.test(p)) return "Passcode must contain at least one special character";
  return null;
}

// The furthest season ahead that can be set up and viewed (year buttons and
// the ?year= URL param both stop here). Generous horizon — future years are
// data-driven (only years with a series actually appear), so this is just a
// guard against junk values, not a hard limit on planning ahead.
export const MAX_YEAR = CURRENT_YEAR + 10;

// Returns the mini-series group (from a series' mini_series_groups) that
// contains the given race number, or null when the race is not part of any
// mini series. A series only has groups when its mini_series flag is on; each
// race number may belong to at most one group (the admin UI enforces this).
export function miniGroupForRace(series, raceNumber) {
  if (!series || !series.mini_series || !Array.isArray(series.mini_series_groups)) {
    return null;
  }
  return (
    series.mini_series_groups.find((g) => (g.race_numbers || []).includes(raceNumber)) || null
  );
}

// The display label for a race (or scheduled race) on the officer's race-day
// lists. Mini-series children show their parent/child label — R1A, R1B, R1C —
// so the officer can see the mini series structure at a glance; everything
// else is a plain R<number>. The label comes from the race's own stamp when
// present, otherwise it is derived from the series' mini-series group config
// (scheduled items are not created as races yet, so they have no stamp).
export function raceLabel(item, series) {
  if (!item || item.race_number == null) return "";
  if (item.mini_group_label) return item.mini_group_label;
  const g = miniGroupForRace(series, item.race_number);
  if (g && (g.race_numbers || []).length > 1) {
    const base = Math.min(...g.race_numbers);
    return `R${base}${String.fromCharCode(65 + (item.race_number - base))}`;
  }
  return `R${item.race_number}`;
}

// Short note for the race officer console explaining how a mini-series race
// is scored. "additional" groups count each race separately in the series;
// "combined" groups fold their races into a single daily result.
export function miniSeriesNote(group) {
  if (!group) return null;
  const name = group.name ? `: ${group.name}` : "";
  return group.scoring === "combined"
    ? `Mini series${name} — combined into one daily result`
    : `Mini series${name} — score as separate races`;
}
