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

export const CODE_COLORS = {
  FINISHED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  DNC: "bg-slate-100 text-slate-600 border-slate-300",
  DNS: "bg-amber-100 text-amber-800 border-amber-300",
  DNF: "bg-orange-100 text-orange-800 border-orange-300",
  OCS: "bg-red-100 text-red-800 border-red-300",
  RET: "bg-purple-100 text-purple-800 border-purple-300",
  DSQ: "bg-red-100 text-red-800 border-red-300",
  DNE: "bg-red-200 text-red-900 border-red-400",
  RDG: "bg-blue-100 text-blue-800 border-blue-300",
};

export const CURRENT_YEAR = new Date().getFullYear();
