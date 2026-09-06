import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { SAILSCORE_EVENTS, trackEvent } from "@/lib/analytics";
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

// Row destinations, shared by the rendered links and the keyboard highlight
// list so Enter always follows the same route a click would.
const rowHrefs = {
  boat: (b) => `/boat/${b.fleet_id}`,
  club: (c) => `/club/${c.slug}`,
  series: (s) => `/club/${s.club_slug}${s.class_id ? `?class=${s.class_id}` : ""}${s.id ? `&series=${s.id}` : ""}`,
  class: (c) => `/club/${c.club_slug}?class=${c.id}`,
};

function rowClasses(highlighted) {
  return `flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors group ${highlighted ? "bg-muted" : ""}`;
}

function BoatRow({ b, onPick, highlighted, index, onHover }) {
  return (
    <Link
      to={rowHrefs.boat(b)}
      id={`search-row-${index}`}
      data-testid={`boat-result-${b.fleet_id}`}
      data-highlighted={highlighted || undefined}
      onClick={onPick}
      onMouseEnter={onHover}
      className={rowClasses(highlighted)}
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

function ClubRow({ c, onPick, highlighted, index, onHover }) {
  return (
    <Link
      to={rowHrefs.club(c)}
      id={`search-row-${index}`}
      data-testid={`club-result-${c.id}`}
      data-highlighted={highlighted || undefined}
      onClick={onPick}
      onMouseEnter={onHover}
      className={rowClasses(highlighted)}
    >
      <div className="w-9 h-9 rounded-lg bg-ocean/10 grid place-items-center shrink-0">{TYPE_ICON.clubs}</div>
      <div className="min-w-0 flex-1">
        <div className="font-heading uppercase tracking-tight leading-none group-hover:text-ocean transition-colors truncate">{c.name}</div>
        <div className="text-xs text-muted-foreground mt-1">{c.classes} class{c.classes === 1 ? "" : "es"}</div>
      </div>
    </Link>
  );
}

function SeriesRow({ s, onPick, highlighted, index, onHover }) {
  return (
    <Link
      to={rowHrefs.series(s)}
      id={`search-row-${index}`}
      data-testid={`series-result-${s.id}`}
      data-highlighted={highlighted || undefined}
      onClick={onPick}
      onMouseEnter={onHover}
      className={rowClasses(highlighted)}
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

function ClassRow({ c, onPick, highlighted, index, onHover }) {
  return (
    <Link
      to={rowHrefs.class(c)}
      id={`search-row-${index}`}
      data-testid={`class-result-${c.id}`}
      data-highlighted={highlighted || undefined}
      onClick={onPick}
      onMouseEnter={onHover}
      className={rowClasses(highlighted)}
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
// Keyboard: ↑/↓ move the highlight, Enter opens it (the first result when
// nothing is highlighted), Escape closes then clears; "/" or Cmd/Ctrl+K
// focuses the search from anywhere on the page.
export default function BoatSearchBox({ className = "mt-5" }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState({ clubs: [], classes: [], series: [], boats: [] });
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("all");
  const [highlight, setHighlight] = useState(-1);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  // One logical search per distinct term, even as typing fires incremental
  // API calls. The term itself never reaches analytics — only the type.
  const trackedQueryRef = useRef("");

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
        .then((r) => {
          const payload = r || { clubs: [], classes: [], series: [], boats: [] };
          setData(payload); setSearched(true); setOpen(true);
          if (trackedQueryRef.current !== term) {
            trackedQueryRef.current = term;
            // Coarse outcome only — the query text is PII-risky and stays local.
            trackEvent(SAILSCORE_EVENTS.SEARCH, {
              search_type: "site",
              result_count: payload.boats.length + payload.clubs.length + payload.series.length + payload.classes.length,
            });
          }
        })
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

  // "/" and Cmd/Ctrl+K focus the search from anywhere — unless the user is
  // already typing in a field, where "/" must stay a literal character.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const clear = () => { setQ(""); setOpen(false); setType("all"); inputRef.current?.focus(); };

  // Reset the keyboard highlight whenever the result set changes identity.
  useEffect(() => { setHighlight(-1); }, [q, type]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (highlight >= 0) document.getElementById(`search-row-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const total = data.boats.length + data.clubs.length + data.series.length + data.classes.length;
  // Only offer rows that can actually link somewhere. Orphaned series/classes
  // (their club no longer exists) would produce a dead "/club/" link — the
  // backend already filters these, this guards against any that slip through.
  const shown = type === "all"
    ? {
        boats: data.boats.filter((b) => b.fleet_id),
        clubs: data.clubs.filter((c) => c.slug),
        series: data.series.filter((s) => s.club_slug),
        classes: data.classes.filter((c) => c.club_slug),
      }
    : { ...{ boats: [], clubs: [], series: [], classes: [] }, [type]: data[type].filter((row) =>
        type === "boats" ? row.fleet_id : type === "clubs" ? row.slug : row.club_slug) };
  const empty = searched && !busy && total === 0;

  // The rows actually rendered, in display order — the keyboard highlight
  // walks this same list so Enter follows the row the user sees.
  const dBoats = shown.boats.slice(0, 5);
  const dClubs = shown.clubs.slice(0, 5);
  const dSeries = shown.series.slice(0, 5);
  const dClasses = shown.classes.slice(0, 5);
  const offClubs = dBoats.length;
  const offSeries = offClubs + dClubs.length;
  const offClasses = offSeries + dSeries.length;
  const displayed = [
    ...dBoats.map((b) => rowHrefs.boat(b)),
    ...dClubs.map((c) => rowHrefs.club(c)),
    ...dSeries.map((s) => rowHrefs.series(s)),
    ...dClasses.map((c) => rowHrefs.class(c)),
  ];

  const moveHighlight = (delta) => {
    if (!displayed.length) return;
    // From no highlight, ArrowDown opens at the first row and ArrowUp at the
    // last (standard combobox behavior); afterwards the list wraps.
    setHighlight((h) => (h === -1 ? (delta > 0 ? 0 : displayed.length - 1) : (h + delta + displayed.length) % displayed.length));
  };

  const onInputKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && q.trim().length >= 2) setOpen(true);
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter") {
      const to = displayed[highlight] || displayed[0];
      if (to) { setOpen(false); navigate(to); }
    } else if (e.key === "Escape") {
      // First Escape closes the dropdown, second clears the query.
      if (open) setOpen(false);
      else if (q) clear();
    }
  };

  const hover = (index) => () => setHighlight(index);

  return (
    <div ref={boxRef} className={`relative w-full max-w-xl ${className}`} data-testid="boat-search-box">
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
          onKeyDown={onInputKeyDown}
          placeholder="Search by boat, club, series or class…"
          aria-label="Search boats, clubs, series or classes"
          role="combobox"
          aria-expanded={open && q.trim().length >= 2}
          aria-activedescendant={highlight >= 0 ? `search-row-${highlight}` : undefined}
          data-testid="boat-search-input"
          className="w-full h-13 py-3.5 pl-12 pr-11 rounded-xl border border-white/25 bg-white/90 backdrop-blur text-slate-900 placeholder:text-slate-500 text-base shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety"
        />
        {q ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-slate-500 hover:text-slate-900 hover:bg-black/10"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded border border-slate-300 bg-white/70 font-mono text-[11px] text-slate-500" aria-hidden="true">
            /
          </kbd>
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
                {dBoats.length > 0 && (
                  <>
                    <p className="px-4 pt-2.5 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Boats</p>
                    {dBoats.map((b, i) => <BoatRow key={b.fleet_id} b={b} onPick={() => setOpen(false)} highlighted={i === highlight} index={i} onHover={hover(i)} />)}
                  </>
                )}
                {dClubs.length > 0 && (
                  <>
                    <p className="px-4 pt-2.5 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Clubs</p>
                    {dClubs.map((c, i) => <ClubRow key={c.id} c={c} onPick={() => setOpen(false)} highlighted={offClubs + i === highlight} index={offClubs + i} onHover={hover(offClubs + i)} />)}
                  </>
                )}
                {dSeries.length > 0 && (
                  <>
                    <p className="px-4 pt-2.5 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Series</p>
                    {dSeries.map((s, i) => <SeriesRow key={s.id} s={s} onPick={() => setOpen(false)} highlighted={offSeries + i === highlight} index={offSeries + i} onHover={hover(offSeries + i)} />)}
                  </>
                )}
                {dClasses.length > 0 && (
                  <>
                    <p className="px-4 pt-2.5 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">Classes</p>
                    {dClasses.map((c, i) => <ClassRow key={c.id} c={c} onPick={() => setOpen(false)} highlighted={offClasses + i === highlight} index={offClasses + i} onHover={hover(offClasses + i)} />)}
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
