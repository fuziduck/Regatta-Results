import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";
import { SeriesStandingsTable } from "@/components/StandingsTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Anchor, ArrowLeft, LogIn, Sailboat, Search, Trophy, Medal, Lock, Archive } from "lucide-react";
import { CURRENT_YEAR } from "@/lib/helpers";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/siteConfig";

export default function Boat() {
  const { fleetId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  // Active series expansion: click a position to see the full series table.
  const [active, setActive] = useState(null); // {series_id, series_name, payload}
  const [seriesBusy, setSeriesBusy] = useState(false);

  useEffect(() => {
    setLoading(true); setMissing(false); setProfile(null); setActive(null);
    api.fleetProfile(fleetId)
      .then((p) => setProfile(p))
      .catch(() => setMissing(true))
      .finally(() => setLoading(false));
  }, [fleetId]);

  const openSeries = async (s) => {
    setSeriesBusy(true);
    try {
      const payload = await api.seriesStandings(s.series_id);
      setActive({ series_id: s.series_id, series_name: s.series_name, club_name: s.club_name, payload });
    } catch {
      setActive({ series_id: s.series_id, series_name: s.series_name, club_name: s.club_name, payload: null });
    } finally {
      setSeriesBusy(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading…</div>;
  }

  const header = (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-ocean grid place-items-center"><Sailboat className="w-5 h-5 text-white" /></div>
          <div className="font-heading text-xl uppercase tracking-tight leading-none">{profile?.name || "Boat"}</div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link to="/boats"><Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-ocean" data-testid="back-to-boat-search"><Search className="w-4 h-4" /> Search</Button></Link>
          <Link to="/login">
            <Button variant="outline" size="sm" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white">
              <LogIn className="w-4 h-4" /> Officials
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );

  if (missing || !profile) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <div className="max-w-6xl mx-auto px-4 py-16 text-center space-y-3">
          <p className="text-muted-foreground">Boat not found.</p>
          <Link to="/boats"><Button variant="outline" className="gap-2 border-ocean text-ocean"><ArrowLeft className="w-4 h-4" /> Back to boat search</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {header}

      <section className="bg-ocean-dark">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <Link to="/boats" className="inline-flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-semibold transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to boat search
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-4 mt-3">
            <div>
              <h1 className="text-3xl sm:text-4xl uppercase tracking-tighter text-white leading-[0.95]">{profile.name}</h1>
              <p className="font-mono text-white/80 mt-1.5">Sail No. {profile.sail_no}</p>
            </div>
            <div className="flex flex-wrap gap-2 max-w-lg justify-end">
              {profile.records.map((r) => (
                <Link key={r.boat_id} to={`/club/${r.club_slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20 transition-colors">
                  <Anchor className="w-3 h-3" /> {r.club_name} · {r.class_name} {r.year}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-10">
        {profile.overall.length > 0 && (
          <section>
            <h2 className="text-lg md:text-xl uppercase tracking-tight mb-3 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-ocean dark:text-ocean-light" /> Overall championships
            </h2>
            <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-ocean text-white text-left">
                    <th className="py-2.5 px-4 font-semibold">Club</th>
                    <th className="py-2.5 px-4 font-semibold">Class</th>
                    <th className="py-2.5 px-4 font-semibold">Year</th>
                    <th className="py-2.5 px-4 font-semibold text-center">Position</th>
                    <th className="py-2.5 px-4 font-semibold text-center">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.overall.map((o, i) => {
                    const qp = new URLSearchParams();
                    if (o.year && o.year !== CURRENT_YEAR) qp.set("year", String(o.year));
                    if (o.class_id) qp.set("class", o.class_id);
                    const qs = qp.toString();
                    return (
                      <tr key={i}
                        onClick={() => navigate(`/club/${o.club_slug}${qs ? `?${qs}` : ""}`)}
                        data-testid={`career-overall-${o.class_id}`}
                        className={`${i % 2 ? "bg-muted" : "bg-card"} cursor-pointer hover:bg-muted/70 transition-colors`}
                        title={`View the ${o.year} overall championship for ${o.class_name}`}
                      >
                        <td className="py-2 px-4">{o.club_name}</td>
                        <td className="py-2 px-4">{o.class_name}</td>
                        <td className="py-2 px-4">{o.year}</td>
                        <td className="py-2 px-4 text-center font-heading text-base">{o.rank}</td>
                        <td className="py-2 px-4 text-center font-mono font-bold text-ocean dark:text-ocean-light">{o.net}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-lg md:text-xl uppercase tracking-tight mb-3 flex items-center gap-2">
            <Medal className="w-5 h-5 text-ocean dark:text-ocean-light" /> Series raced
          </h2>
          {profile.series.length === 0 ? (
            <p className="text-muted-foreground text-sm">No published results yet — this boat will appear here once it has raced.</p>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm" data-testid="boat-career-table">
                <thead>
                  <tr className="bg-ocean text-white text-left">
                    <th className="py-2.5 px-4 font-semibold">Series</th>
                    <th className="py-2.5 px-4 font-semibold">Club</th>
                    <th className="py-2.5 px-4 font-semibold">Class</th>
                    <th className="py-2.5 px-4 font-semibold">Year</th>
                    <th className="py-2.5 px-4 font-semibold text-center">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.series.map((s, i) => (
                    <tr key={s.series_id}
                      onClick={() => openSeries(s)}
                      data-testid={`career-series-${s.series_id}`}
                      className={`${i % 2 ? "bg-muted" : "bg-card"} cursor-pointer hover:bg-muted/70 transition-colors`}
                      title={`View the full ${s.series_name} results`}
                    >
                      <td className="py-2 px-4">
                        <span className="font-semibold">{s.series_name}</span>
                        {s.locked && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                            {s.archived ? <Archive className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                            {s.archived ? "Archived" : "Locked"}
                          </span>
                        )}
                        <div className="text-xs text-muted-foreground">{s.races_scored} race{s.races_scored === 1 ? "" : "s"}{s.discards ? ` · ${s.discards} discard${s.discards === 1 ? "" : "s"}` : ""}</div>
                      </td>
                      <td className="py-2 px-4">
                        {s.club_slug
                          ? <Link to={`/club/${s.club_slug}`} className="text-ocean dark:text-ocean-light hover:underline" onClick={(e) => e.stopPropagation()}>{s.club_name}</Link>
                          : s.club_name}
                      </td>
                      <td className="py-2 px-4 text-muted-foreground">{s.class_name}</td>
                      <td className="py-2 px-4">{s.year}</td>
                      <td className="py-2 px-4 text-center">
                        <span className="inline-flex items-center gap-1 rounded-lg border border-ocean/40 px-2.5 py-1 font-heading text-base text-ocean dark:text-ocean-light">
                          {s.rank}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground px-4 py-2 bg-muted/30">
                Tap a position to see the full series table · Positions are provisional until a season is locked.
              </p>
            </div>
          )}
        </section>

        {active && (
          <section data-testid="series-detail">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg md:text-xl uppercase tracking-tight">
                {active.series_name}
                {active.club_name ? <span className="text-muted-foreground"> · {active.club_name}</span> : ""}
              </h2>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-ocean" onClick={() => setActive(null)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to career
              </Button>
            </div>
            {seriesBusy ? (
              <p className="text-muted-foreground">Loading series…</p>
            ) : active.payload ? (
              <SeriesStandingsTable data={active.payload} />
            ) : (
              <p className="text-muted-foreground">Could not load this series.</p>
            )}
          </section>
        )}
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <div className="font-heading uppercase tracking-tight">{SITE_NAME}</div>
        <p className="mt-1">{SITE_TAGLINE}</p>
      </footer>
    </div>
  );
}
