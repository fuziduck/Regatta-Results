import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";
import { SeriesStandingsTable } from "@/components/StandingsTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Anchor, ArrowLeft, ArrowRight, Award, CalendarDays, ChevronRight,
  Clock, Download, Flag, History, Info, Lock, Archive, LogIn, MapPin, Medal, Pencil,
  Percent, Sailboat, Search, Share2, Star, TrendingUp, Trophy, User, Users,
} from "lucide-react";
import Logo from "@/components/Logo";
import { CURRENT_YEAR } from "@/lib/helpers";
import ResultsSubscription from "@/components/ResultsSubscription";
import { SITE_TAGLINE } from "@/lib/siteConfig";

const ordinal = (n) => {
  if (n == null || n === "") return "–";
  const s = ["th", "st", "nd", "rd"];
  const v = Number(n) % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const fmtDay = (d) => {
  if (!d) return "";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
};

// A race-by-race table: Date, Event/Series, Race, Pos, Points, Total, Net.
// Discarded races are shown in parentheses (and struck through), matching the
// results tables across the site.
function RaceTable({ rows, highlight }) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No race results yet.</p>;
  }
  const cellCls = (discarded) =>
    `py-2.5 px-3 text-center font-mono text-sm whitespace-nowrap ${discarded ? "text-muted-foreground line-through" : ""}`;
  return (
    <div className="rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-ocean text-white text-left">
            <th className="py-2.5 px-3 font-semibold">Date</th>
            <th className="py-2.5 px-3 font-semibold">Event / Series</th>
            <th className="py-2.5 px-3 font-semibold">Race</th>
            <th className="py-2.5 px-3 font-semibold text-center">Pos</th>
            <th className="py-2.5 px-3 font-semibold text-center">Points</th>
            <th className="py-2.5 px-3 font-semibold text-center">Total</th>
            <th className="py-2.5 px-3 font-semibold text-center">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => {
            const pos = h.position != null;
            return (
              <tr key={`${h.series_id}-${h.race_number}-${i}`} className={i % 2 ? "bg-muted/40" : "bg-card"}>
                <td className="py-2.5 px-3 whitespace-nowrap">{fmtDay(h.date)}</td>
                <td className="py-2.5 px-3 font-semibold">
                  <div>{h.series_name}</div>
                  {h.club_name && <div className="text-xs font-normal text-muted-foreground">{h.club_name}{h.class_name ? ` · ${h.class_name}` : ""}</div>}
                </td>
                <td className="py-2.5 px-3 text-muted-foreground">Race {h.race_number}</td>
                <td className={cellCls(h.discarded)}>
                  {pos ? (
                    <span className={`inline-flex items-center justify-center min-w-7 rounded-md px-1.5 py-0.5 font-bold ${h.position === 1 ? "bg-safety text-white" : "bg-muted text-muted-foreground"}`}>
                      {h.discarded ? `(${h.position})` : h.position}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{h.code}</span>
                  )}
                </td>
                <td className={cellCls(h.discarded)}>{h.discarded ? `(${h.points})` : h.points}</td>
                <td className={cellCls(h.discarded)}>{h.total}</td>
                <td className={`py-2.5 px-3 text-center font-mono text-sm font-bold text-ocean dark:text-ocean-light whitespace-nowrap ${h.discarded ? "text-muted-foreground line-through" : ""}`}>{h.net}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-ocean/10 grid place-items-center shrink-0 text-ocean dark:text-ocean-light">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-heading leading-none">{value ?? "–"}</div>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground mt-1.5">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function Boat() {
  const { fleetId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState("overview");
  const [year, setYear] = useState(CURRENT_YEAR);
  const [seasonIdx, setSeasonIdx] = useState(0);
  // Active series expansion (SERIES STANDINGS tab): click a position to see
  // the full series table.
  const [active, setActive] = useState(null);
  const [seriesBusy, setSeriesBusy] = useState(false);

  useEffect(() => {
    setLoading(true); setMissing(false); setProfile(null); setActive(null); setSeasonIdx(0);
    api.fleetProfile(fleetId)
      .then((p) => setProfile(p))
      .catch(() => setMissing(true))
      .finally(() => setLoading(false));
  }, [fleetId]);

  const seasons = useMemo(() => profile?.seasons || [], [profile]);
  const years = useMemo(() => [...new Set(seasons.map((s) => s.year))].sort((a, b) => b - a), [seasons]);
  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [years, year]);
  useEffect(() => { setSeasonIdx(0); }, [year]);

  const yearSeasons = seasons.filter((s) => s.year === year);
  const season = yearSeasons[Math.min(seasonIdx, yearSeasons.length - 1)] || null;
  const stats = season?.stats || {};
  const allHistory = useMemo(() => {
    const out = [];
    seasons.forEach((s) => (s.race_history || []).forEach((h) => out.push({ ...h, season_year: s.year, season_club: s.club_name })));
    return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [seasons]);

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

  const club = profile?.records?.[0];
  const header = (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/"><Logo className="h-11 w-auto shrink-0" /></Link>
          <span className="h-6 w-px bg-border hidden sm:block" />
          <div className="font-heading text-lg uppercase tracking-tight leading-none truncate hidden sm:block">
            {season?.club_name || club?.club_name || "SailScore"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {profile && <ResultsSubscription subscriptionType="boat" targetId={profile.records?.[0]?.boat_id || fleetId} targetName={`${profile.name} (Sail No. ${profile.sail_no})`} buttonLabel="Subscribe" />}
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

  const standingsHref = season ? `/club/${season.club_slug}${season.class_id ? `?class=${season.class_id}` : ""}${season.year && season.year !== CURRENT_YEAR ? `&year=${season.year}` : ""}` : "/clubs";
  const shareLink = () => {
    if (navigator.share) navigator.share({ title: `${profile.name} — ${profile.sail_no}`, url: window.location.href }).catch(() => {});
    else navigator.clipboard?.writeText(window.location.href).catch(() => {});
  };

  const TABS = [
    { key: "overview", label: "Overview", icon: <Info className="w-4 h-4" /> },
    { key: "overall", label: "Overall", icon: <Trophy className="w-4 h-4" /> },
    { key: "results", label: "Results", icon: <Flag className="w-4 h-4" /> },
    { key: "series", label: "Series Standings", icon: <Trophy className="w-4 h-4" /> },
    { key: "history", label: "Race History", icon: <History className="w-4 h-4" /> },
    { key: "details", label: "Boat Details", icon: <Sailboat className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      {header}

      <section className="bg-ocean-dark">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link to="/boats" className="inline-flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-semibold transition-colors" data-testid="back-to-boat-search">
              <ArrowLeft className="w-4 h-4" /> Back to search results
            </Link>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5 text-white/80 hover:bg-white/10 hover:text-white" onClick={shareLink}>
                <Share2 className="w-4 h-4" /> Share
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-white/80 hover:bg-white/10 hover:text-white">
                <Download className="w-4 h-4" /> PDF
              </Button>
            </div>
          </div>

          <div className="grid md:grid-cols-[minmax(0,1fr)_auto] gap-6 mt-5 items-start">
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <div className="w-full sm:w-44 shrink-0 aspect-[4/3] rounded-2xl overflow-hidden bg-white/10 border border-white/15 grid place-items-center">
                <img
                  src="https://images.unsplash.com/photo-1613578699399-82ae71be53a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwxfHxzYWlsYm9hdCUyMHJhY2luZyUyMHJlZ2F0YXR8ZW58MHx8fHwxNzg2MTI3MTgxfDA&ixlib=rb-4.1.0&q=85"
                  alt={`${profile.name} sailing`}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <h1 className="text-3xl sm:text-4xl uppercase tracking-tighter text-white leading-[0.95]">{profile.name}</h1>
                <p className="font-mono text-white/80 mt-1.5">{profile.sail_no}</p>
                <div className="mt-3 space-y-1.5 text-sm text-white/90">
                  <div className="flex items-center gap-2"><Sailboat className="w-4 h-4 text-white/60" /> <span className="font-semibold uppercase tracking-wide">{season?.class_name || club?.class_name}</span> <span className="text-white/50 text-xs">Class</span></div>
                  <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-white/60" /> {(() => { const hcSlug = season?.boat_info?.home_club_slug || profile.boat?.home_club_slug || ""; const hcName = season?.boat_info?.home_club || profile.boat?.home_club || "—"; return hcSlug ? <Link to={`/club/${hcSlug}`} className="hover:underline">{hcName}</Link> : <span>{hcName}</span>; })()} <span className="text-white/50 text-xs">Home Club</span></div>
                  <div className="flex items-center gap-2"><User className="w-4 h-4 text-white/60" /> <span>{season?.boat_info?.helm || profile.boat?.helm || "—"}</span></div>
                </div>
              </div>
            </div>

            {season && (
              <div className="w-full sm:w-48 rounded-2xl bg-white/10 border border-white/20 p-4 text-center" data-testid="overall-trophy-card">
                <div className="w-11 h-11 mx-auto rounded-full bg-amber-100 grid place-items-center"><Trophy className="w-6 h-6 text-amber-500" /></div>
                <div className="mt-2 font-heading text-3xl text-white leading-none">{ordinal(season.overall?.rank)}</div>
                <div className="text-[10px] uppercase tracking-widest text-white/70 mt-1">Overall Position</div>
                <div className="mt-2 font-heading uppercase tracking-wide text-white text-sm">{season.year} OVERALL</div>
                <div className="text-[11px] text-white/70 mt-0.5">(After {stats.races_total ?? 0} race{stats.races_total === 1 ? "" : "s"})</div>
              </div>
            )}
          </div>

          {years.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-widest font-semibold text-white/70">Season</span>
              {years.map((y) => (
                <button key={y} type="button" onClick={() => setYear(y)}
                  className={`px-4 py-1.5 rounded-xl font-heading uppercase tracking-wide text-sm transition-colors ${year === y ? "bg-safety text-white" : "bg-white/10 text-white hover:bg-white/20 border border-white/20"}`}>
                  {y}
                </button>
              ))}
            </div>
          )}
          {yearSeasons.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-widest font-semibold text-white/70">Fleet</span>
              {yearSeasons.map((s, i) => (
                <button key={`${s.club_name}-${s.class_name}`} type="button" onClick={() => setSeasonIdx(i)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors ${seasonIdx === i ? "bg-white text-ocean" : "bg-white/10 text-white/80 hover:bg-white/20"}`}>
                  {s.club_name} · {s.class_name}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap gap-1 border-b border-border mb-6" role="tablist" data-testid="boat-tabs">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)}
              data-testid={`boat-tab-${t.key}`}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold uppercase tracking-wide border-b-2 transition-colors ${tab === t.key ? "border-ocean text-ocean dark:text-ocean-light" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === "overall" && (
          <div className="space-y-8" data-testid="boat-overall">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg md:text-xl uppercase tracking-tight">Overall boat results</h2>
                <p className="text-sm text-muted-foreground mt-1">All published results for {profile.name}, across every club, class and fleet.</p>
              </div>
              <Badge variant="outline" className="border-ocean/30 text-ocean dark:text-ocean-light">{profile.career_overall?.fleets?.length || 0} fleets</Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard icon={<Flag className="w-4 h-4" />} label="Races Sailed" value={profile.career_overall?.stats?.races_sailed ?? "–"} />
              <StatCard icon={<Trophy className="w-4 h-4" />} label="Wins" value={profile.career_overall?.stats?.wins ?? "–"} />
              <StatCard icon={<Medal className="w-4 h-4" />} label="Podiums" value={profile.career_overall?.stats?.podiums ?? "–"} />
              <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Average Position" value={profile.career_overall?.stats?.avg_position ?? "–"} />
              <StatCard icon={<Percent className="w-4 h-4" />} label="Completion Rate" value={profile.career_overall?.stats?.completion_rate != null ? `${profile.career_overall.stats.completion_rate}%` : "–"} />
              <StatCard icon={<Star className="w-4 h-4" />} label="Average Points" value={profile.career_overall?.stats?.avg_points ?? "–"} />
            </div>

            <section>
              <h3 className="text-sm uppercase tracking-widest font-semibold mb-3">Fleet summary</h3>
              {(!profile.career_overall?.fleets || profile.career_overall.fleets.length === 0) ? (
                <p className="text-sm text-muted-foreground">No published results yet.</p>
              ) : (
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-ocean text-white text-left">
                        <th className="py-2.5 px-3 font-semibold">Club</th>
                        <th className="py-2.5 px-3 font-semibold">Class</th>
                        <th className="py-2.5 px-3 font-semibold">Year</th>
                        <th className="py-2.5 px-3 font-semibold text-center">Races</th>
                        <th className="py-2.5 px-3 font-semibold text-center">Wins</th>
                        <th className="py-2.5 px-3 font-semibold text-center">Podiums</th>
                        <th className="py-2.5 px-3 font-semibold text-center">Avg Pos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.career_overall.fleets.map((f, i) => (
                        <tr key={`${f.class_id}-${f.year}-${f.club_name}`} className={i % 2 ? "bg-muted/40" : "bg-card"}>
                          <td className="py-2.5 px-3 font-semibold">{f.club_name}</td>
                          <td className="py-2.5 px-3">{f.class_name}</td>
                          <td className="py-2.5 px-3">{f.year}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{f.races}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{f.wins}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{f.podiums}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{f.avg_position ?? "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-sm uppercase tracking-widest font-semibold">All race results</h3>
                <span className="text-xs text-muted-foreground">Total points are shown cumulatively; Net excludes discarded races.</span>
              </div>
              <RaceTable rows={profile.career_overall?.race_history || []} />
            </section>
          </div>
        )}

        {tab === "overview" && (
          <div className="space-y-10">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard icon={<Flag className="w-4 h-4" />} label="Races Sailed" value={stats.races_sailed ?? "–"} />
              <StatCard icon={<Trophy className="w-4 h-4" />} label="Wins" value={stats.wins ?? "–"} />
              <StatCard icon={<Medal className="w-4 h-4" />} label="Podiums" value={stats.podiums ?? "–"} />
              <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Average Position" value={stats.avg_position ?? "–"} />
              <StatCard icon={<Percent className="w-4 h-4" />} label="Completion Rate" value={stats.completion_rate != null ? `${stats.completion_rate}%` : "–"} />
              <StatCard icon={<Star className="w-4 h-4" />} label="Average Points" value={stats.avg_points ?? "–"} />
            </div>

            <section data-testid="current-standings">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-lg md:text-xl uppercase tracking-tight">Current Series Standings</h2>
                <div className="flex items-center gap-3">
                  <span className="font-heading uppercase text-sm text-muted-foreground">{season?.year} {season?.overall ? "Overall" : "—"}</span>
                  <Link to={standingsHref} className="inline-flex items-center gap-1 text-sm font-semibold text-ocean dark:text-ocean-light hover:underline">View full standings <ArrowRight className="w-3.5 h-3.5" /></Link>
                </div>
              </div>
              <div className="rounded-xl border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-ocean text-white text-left">
                      <th className="py-2.5 px-3 font-semibold">#</th>
                      <th className="py-2.5 px-3 font-semibold">Boat</th>
                      <th className="py-2.5 px-3 font-semibold">Races</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Total</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Net</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Leader</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Behind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(season?.standings_preview || []).map((r) => (
                      <tr key={r.rank} className={r.rank === 1 ? "bg-amber-50 dark:bg-amber-500/10" : (r.rank % 2 ? "bg-muted/40" : "bg-card")}>
                        <td className="py-2.5 px-3 text-center">
                          {r.rank === 1 ? <Trophy className="w-4 h-4 inline text-amber-500" /> : <span className="font-heading">{r.rank}</span>}
                        </td>
                        <td className="py-2.5 px-3 font-semibold">
                          {r.boat_name} <span className="font-mono text-xs text-muted-foreground">{r.sail_no}</span>
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground">{r.races}</td>
                        <td className="py-2.5 px-3 text-center font-mono">{r.total}</td>
                        <td className="py-2.5 px-3 text-center font-mono font-bold text-ocean dark:text-ocean-light">{r.net}</td>
                        <td className="py-2.5 px-3 text-center font-mono text-muted-foreground">{r.leader == null ? "–" : r.leader}</td>
                        <td className="py-2.5 px-3 text-center font-mono text-muted-foreground">{r.behind == null ? "–" : r.behind}</td>
                      </tr>
                    ))}
                    {(season?.standings_preview || []).length === 0 && (
                      <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No championship standings yet.</td></tr>
                    )}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground px-3 py-2 bg-muted/30">
                  Showing top {Math.min((season?.standings_preview || []).length, 3)} of {season?.overall?.entries ?? 0} boats · Positions are provisional until a season is locked.
                </p>
              </div>
            </section>

            <section data-testid="recent-results">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-lg md:text-xl uppercase tracking-tight">Recent Results</h2>
                <button type="button" onClick={() => setTab("results")} className="inline-flex items-center gap-1 text-sm font-semibold text-ocean dark:text-ocean-light hover:underline">View all results <ArrowRight className="w-3.5 h-3.5" /></button>
              </div>
              <RaceTable rows={(season?.race_history || []).slice(0, 6)} />
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><span className="inline-block w-3 text-center">(</span>) Discard</span>
                <span className="inline-flex items-center gap-1"><Info className="w-3 h-3" /> Results are provisional</span>
              </p>
            </section>

            <section className="grid md:grid-cols-3 gap-6">
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm uppercase tracking-widest font-semibold mb-3">Season Summary</h3>
                <dl className="divide-y divide-border text-sm">
                  {[["Races Sailed", stats.races_sailed], ["Wins", stats.wins], ["Seconds", stats.seconds], ["Thirds", stats.thirds],
                    ["Average Position", stats.avg_position], ["Average Points", stats.avg_points],
                    ["Best Result", stats.best], ["Worst Result", stats.worst != null ? `(${stats.worst})` : "–"], ["Discards", stats.discards]]
                    .map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between py-2">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="font-mono font-semibold">{v ?? "–"}</dd>
                      </div>
                    ))}
                </dl>
              </div>

              <div className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm uppercase tracking-widest font-semibold">Upcoming Races</h3>
                  <Link to={`/club/${season?.club_slug || ""}`} className="inline-flex items-center gap-1 text-xs font-semibold text-ocean dark:text-ocean-light hover:underline">View calendar <ArrowRight className="w-3 h-3" /></Link>
                </div>
                {(season?.upcoming || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No upcoming races scheduled.</p>
                ) : (
                  <ul className="space-y-2">
                    {(season?.upcoming || []).map((u, i) => (
                      <li key={i}>
                        <Link to={`/club/${season?.club_slug || ""}`} className="flex items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-muted transition-colors">
                          <div className="w-8 h-8 rounded-lg bg-ocean/10 grid place-items-center text-ocean dark:text-ocean-light shrink-0"><CalendarDays className="w-4 h-4" /></div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold truncate">{u.series_name} — Race {u.race_number}</div>
                            <div className="text-xs text-muted-foreground">{fmtDay(u.date)}</div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm uppercase tracking-widest font-semibold mb-3">Boat Information</h3>
                <dl className="divide-y divide-border text-sm">
                  {[["Boat Name", season?.boat_info?.name], ["Sail Number", season?.boat_info?.sail_no], ["Class", season?.class_name],
                    ["Home Club", season?.boat_info?.home_club], ["Owner / Helm", season?.boat_info?.helm],
                    ["Design", season?.boat_info?.boat_type], ["Yardstick", season?.boat_info?.py], ["TCC", season?.boat_info?.tcc]]
                    .map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3 py-2">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="font-semibold text-right">{v ?? "—"}</dd>
                      </div>
                    ))}
                </dl>
                <Link to={standingsHref} className="mt-3">
                  <Button variant="outline" size="sm" className="w-full gap-2 border-ocean text-ocean"><Pencil className="w-3.5 h-3.5" /> Edit Boat Details</Button>
                </Link>
              </div>
            </section>
          </div>
        )}

        {tab === "results" && (
          <section>
            <h2 className="text-lg md:text-xl uppercase tracking-tight mb-3">{season?.year} Race Results</h2>
            <RaceTable rows={season?.race_history || []} />
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><Info className="w-3 h-3" /> ( ) Discard</span>
              <span>Results are provisional</span>
            </p>
          </section>
        )}

        {tab === "series" && (
          <div className="space-y-10">
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
                        <th className="py-2.5 px-4 font-semibold text-center">Total</th>
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
                            <td className="py-2 px-4 text-center font-heading text-base whitespace-nowrap">{o.rank}<span className="text-muted-foreground font-normal text-sm"> / {o.entries ?? "–"}</span></td>
                            <td className="py-2 px-4 text-center font-mono font-bold text-ocean dark:text-ocean-light">{o.total}</td>
                            <td className="py-2 px-4 text-center font-mono text-muted-foreground">{o.net}</td>
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
          </div>
        )}

        {tab === "history" && (
          <section>
            <h2 className="text-lg md:text-xl uppercase tracking-tight mb-3 flex items-center gap-2">
              <History className="w-5 h-5 text-ocean dark:text-ocean-light" /> Race history
            </h2>
            {allHistory.length === 0 ? (
              <p className="text-muted-foreground text-sm">No race results yet.</p>
            ) : (
              <>
                <RaceTable rows={allHistory.slice(0, 30)} />
                {allHistory.length > 30 && <p className="text-xs text-muted-foreground mt-2">Showing the 30 most recent races.</p>}
              </>
            )}
          </section>
        )}

        {tab === "details" && (
          <section className="max-w-2xl">
            <h2 className="text-lg md:text-xl uppercase tracking-tight mb-4 flex items-center gap-2">
              <Sailboat className="w-5 h-5 text-ocean dark:text-ocean-light" /> Boat details
            </h2>
            <div className="rounded-xl border border-border p-5">
              <dl className="divide-y divide-border text-sm">
                {[["Boat Name", season?.boat_info?.name || profile.name], ["Sail Number", season?.boat_info?.sail_no || profile.sail_no],
                  ["Class", season?.class_name || "—"], ["Home Club", season?.boat_info?.home_club || "—"],
                  ["Owner / Helm", season?.boat_info?.helm || "—"], ["Design", season?.boat_info?.boat_type || "—"],
                  ["Yardstick", season?.boat_info?.py ?? "—"], ["TCC", season?.boat_info?.tcc ?? "—"]]
                  .map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-semibold text-right">{v ?? "—"}</dd>
                    </div>
                  ))}
              </dl>
            </div>
            <div className="mt-5">
              <h3 className="text-sm uppercase tracking-widest font-semibold mb-3">Club records</h3>
              <div className="flex flex-wrap gap-2">
                {profile.records.map((r) => (
                  <Link key={r.boat_id} to={`/club/${r.club_slug}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-ocean/30 bg-ocean/5 px-3 py-1 text-xs font-semibold text-ocean dark:text-ocean-light hover:bg-ocean/10 transition-colors">
                    <Anchor className="w-3 h-3" /> {r.club_name} · {r.class_name} {r.year}
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <Logo className="h-8 w-auto mx-auto" />
        <p className="mt-2">{SITE_TAGLINE}</p>
      </footer>
    </div>
  );
}
