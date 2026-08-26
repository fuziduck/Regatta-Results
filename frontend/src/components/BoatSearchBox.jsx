import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Anchor, CalendarDays, Layers, Sailboat, Search, X, ArrowRight } from "lucide-react";

const TYPES = [
  { key: "all", label: "All" },
  { key: "boats", label: "Boats" },
  { key: "clubs", label: "Clubs" },
  { key: "series", label: "Series" },
  { key: "classes", label: "Classes" },
];

const TYPE_ICON = {
  boats: <Sailboat className="w-4 h-4 text-ocean dark:text-ocean-light" />,
  clubs: <Anchor className="w-4 h-4 text-ocean dark:text-ocean-light" />,
  series: <CalendarDays className="w-4 h-4 text-ocean dark:text-ocean-light" />,
  classes: <Layers className="w-4 h-4 text-ocean dark:text-ocean-light" />,
};

function BoatRow({ b, onPick }) {
  return (
    <Link
      to={`/boat/${b.fleet_id}`}
      data-testid={`boat-result-${b.fleet_id}`}
      onClick={onPick}
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors group"
    >
      <div className="w-9 h-9 rounded-lg bg-ocean/10 grid place-items-center shrink-0">
        {TYPE_ICON.boats}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-heading uppercase tracking-tight leading-none group-hover:text-ocean transition-colors truncate">{b.name}</div>
        <div className="font-mono text-xs text-muted-foreground mt-1">#{b.sail_no}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-semibold truncate max-w-40">{b.clubs.join(" · ")}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-40">{b.classes.join(" · ")}</div>
      </div>
    </Link>
  );
}

function ClubRow({ c, onPick }) {
  return (
    <Link
      to={`/club/${c.slug}`}
      data-testid={`club-result-${c.id}`}
      onClick={onPick}
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors group"
    >
      <div className="w-9 h-9 rounded-lg bg-ocean/10 grid place-items-center shrink-0">{TYPE_ICON.clubs}</div>
      <div className="min-w-0 flex-1">
        <div className="font-heading uppercase tracking-tight leading-none group-hover:text-ocean transition-colors truncate">{c.name}</div>
        <div className="text-xs text-muted-foreground mt-1">{c.classes} class{c.classes === 1 ? "" : "es"}</div>
      </div>
    </Link>
  );
}

function SeriesRow({ s, onPick }) {
  return (
    <Link
      to={`/club/${s.club_slug}${s.class_id ? `?class=${s.class_id}` : ""}${s.id ? `&series=${s.id}` : ""}`}
      data-testid={`series-result-${s.id}`}
      onClick={onPick}
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors group"
    >
      <div className="w-9 h-9 rounded-lg bg-ocean/10 grid place-items-center shrink-0">{TYPE_ICON.series}</div>
      <div className="min-w-0 flex-1">
        <div className="font-heading uppercase tracking-tight leading-none group-hover:text-ocean transition-colors truncate">{s.name}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {s.club_name}{s.class_name ? ` · ${s.class_name}` : ""}{s.year ? ` · ${s.year}` : ""}
        </div>
      </div>
    </Link>
  );
}

function ClassRow({ c, onPick }) {
  return (
    <Link
      to={`/club/${c.club_slug}?class=${c.id}`}
      data-testid={`class-result-${c.id}`}
      onClick={onPick}
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors group"
    >
      <div className="w-9 h-9 rounded-lg bg-ocean/10 grid place-items-center shrink-0">{TYPE_ICON.classes}</div>
      <div className="min-w-0 flex-1">
        <div className="font-heading uppercase tracking-tight leading-none group-hover:text-ocean transition-colors truncate">{c.name}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {c.club_name}{c.series ? ` · ${c.series} series` : ""}
        </div>
      </div>
    </Link>
  );
}

