import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Sailboat, Search, X, ArrowRight } from "lucide-react";

// A prominent boat search for the landing-page heroes. Typing 2+ characters
// runs the fleet-wide search live (debounced) and drops down up to 5 matches,
// each linking to the boat's career page; a footer link opens the full search
// page on /boats.
export default function BoatSearchBox() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      api.fleetSearch(term)
        .then((r) => { setResults(r || []); setSearched(true); setOpen(true); })
        .catch(() => { setResults([]); setSearched(true); setOpen(true); })
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

  const clear = () => { setQ(""); setOpen(false); inputRef.current?.focus(); };

  return (
    <div ref={boxRef} className="relative w-full max-w-xl mt-5" data-testid="boat-search-box">
      <label className="block text-[11px] uppercase tracking-widest font-semibold text-white/70 mb-1.5">
        Find a boat
      </label>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (searched && results.length) setOpen(true); }}
          placeholder="Search by boat name or sail number…"
          aria-label="Search boats by name or sail number"
          data-testid="boat-search-input"
          className="w-full h-13 py-3.5 pl-12 pr-11 rounded-xl border border-white/25 bg-white/90 backdrop-blur text-foreground placeholder:text-muted-foreground text-base shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety"
        />
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/10"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-border bg-card shadow-2xl overflow-hidden" data-testid="boat-search-dropdown">
          {busy && <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="boat-search-busy">Searching…</p>}
          {!busy && searched && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="boat-search-empty">
              No boats found for “{q.trim()}”.
            </p>
          )}
          {!busy && results.length > 0 && (
            <ul className="max-h-80 overflow-y-auto" data-testid="boat-search-results">
              {results.slice(0, 5).map((b) => (
                <li key={b.fleet_id} className="border-b border-border/60 last:border-0">
                  <Link
                    to={`/boat/${b.fleet_id}`}
                    data-testid={`boat-result-${b.fleet_id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-ocean/10 grid place-items-center shrink-0">
                      <Sailboat className="w-4 h-4 text-ocean dark:text-ocean-light" />
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
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/boats"
            onClick={() => setOpen(false)}
            data-testid="boat-search-all"
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-muted/60 hover:bg-muted text-sm font-semibold text-ocean transition-colors border-t border-border"
          >
            Open full boat search <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
