import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { LogIn, Sailboat, Search, X } from "lucide-react";
import Logo from "@/components/Logo";

export default function Boats() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);

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
        .then((r) => { setResults(r || []); setSearched(true); })
        .catch(() => { setResults([]); setSearched(true); })
        .finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <Logo className="h-11 w-auto" />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/login">
              <Button variant="outline" size="sm" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white">
                <LogIn className="w-4 h-4" /> Officials
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="bg-ocean-dark">
        <div className="max-w-6xl mx-auto px-4 py-10 md:py-12">
          <h1 className="text-3xl sm:text-4xl uppercase tracking-tighter text-white leading-[0.95]">Find a boat</h1>
          <p className="text-white/80 mt-3 max-w-xl leading-relaxed">
            Search by boat name or sail number. A boat that races at several clubs or in
            several classes appears once, with every series it has competed in.
          </p>
          <div className="relative mt-6 max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              ref={inputRef}
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. Watersong, or a sail number like 8420"
              data-testid="boat-search-input"
              className="w-full h-14 pl-12 pr-12 rounded-xl border border-border bg-card text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {q && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => { setQ(""); inputRef.current?.focus(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {busy && <p className="text-muted-foreground" data-testid="boat-search-busy">Searching…</p>}
        {!busy && q.trim().length >= 2 && searched && results.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center" data-testid="boat-search-empty">
            <p className="font-heading text-xl uppercase tracking-tight">No boats found</p>
            <p className="text-muted-foreground text-sm mt-1">Try a different name or sail number — boats appear once published results exist.</p>
          </div>
        )}
        {!busy && results.length > 0 && (
          <div className="space-y-3" data-testid="boat-search-results">
            <p className="text-xs text-muted-foreground">{results.length} boat{results.length === 1 ? "" : "s"} found</p>
            {results.map((b) => (
              <Link
                key={b.fleet_id}
                to={`/boat/${b.fleet_id}`}
                data-testid={`boat-result-${b.fleet_id}`}
                className="group flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 hover:shadow-xl hover:border-ocean/40 hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-ocean/10 grid place-items-center shrink-0">
                    <Sailboat className="w-5 h-5 text-ocean dark:text-ocean-light" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-heading text-xl uppercase tracking-tight leading-none group-hover:text-ocean transition-colors">
                      {b.name}
                    </div>
                    <div className="font-mono text-sm text-muted-foreground mt-1">#{b.sail_no}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold">{b.clubs.join(" · ")}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {b.classes.join(" · ")}
                    {b.records > 1 ? ` · ${b.records} club records` : ""}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        {!busy && q.trim().length < 2 && (
          <p className="text-muted-foreground text-sm">Type at least two characters to search.</p>
        )}
      </main>
    </div>
  );
}