// A prominent site search for the landing heroes: typing 2+ characters runs
// the unified search (clubs, classes, series, boats) live and drops down
// grouped matches, each linking to its page. Type tabs filter the results.
export default function BoatSearchBox() {
  const [q, setQ] = useState("");
  const [data, setData] = useState({ clubs: [], classes: [], series: [], boats: [] });
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("all");
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setData({ clubs: [], classes: [], series: [], boats: [] });
      setSearched(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      api.siteSearch(term)
        .then((r) => { setData(r || { clubs: [], classes: [], series: [], boats: [] }); setSearched(true); setOpen(true); })
        .catch(() => { setData({ clubs: [], classes: [], series: [], boats: [] }); setSearched(true); setOpen(true); })
        .finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Close the dropdown when clicking anywhere outside the box.
  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const clear = () => { setQ(""); setOpen(false); setType("all"); inputRef.current?.focus(); };

  const total = data.boats.length + data.clubs.length + data.series.length + data.classes.length;
  const shown = type === "all"
    ? { boats: data.boats, clubs: data.clubs, series: data.series, classes: data.classes }
    : { ...{ boats: [], clubs: [], series: [], classes: [] }, [type]: data[type] };
  const empty = searched && !busy && total === 0;

  return (
    <div ref={boxRef} className="relative w-full max-w-xl mt-5" data-testid="boat-search-box">
      <label className="block text-[11px] uppercase tracking-widest font-semibold text-white/70 mb-1.5">
        Find a boat, club, series or class
      </label>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (searched && total > 0) setOpen(true); }}
          placeholder="Search by boat, club, series or class…"
          aria-label="Search boats, clubs, series or classes"
          data-testid="boat-search-input"
          className="w-full h-13 py-3.5 pl-12 pr-11 rounded-xl border border-white/25 bg-white/90 backdrop-blur text-slate-900 placeholder:text-slate-500 text-base shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety"
        />
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-slate-500 hover:text-slate-900 hover:bg-black/10"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-border bg-card shadow-2xl overflow-hidden" data-testid="boat-search-dropdown">
          {busy && <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="boat-search-busy">Searching…</p>}
          {!busy && searched && empty && (
            <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="boat-search-empty">
              No matches for “{q.trim()}”.
            </p>
          )}
          {!busy && total > 0 && (
            <>
              <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5 border-b border-border/60" data-testid="boat-search-tabs">
                {TYPES.map((t) => {
                  const count = t.key === "all" ? total : data[t.key].length;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      data-testid={`search-tab-${t.key}`}
                      onClick={() => setType(t.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors ${
                        type === t.key ? "bg-ocean text-white" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      {t.label}{count > 0 ? ` (${count})` : ""}
                    </button>
                  );
                })}
              </div>
              <div className="max-h-80 overflow-y-auto" data-testid="boat-search-results">
                {shown.boats.length > 0 && (
                  <>
                    <p className="px-4 pt-2.5 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Boats</p>
                    {shown.boats.slice(0, 5).map((b) => <BoatRow key={b.fleet_id} b={b} onPick={() => setOpen(false)} />)}
                  </>
                )}
                {shown.clubs.length > 0 && (
                  <>
                    <p className="px-4 pt-2.5 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Clubs</p>
                    {shown.clubs.slice(0, 5).map((c) => <ClubRow key={c.id} c={c} onPick={() => setOpen(false)} />)}
                  </>
                )}
                {shown.series.length > 0 && (
                  <>
                    <p className="px-4 pt-2.5 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Series</p>
                    {shown.series.slice(0, 5).map((s) => <SeriesRow key={s.id} s={s} onPick={() => setOpen(false)} />)}
                  </>
                )}
                {shown.classes.length > 0 && (
                  <>
                    <p className="px-4 pt-2.5 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Classes</p>
                    {shown.classes.slice(0, 5).map((c) => <ClassRow key={c.id} c={c} onPick={() => setOpen(false)} />)}
                  </>
                )}
              </div>
              <Link
                to={type === "all" || type === "boats" ? "/boats" : "/"}
                onClick={() => setOpen(false)}
                data-testid="boat-search-all"
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-muted/60 hover:bg-muted text-sm font-semibold text-ocean transition-colors border-t border-border"
              >
                {type === "all" || type === "boats" ? "Open full boat search" : "Browse all clubs"}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
