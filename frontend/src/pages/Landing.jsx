import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Marquee from "react-fast-marquee";
import { api } from "@/lib/api";
import { fmtDate, fmtSeconds, elapsedSecondsOf, correctedSecondsOf, CURRENT_YEAR, MAX_YEAR, CODE_COLORS } from "@/lib/helpers";
import YearSwitcher from "@/components/YearSwitcher";
import { SeriesStandingsTable, OverallStandingsTable } from "@/components/StandingsTable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AdvertCard, { useAdverts, pickAdverts } from "@/components/AdvertCard";
import ThemeToggle from "@/components/ThemeToggle";
import { exportSeriesPdf, exportOverallPdf } from "@/lib/exportPdf";
import { Anchor, LifeBuoy, Clock, Flag, FlagOff, LogIn, Sailboat, AlertTriangle, ArrowLeft, Download } from "lucide-react";

function NotificationBanner({ items }) {
  if (!items.length) return null;
  return (
    <div className="bg-safety text-white" data-testid="notification-banner">
      <Marquee gradient={false} speed={55} pauseOnHover className="py-2.5">
        {items.map((n, idx) => (
          <span key={idx} className="mx-8 inline-flex items-center gap-2 font-bold tracking-wider uppercase text-sm">
            <Flag className="w-4 h-4" /> {n.class_name}
            {n.start_time && <><Clock className="w-4 h-4 ml-3" /> Start {n.start_time}</>}
            {n.course && <span className="ml-3">Course: {n.course}</span>}
            {n.special_rules && <span className="ml-3">⚑ {n.special_rules}</span>}
            {n.life_jackets && <span className="ml-3 inline-flex items-center gap-1"><LifeBuoy className="w-4 h-4" /> LIFE JACKETS REQUIRED</span>}
          </span>
        ))}
      </Marquee>
    </div>
  );
}

