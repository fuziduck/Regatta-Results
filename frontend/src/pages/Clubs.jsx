import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { CURRENT_YEAR, MAX_YEAR, fmtDateShort } from "@/lib/helpers";
import YearSwitcher from "@/components/YearSwitcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Anchor, CalendarDays, LogIn, Sailboat, Trophy } from "lucide-react";

function ClubIcon({ club, size = "w-16 h-16" }) {
  return (
    <div
      className={`${size} rounded-2xl grid place-items-center text-white font-heading text-3xl uppercase shadow-lg shrink-0`}
      style={{ backgroundColor: club.color || "#0A369D" }}
    >
      {(club.name || "C").charAt(0)}
    </div>
  );
}

function LatestResults({ latest }) {
  if (!latest) {
    return <p className="text-xs text-muted-foreground">No published races yet.</p>;
  }
  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Trophy className="w-3.5 h-3.5 text-safety" />
        Latest · R{latest.race_number} · {fmtDateShort(latest.date)}
      </div>
      <div className="space-y-1">
        {latest.top3.map((t) => (
          <div key={t.position} className="flex items-center gap-2 text-sm">
            <span
              className={`w-6 h-6 rounded-md grid place-items-center text-xs font-heading ${
                t.position === 1 ? "bg-amber-100 text-amber-800" :
                t.position === 2 ? "bg-slate-200 text-slate-700" :
                "bg-orange-100 text-orange-800"
              }`}
            >
              {t.position}
            </span>
            <span className="font-semibold">{t.boat}</span>
            {t.sail_no && <span className="font-mono text-xs text-muted-foreground">{t.sail_no}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Clubs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const yearParam = Number(searchParams.get("year"));
  const year = Number.isInteger(yearParam) && yearParam > 2000 && yearParam <= MAX_YEAR ? yearParam : CURRENT_YEAR;
  const setYear = (y) => setSearchParams(y === CURRENT_YEAR ? {} : { year: String(y) });
  const future = year > CURRENT_YEAR;
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState([]);

  useEffect(() => {
    api.getSeasons().then((d) => setSeasons(d?.years || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.getClubDirectory(year === CURRENT_YEAR ? undefined : year)
      .then(setDirectory).catch(() => {}).finally(() => setLoading(false));
  }, [year]);

  // Future years only appear once a club has set up a series for them.
  const futureYears = seasons.filter((y) => y > CURRENT_YEAR && y <= MAX_YEAR);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-ocean grid place-items-center"><Anchor className="w-5 h-5 text-white" /></div>
            <div className="font-heading text-xl uppercase tracking-tight leading-none">Club Race Results</div>
          </div>
          <Link to="/login">
            <Button variant="outline" size="sm" data-testid="officials-login-btn" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white">
              <LogIn className="w-4 h-4" /> Officials
            </Button>
          </Link>
        </div>
      </header>

      <section className="relative">
        <img
          src="https://images.unsplash.com/photo-1613578699399-82ae71be53a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwxfHxzYWlsYm9hdCUyMHJhY2luZyUyMHJlZ2F0YXR8ZW58MHx8fHwxNzg2MTI3MTgxfDA&ixlib=rb-4.1.0&q=85"
          alt="racing" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 hero-overlay" />
        <div className="relative max-w-6xl mx-auto px-4 py-16 md:py-20">
          <Badge className={`mb-4 uppercase tracking-widest ${year === CURRENT_YEAR ? "bg-safety text-white" : "bg-white/20 text-white border border-white/40"}`} data-testid="season-badge">
            {year} Season
          </Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl uppercase tracking-tighter text-white leading-[0.95] max-w-3xl">
            Club racing results & standings
          </h1>
          <p className="text-white/80 mt-4 max-w-xl leading-relaxed">
            {year === CURRENT_YEAR
              ? "Pick your club to follow every fleet across the season — results, series championships and race-day notices."
              : future
                ? `See what's already set up for ${year} — pick a club to view its upcoming season.`
                : `Every club that raced in ${year} — pick a club to see its full season.`}
          </p>
          <YearSwitcher grouped value={year} onChange={setYear} years={[CURRENT_YEAR - 1, ...futureYears]} className="mt-5" />
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 py-10">
        <h2 className="text-lg md:text-lg uppercase tracking-tight mb-1">{year === CURRENT_YEAR ? "Clubs on the system" : future ? `Clubs racing in ${year}` : `Clubs that raced in ${year}`}</h2>
        <p className="text-muted-foreground text-sm mb-6">Tap a club to see its classes and latest results.</p>

        {loading ? (
          <p className="text-muted-foreground">Loading clubs…</p>
        ) : directory.length === 0 ? (
          year === CURRENT_YEAR ? (
            <p className="text-muted-foreground">No clubs set up yet.</p>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center" data-testid="no-results-year">
              <p className="font-heading text-xl uppercase tracking-tight">No results recorded in {year}</p>
              <p className="text-muted-foreground text-sm mt-1">
                {future
                  ? `The ${year} season hasn't started yet — clubs appear here once a series or results are set up.`
                  : "No clubs published results for that season."}
              </p>
            </div>
          )
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="club-grid">
            {directory.map((club) => (
              <Link
                key={club.id}
                to={`/club/${club.slug}${year === CURRENT_YEAR ? "" : `?year=${year}`}`}
                data-testid={`club-card-${club.slug}`}
                className="group rounded-2xl border border-border bg-card p-5 hover:shadow-xl hover:border-ocean/40 hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-center gap-4">
                  <ClubIcon club={club} />
                  <div>
                    <div className="font-heading text-2xl uppercase tracking-tight leading-none group-hover:text-ocean transition-colors">{club.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Sailboat className="w-3.5 h-3.5" /> {club.classes.length} class{club.classes.length === 1 ? "" : "es"}</div>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  {club.classes.length === 0 && <p className="text-xs text-muted-foreground">No classes set up yet.</p>}
                  {club.classes.map((c) => (
                    <div key={c.id} className="rounded-xl bg-muted/40 border border-border/60 p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-heading uppercase tracking-tight text-sm">{c.name}</div>
                        {c.latest?.scoring_mode === "irc" && <Badge variant="outline" className="text-[10px] text-indigo-700 border-indigo-300 bg-indigo-50">IRC</Badge>}
                        {c.latest?.scoring_mode === "py" && <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50">PY</Badge>}
                      </div>
                      {c.latest ? (
                        <LatestResults latest={c.latest} />
                      ) : c.planned_series?.length ? (
                        <div className="mt-3 rounded-lg bg-ocean/5 border border-ocean/20 p-2.5">
                          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-ocean">
                            <CalendarDays className="w-3.5 h-3.5" /> Series planned
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {c.planned_series.map((s) => `${s.name}${s.planned_races ? ` · ${s.planned_races} races` : ""}`).join(", ")}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">No published races yet.</p>
                      )}
                    </div>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        Scored under the RRS Low Point System · {year}
      </footer>
    </div>
  );
}
