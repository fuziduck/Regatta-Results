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

export const CODE_COLORS = {
  FINISHED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  DNC: "bg-slate-100 text-slate-600 border-slate-300",
  DNS: "bg-amber-100 text-amber-800 border-amber-300",
  DNF: "bg-orange-100 text-orange-800 border-orange-300",
  OCS: "bg-red-100 text-red-800 border-red-300",
  UFD: "bg-red-100 text-red-800 border-red-300",
  BFD: "bg-red-100 text-red-800 border-red-300",
  ZFP: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300",
  SCP: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300",
  NSC: "bg-orange-100 text-orange-800 border-orange-300",
  RET: "bg-purple-100 text-purple-800 border-purple-300",
  DSQ: "bg-red-100 text-red-800 border-red-300",
  DNE: "bg-red-200 text-red-900 border-red-400",
  DPI: "bg-red-100 text-red-800 border-red-300",
  RDG: "bg-blue-100 text-blue-800 border-blue-300",
};

export const CURRENT_YEAR = new Date().getFullYear();

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