function PublishedRaces({ seriesId, classId, clubId, scoringMode = "one_design" }) {
  const [races, setRaces] = useState([]);
  const [boats, setBoats] = useState({});

  useEffect(() => {
    api.getRaces({ series_id: seriesId, status: "published", club_id: clubId }).then(setRaces);
    api.getBoats({ class_id: classId, club_id: clubId }).then((bs) => {
      const m = {}; bs.forEach((b) => (m[b.id] = b)); setBoats(m);
    });
  }, [seriesId, classId, clubId]);

  if (!races.length) return null;
  const sorted = [...races].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <Accordion type="single" collapsible className="mt-6" data-testid="published-races-accordion">
      {sorted.map((race) => {
        const rows = [...race.results].sort((a, b) => {
          if (a.code === "FINISHED" && b.code === "FINISHED") return a.position - b.position;
          if (a.code === "FINISHED") return -1;
          if (b.code === "FINISHED") return 1;
          return 0;
        });
        return (
          <AccordionItem key={race.id} value={race.id} className="border rounded-xl mb-3 px-4 bg-card">
            <AccordionTrigger className="hover:no-underline" data-testid={`race-folder-${race.id}`}>
              <div className="flex items-center gap-3 text-left">
                <div className={`w-10 h-10 rounded-lg grid place-items-center font-heading text-lg ${race.abandoned ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" : "bg-ocean/10 text-ocean"}`}>
                  {race.abandoned ? <FlagOff className="w-5 h-5" /> : `R${race.race_number}`}
                </div>
                <div>
                  <div className="font-semibold flex items-center gap-2">Race {race.race_number}
                    {race.abandoned && <Badge className="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">Abandoned</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{fmtDate(race.date)}</div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              {race.abandoned ? (
                <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-4 text-sm text-red-700 dark:text-red-300 flex items-start gap-2" data-testid={`race-abandoned-${race.id}`}>
                  <FlagOff className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Race abandoned</div>
                    <p className="text-xs mt-0.5">This race was abandoned on the day and does not count towards the series — the series is scored as if this weekend never took place.</p>
                  </div>
                </div>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 w-10">Pos</th><th>Boat</th><th>Club</th><th>Helm</th><th className="text-center">Code</th>
                      {scoringMode !== "one_design" && <><th>{scoringMode === "py" ? "PY" : "Type"}</th><th className="text-right">Elapsed</th><th className="text-right">Corrected</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const b = boats[r.boat_id] || {};
                      return (
                        <tr key={r.boat_id} className="border-b last:border-0">
                          <td className="py-2 font-heading text-base">{r.code === "FINISHED" ? r.position : "–"}</td>
                          <td><span className="font-semibold">{b.name}</span> <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span></td>
                          <td className="text-muted-foreground whitespace-nowrap">{b.home_club || "—"}</td>
                          <td className="text-muted-foreground">{b.helm}</td>
                          <td className="text-center"><Badge variant="outline" className={`${CODE_COLORS[r.code] || ""} text-[10px]`}>{r.code}</Badge></td>
                          {scoringMode !== "one_design" && <>
                            <td className="text-muted-foreground">{scoringMode === "py" ? (b.py ? Math.round(b.py) : "—") : (b.boat_type || "—")}</td>
                            <td className="text-right font-mono text-xs">{r.code === "FINISHED" ? fmtSeconds(elapsedSecondsOf(r.finish_time, race)) : "—"}</td>
                            <td className="text-right font-mono text-xs">{r.code === "FINISHED" ? fmtSeconds(correctedSecondsOf(r.finish_time, race, scoringMode === "py" ? b.py : b.tcc, scoringMode)) : "—"}</td>
                          </>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

// Presentational: renders the standings content for the class/series chosen
// in the hero. All fetching lives in the Landing page so the selector tabs can
// sit in the banner.
function ClassResults({ classId, clubId, year, clubName, className, clubIcon, series, activeSeries, activeMini, setActiveMini, overall, seriesData }) {
  const hasData = series.length > 0 || (overall && overall.standings?.length > 0);

  if (year !== CURRENT_YEAR && !hasData) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-border bg-card/50 p-8 text-center" data-testid="no-results-year">
        <p className="font-heading text-xl uppercase tracking-tight">No results recorded for {year} yet</p>
        <p className="text-muted-foreground text-sm mt-1">
          {year > CURRENT_YEAR
            ? `The ${year} season hasn't started — series and results will appear here once set up.`
            : "Nothing was raced in this season — switch back to the current year to see live results."}
        </p>
      </div>
    );
  }

  const active = series.find((s) => s.id === activeSeries);

  if (activeSeries === "overall" || !active) {
    return (
      <div className="pt-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-xl uppercase tracking-tight flex items-center gap-2"><Sailboat className="w-5 h-5 text-ocean" /> Overall Championship</h3>
          <Button variant="outline" size="sm" data-testid="export-overall-pdf"
            className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white shrink-0"
            disabled={!overall?.standings?.length}
            onClick={() => exportOverallPdf({ clubName, className, year, data: overall, icon: clubIcon })}>
            <Download className="w-4 h-4" /> PDF
          </Button>
        </div>
        <OverallStandingsTable data={overall} />
      </div>
    );
  }

  // Mini-series feature: the full standings payload carries the named groups,
  // and each mini view is keyed separately so it can be fetched independently.
  const miniMeta = active.mini_series ? seriesData[active.id]?.mini_series : null;
  const groups = (miniMeta && miniMeta.groups) || [];
  const dataKey = activeMini ? `${active.id}:m${activeMini}` : active.id;
  const miniData = seriesData[dataKey];
  const activeGroup = activeMini ? groups[activeMini - 1] : null;
  const miniLabel = activeGroup ? ` · ${activeGroup.name}` : "";
  const miniRange = (g) => {
    const nums = g.race_numbers || [];
    if (!nums.length) return "";
    if (nums.length === 1) return `R${nums[0]}`;
    const contig = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    return contig ? `R${nums[0]}–${nums[nums.length - 1]}` : `R${nums.join(",")}`;
  };

  return (
    <div className="pt-5">
      {groups.length > 1 && (
        <div className="flex items-center gap-2 mb-4" data-testid="mini-series-tabs">
          <span className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">Split</span>
          <Tabs value={activeMini ? String(activeMini) : "overall"} onValueChange={(v) => setActiveMini(v === "overall" ? null : Number(v))}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="overall" data-testid="mini-tab-overall"
                className="px-3 py-1.5 rounded-lg border border-ocean/30 text-ocean data-[state=active]:bg-ocean data-[state=active]:text-white font-heading uppercase tracking-wide text-sm">
                Overall
              </TabsTrigger>
              {groups.map((g, i) => (
                <TabsTrigger key={i} value={String(i + 1)} data-testid={`mini-tab-${i + 1}`}
                  className="px-3 py-1.5 rounded-lg border border-ocean/30 text-ocean data-[state=active]:bg-ocean data-[state=active]:text-white font-heading uppercase tracking-wide text-sm">
                  {g.name}{miniRange(g) ? ` · ${miniRange(g)}` : ""}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xl uppercase tracking-tight">{active.name} Series{miniLabel}</h3>
        <Button variant="outline" size="sm" data-testid={`export-pdf-${active.id}`}
          className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white shrink-0"
          disabled={!miniData?.standings?.length}
          onClick={() => exportSeriesPdf({ clubName, className, seriesName: `${active.name}${miniLabel}`, year: active.year || year, data: miniData, icon: clubIcon })}>
          <Download className="w-4 h-4" /> PDF
        </Button>
      </div>
      <SeriesStandingsTable data={miniData} />
      <PublishedRaces seriesId={active.id} classId={classId} clubId={clubId} scoringMode={active.scoring_mode || "one_design"} />
    </div>
  );
}

export default function Landing() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const yearParam = Number(searchParams.get("year"));
  const year = Number.isInteger(yearParam) && yearParam > 2000 && yearParam <= MAX_YEAR ? yearParam : CURRENT_YEAR;
  const setYear = (y) => setSearchParams(y === CURRENT_YEAR ? {} : { year: String(y) });
  const [club, setClub] = useState(null);
  const [loadingClub, setLoadingClub] = useState(true);
  const [classes, setClasses] = useState([]);
  const [activeClass, setActiveClass] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const { adverts, roll } = useAdverts();
  const [series, setSeries] = useState([]);
  const [activeSeries, setActiveSeries] = useState("overall");
  const [activeMini, setActiveMini] = useState(null);
  const [overall, setOverall] = useState(null);
  const [seriesData, setSeriesData] = useState({});

  useEffect(() => {
    api.getClubs().then((cs) => {
      const found = (cs || []).find((c) => c.slug === slug) || (cs || [])[0];
      setClub(found || null);
      setLoadingClub(false);
    }).catch(() => setLoadingClub(false));
  }, [slug]);

  const clubId = club?.id;

  useEffect(() => {
    if (!clubId) return;
    api.getClasses({ club_id: clubId }).then((c) => { setClasses(c); if (c[0]) setActiveClass(c[0].id); });
    const load = () => {
      api.getNotifications({ club_id: clubId }).then(setNotifications).catch(() => {});
      // Keep the future-year buttons current when the admin sets up a new season.
      api.getSeasons(clubId).then((d) => setSeasons(d?.years || [])).catch(() => {});
    };
    load();
    const t = setInterval(load, 20000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [clubId]);

  // Series + standings for the active class (drives the selector tabs in the
  // hero and the results content below).
  useEffect(() => {
    if (!clubId || !activeClass) return;
    setSeries([]); setOverall(null); setSeriesData({}); setActiveSeries("overall"); setActiveMini(null);
    api.getSeries({ class_id: activeClass, year, club_id: clubId }).then(setSeries).catch(() => {});
    api.overallStandings(activeClass, year, clubId).then(setOverall).catch(() => setOverall(null));
  }, [clubId, activeClass, year]);

  useEffect(() => { setActiveMini(null); }, [activeSeries]);

  useEffect(() => {
    if (!clubId || !activeClass || activeSeries === "overall") return;
    if (seriesData[activeSeries]) return;
    api.seriesStandings(activeSeries, clubId)
      .then((d) => setSeriesData((prev) => ({ ...prev, [activeSeries]: d })))
      .catch(() => {});
  }, [clubId, activeClass, activeSeries, seriesData]);

  // Mini-series views: standings over one consecutive chunk of the series' races.
  useEffect(() => {
    if (!clubId || !activeClass || activeSeries === "overall" || !activeMini) return;
    const key = `${activeSeries}:m${activeMini}`;
    if (seriesData[key]) return;
    api.seriesStandings(activeSeries, clubId, activeMini)
      .then((d) => setSeriesData((prev) => ({ ...prev, [key]: d })))
      .catch(() => {});
  }, [clubId, activeClass, activeSeries, activeMini, seriesData]);

  // Future years only appear once this club has set up a series for them.
  // Future years are data-driven: any year a club has set a series up for.
  const futureYears = seasons.filter((y) => y > CURRENT_YEAR);

  if (loadingClub) {
    return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading…</div>;
  }
  if (!club) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">
        <div className="text-center space-y-3">
          <p>Club not found.</p>
          <Link to="/"><Button variant="outline" className="gap-2 border-ocean text-ocean"><ArrowLeft className="w-4 h-4" /> Back to all clubs</Button></Link>
        </div>
      </div>
    );
  }

  const sideAdverts = pickAdverts(adverts, 3, roll);
  return (
    <div className="min-h-screen bg-background">
      <NotificationBanner items={notifications} />

      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-ocean grid place-items-center"><Anchor className="w-5 h-5 text-white" /></div>
            <div className="font-heading text-xl uppercase tracking-tight leading-none">{club.name}</div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-ocean" data-testid="all-clubs-btn">
                <ArrowLeft className="w-4 h-4" /> All clubs
              </Button>
            </Link>
            <Link to={`/login?club=${club.slug}`}>
              <Button variant="outline" size="sm" data-testid="officials-login-btn" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white">
                <LogIn className="w-4 h-4" /> Officials
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="relative">
        <img
          src="https://images.unsplash.com/photo-1613578699399-82ae71be53a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwxfHxzYWlsYm9hdCUyMHJhY2luZyUyMHJlZ2F0YXR8ZW58MHx8fHwxNzg2MTI3MTgxfDA&ixlib=rb-4.1.0&q=85"
          alt="racing" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 hero-overlay" />
        <div className="relative max-w-6xl mx-auto px-4 py-6 md:py-8">
          <Badge className={`mb-3 uppercase tracking-widest ${year === CURRENT_YEAR ? "bg-safety text-white" : "bg-white/20 text-white border border-white/40"}`} data-testid="season-badge">
            {year} Season
          </Badge>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl uppercase tracking-tighter text-white leading-[0.95] max-w-3xl">
            {club.name} · {year === CURRENT_YEAR ? "live" : year} results & standings
          </h1>
          <p className="text-white/80 mt-3 max-w-xl leading-relaxed">
            Follow every fleet across the season. Provisional and confirmed results, series championships and race-day notices — all in one place.
          </p>
          <YearSwitcher grouped value={year} onChange={setYear} years={[CURRENT_YEAR - 1, ...futureYears]} className="mt-4"
            labels={{ past: "Past Results", current: "Current Results", future: "Future Series" }} />

          {classes.length > 0 && (
            <div className="mt-5 flex flex-col items-center gap-1.5" data-testid="class-tabs">
              <span className="text-white/70 text-[11px] uppercase tracking-widest font-semibold">Class</span>
              <Tabs value={activeClass || undefined} onValueChange={setActiveClass}>
                <TabsList className="flex flex-wrap h-auto gap-2 w-fit">
                  {classes.map((c) => (
                    <TabsTrigger key={c.id} value={c.id}
                      data-testid={`class-tab-${c.name}`}
                      className="px-5 py-2.5 rounded-xl border border-black/50 bg-white/60 text-black hover:bg-white/80 data-[state=active]:bg-safety data-[state=active]:text-white data-[state=active]:border-safety font-heading uppercase tracking-wide">
                      {c.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}

          {activeClass && series.length > 0 && (
            <div className="mt-4 flex flex-col items-center gap-1.5" data-testid="series-tabs">
              <span className="text-white/70 text-[11px] uppercase tracking-widest font-semibold">Series</span>
              <Tabs value={activeSeries} onValueChange={setActiveSeries}>
                <TabsList className="flex flex-wrap h-auto gap-2 w-fit">
                  <TabsTrigger value="overall"
                    className="px-4 py-2 rounded-xl border border-black/50 bg-white/60 text-black hover:bg-white/80 data-[state=active]:bg-safety data-[state=active]:text-white data-[state=active]:border-safety font-heading uppercase tracking-wide">
                    Overall
                  </TabsTrigger>
                  {series.map((s) => (
                  <TabsTrigger key={s.id} value={s.id}
                    className="px-4 py-2 rounded-xl border border-black/50 bg-white/60 text-black hover:bg-white/80 data-[state=active]:bg-safety data-[state=active]:text-white data-[state=active]:border-safety font-heading uppercase tracking-wide">
                      {s.name}{!s.included_in_overall && <span className="ml-1 text-[10px] opacity-70">(excl.)</span>}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 py-10">
        {notifications.length > 0 && (
          <div className="mb-10" data-testid="raceday-notice">
            <div className="flex items-center gap-2 mb-4">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-safety opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-safety"></span>
              </span>
              <h2 className="font-heading uppercase tracking-tight text-safety text-xl">Racing today</h2>
              <span className="text-xs text-muted-foreground">· clears once results are published</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
              {notifications.map((n, idx) => (
                <div key={idx} data-testid={`notice-card-${n.class_name}`}
                  className="rounded-xl border border-safety/30 bg-safety/5 p-4 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-safety" />
                  <div className="flex items-center justify-between mb-3 pl-2">
                    <div className="font-heading uppercase tracking-tight text-lg">{n.class_name}</div>
                    {n.start_time && (
                      <div className="flex items-center gap-1.5 font-mono font-bold text-ocean">
                        <Clock className="w-4 h-4" /> {n.start_time}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 text-sm pl-2">
                    {n.course && (
                      <div className="flex items-start gap-2">
                        <Flag className="w-4 h-4 text-safety mt-0.5 shrink-0" />
                        <div><span className="text-muted-foreground">Course: </span><span className="font-semibold">{n.course}</span></div>
                      </div>
                    )}
                    {n.special_rules && (
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-safety mt-0.5 shrink-0" />
                        <div><span className="text-muted-foreground">Rules: </span><span className="font-semibold">{n.special_rules}</span></div>
                      </div>
                    )}
                    {n.life_jackets && (
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className="bg-safety text-white gap-1.5"><LifeBuoy className="w-3.5 h-3.5" /> Life jackets required</Badge>
                      </div>
                    )}
                    {!n.course && !n.special_rules && !n.life_jackets && (
                      <div className="text-muted-foreground italic">Details to follow — watch this space.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg md:text-lg uppercase tracking-tight mb-1">Results by class</h2>
                <p className="text-muted-foreground text-sm">Each fleet races its own series and overall championship.</p>
              </div>
              {/* Sponsor adverts sit beside the section heading, on the right. */}
              {sideAdverts.length > 0 && (
                <div className="flex flex-wrap gap-4" data-testid="section-adverts">
                  {sideAdverts.map((a) => (
                    <div key={a.id} className="w-48 md:w-56">
                      <AdvertCard advert={a} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {classes.length === 0 ? (
              <p className="text-muted-foreground">No classes set up yet.</p>
            ) : !activeClass ? (
              <p className="text-muted-foreground">Loading classes…</p>
            ) : (
              <ClassResults
                classId={activeClass}
                clubId={clubId}
                year={year}
                clubName={club.name}
                className={(classes.find((c) => c.id === activeClass) || {}).name}
                clubIcon={club.icon}
                series={series}
                activeSeries={activeSeries}
                activeMini={activeMini}
                setActiveMini={setActiveMini}
                overall={overall}
                seriesData={seriesData}
              />
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <div className="font-heading uppercase tracking-tight">SailScore</div>
        <p className="mt-1">Connecting sailing, one club at a time.</p>
        <p className="mt-2 text-xs">
          Website by L Hopper · Queries to{" "}
          <a href="mailto:admin@sailscore.co.uk" className="underline decoration-border underline-offset-2 hover:text-foreground transition-colors">admin@sailscore.co.uk</a>
        </p>
      </footer>
    </div>
  );
}
