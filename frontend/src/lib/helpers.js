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
