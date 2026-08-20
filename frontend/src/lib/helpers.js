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
  // Scheduled start is timezone-less; treat it as UTC to match the backend.
  if (race.date && race.start_time) return `${race.date}T${race.start_time}:00Z`;
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

// Corrected time in seconds per IRC Rule 12.2 (elapsed x TCC, rounded to the
// nearest second, 0.5 up) — mirrors the backend _corrected_time_sec. Returns
// null when the elapsed time or TCC is missing.
export function correctedSecondsOf(finishTime, race, tcc) {
  const el = elapsedSecondsOf(finishTime, race);
  if (el == null || !tcc) return null;
  return Math.round(el * tcc);
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
