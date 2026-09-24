import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Marquee from "react-fast-marquee";
import { api } from "@/lib/api";
import { fmtDate, CURRENT_YEAR, MAX_YEAR, divisionTables } from "@/lib/helpers";
import YearSwitcher from "@/components/YearSwitcher";
import { SeriesStandings, OverallStandings } from "@/components/StandingsTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AdvertCard, { useAdverts, pickAdverts } from "@/components/AdvertCard";
import HeaderMenu from "@/components/HeaderMenu";
import OfficialsLink from "@/components/OfficialsLink";
import CopyLinkButton from "@/components/CopyLinkButton";
import { exportSeriesPdf, exportOverallPdf } from "@/lib/exportPdf";
import { SAILSCORE_EVENTS, trackEvent, useTrackView } from "@/lib/analytics";
import { SITE_TAGLINE, SITE_OWNER, SITE_CONTACT_EMAIL } from "@/lib/siteConfig";
import { seriesNavModel } from "@/lib/seriesNav";
import { LifeBuoy, Clock, Flag, Sailboat, AlertTriangle, ArrowLeft, Download, CalendarDays, MapPin, ArrowRight, Trophy } from "lucide-react";
import Logo from "@/components/Logo";
import BoatSearchBox from "@/components/BoatSearchBox";
import ResultsSubscription from "@/components/ResultsSubscription";
import PublishedRaces from "@/components/PublishedRaces";
import { competitionImage, competitionPath, competitionStatusClass, competitionStatusLabel, competitionTagClass, competitionType, competitionTypeLabel } from "@/lib/competition";
import Breadcrumbs from "@/components/Breadcrumbs";

function CompetitionCard({ competition, clubSlug, onSelect, selected = false, compact = false }) {
  const isChampionship = competitionType(competition) !== "regatta";
  const typeLabel = competitionTypeLabel(competition);
  const cardClass = `group overflow-hidden rounded-[1.35rem] border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-ocean/40 hover:shadow-lg ${selected ? "border-safety ring-2 ring-safety/20" : "border-border"} ${compact ? "" : "h-full"}`;
  const body = (
    <>
      <div className={`${compact ? "h-28" : "h-36 sm:h-40"} relative overflow-hidden bg-ocean/10`}>
        <img src={competitionImage(competition)} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" style={{ filter: "saturate(.9) contrast(1.04)" }} />
        <div className="absolute inset-0 bg-ocean/20 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#071d55]/85 via-[#0a369d]/15 to-transparent" />
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2">
          <Badge className={`gap-1.5 rounded-full border px-3 py-1 text-xs shadow-sm ${competitionTagClass(competition)}`}>
            {isChampionship ? <Trophy className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
            {typeLabel}
          </Badge>
          <Badge className={`rounded-full border px-3 py-1 text-xs font-semibold shadow-sm ${competitionStatusClass()}`}>{competitionStatusLabel(competition)}</Badge>
        </div>
      </div>
      <div className={`${compact ? "p-4" : "p-5"}`}>
        <h3 className="font-heading text-xl uppercase leading-none tracking-tight text-ocean sm:text-2xl">{competition?.name}</h3>
        <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          {competition?.date_label && <span className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ocean" />{competition.date_label}</span>}
          {competition?.host_club && <span className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ocean" />{competition.host_club}</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-foreground">
          <span>{competition?.class_count || 0} {Number(competition?.class_count) === 1 ? "class" : "classes"}</span>
          <span className="text-border">·</span>
          <span>{competition?.race_count || 0} {Number(competition?.race_count) === 1 ? "race" : "races"}</span>
        </div>
        {(competition?.classes || []).length > 0 && (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{competition.classes.join(" · ")}</p>
        )}
        <div className="mt-5 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ocean group-hover:text-safety">
          View {isChampionship ? "championship" : "event"} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </>
  );

  if (clubSlug) {
    return <Link to={competitionPath(competition, clubSlug)} className={cardClass} data-testid={`${isChampionship ? "championship" : "regatta"}-card-${competition.name}`}>{body}</Link>;
  }
  return <button type="button" onClick={onSelect} className={`${cardClass} w-full text-left`} data-testid={`${isChampionship ? "championship" : "regatta"}-card-${competition.name}`}>{body}</button>;
}

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

// Presentational: renders the standings content for the class/series chosen
// in the hero. All fetching lives in the Landing page so the selector tabs can
// sit in the banner.
function ClassResults({ classId, clubId, clubSlug, year, clubName, className, clubIcon, series, activeSeries, overall, seriesData, adverts }) {
  const hasData = series.length > 0 || (overall && overall.standings?.length > 0);

  // Shareable permalink for the results currently shown. The class/series
  // tabs keep their choice in component state only, so the canonical deep
  // link is rebuilt here from the current selection (the Landing page reads
  // these ?class=/?series=/?year= params on load).
  const shareUrl = (() => {
    const params = new URLSearchParams();
    params.set("class", classId);
    if (activeSeries && activeSeries !== "overall") params.set("series", activeSeries);
    if (year !== CURRENT_YEAR) params.set("year", String(year));
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  })();

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
          <div className="flex items-center gap-2 shrink-0">
            <CopyLinkButton url={shareUrl} />
            <Button variant="outline" size="sm" data-testid="export-overall-pdf"
              className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white shrink-0"
              disabled={!overall?.standings?.length}
              onClick={() => {
                exportOverallPdf({ clubName, className, year, data: overall, icon: clubIcon, adverts });
                trackEvent(SAILSCORE_EVENTS.DOWNLOAD_RESULTS_PDF, {
                  class_name: className, club: clubName, view: "overall",
                });
              }}>>
              <Download className="w-4 h-4" /> PDF
            </Button>
          </div>
        </div>
        <OverallStandings data={overall} />
      </div>
    );
  }

  // A split race is already represented in the main standings payload as a
  // single combined column, so the public series view does not need a second
  // "SPLIT / OVERALL / mini series" navigation section.
  const miniData = seriesData[active.id];

  return (
    <div className="pt-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xl uppercase tracking-tight">{active.name} Series</h3>
        <div className="flex items-center gap-2 shrink-0">
          <CopyLinkButton url={shareUrl} />
          <Button variant="outline" size="sm" data-testid={`export-pdf-${active.id}`}
            className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white shrink-0"
            disabled={!miniData?.standings?.length}
            onClick={() => {
              exportSeriesPdf({ clubName, className,                seriesName: active.name, year: active.year || year, data: miniData, icon: clubIcon, adverts });
              trackEvent(SAILSCORE_EVENTS.DOWNLOAD_SERIES_PDF, {
                series_id: active.id,
                series_name: active.name,
                class_name: className,
                club: clubName,
              });
            }}>
            <Download className="w-4 h-4" /> PDF
          </Button>
        </div>
      </div>
      {miniData && miniData.standings?.length > 0 && (() => {
        const races = miniData.races || [];
        const planned = active.planned_races || 0;
        const completed = races.length;
        const remaining = Math.max(0, planned - completed);
        const tables = divisionTables(miniData);
        const boats = tables.reduce((n, table) => n + (table.standings || []).length, 0);
        const leader = tables[0]?.standings?.[0];
        return (
          <div className="mb-4 grid grid-cols-3 gap-3" data-testid="series-stats">
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1">Races</div>
              <div className="font-heading text-2xl text-ocean">{completed}{remaining > 0 && <span className="text-sm text-muted-foreground"> / {planned}</span>}</div>
              <div className="text-[10px] text-muted-foreground">{completed} sailed · {remaining} remaining</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1">Boats</div>
              <div className="font-heading text-2xl text-ocean">{boats}</div>
              <div className="text-[10px] text-muted-foreground">competing</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1">Leader</div>
              <div className="font-heading text-lg text-ocean truncate" title={leader?.boat_name}>{leader?.boat_name || "—"}</div>
              <div className="text-[10px] text-muted-foreground">{tables.length > 1 ? `${tables[0].division_name} · ` : ""}{leader?.net != null ? `${leader.net} pts` : ""}</div>
            </div>
          </div>
        );
      })()}
      <SeriesStandings data={miniData} />
      <PublishedRaces seriesId={active.id} series={active} classId={classId} clubId={clubId} clubSlug={clubSlug} scoringMode={active.scoring_mode || "one_design"} />
    </div>
  );
}

// The racing categories, with the icon each one is browsed by.
const VIEW_LEVELS = {
  club_championship: { label: "Club Championship", Icon: Trophy },
  championship: { label: "Championship", Icon: Trophy },
  regattas: { label: "Regattas", Icon: CalendarDays },
};

// The hero's tab strip: the siblings at the level being browsed. The same
// trigger styling the rest of the page uses, on the hero photo.
const HERO_CHIP = "px-5 py-2 rounded-xl border font-heading uppercase tracking-wide transition-colors";
const HERO_CHIP_REST = "border-black/50 dark:border-white/40 bg-white/60 text-black hover:bg-white/80 dark:bg-white/15 dark:text-white dark:hover:bg-white/25";
const HERO_CHIP_CURRENT = "border-safety bg-safety text-white";

export default function Landing() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const yearParam = Number(searchParams.get("year"));
  const year = Number.isInteger(yearParam) && yearParam > 2000 && yearParam <= MAX_YEAR ? yearParam : CURRENT_YEAR;
  const setYear = (y) => {
    const p = new URLSearchParams(searchParams);
    if (y === CURRENT_YEAR) p.delete("year"); else p.set("year", String(y));
    setSearchParams(p);
  };
  const [club, setClub] = useState(null);
  const [loadingClub, setLoadingClub] = useState(true);
  const [classes, setClasses] = useState([]);
  const [activeClass, setActiveClass] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const { adverts, roll } = useAdverts();
  const [series, setSeries] = useState([]);
  const [activeSeries, setActiveSeries] = useState("overall");
  // Deep link from the site search: a ?series= id preselects that series on
  // first load (applied once the series list arrives; consumed after).
  const seriesParamRef = useRef(searchParams.get("series"));
  const [overall, setOverall] = useState(null);
  const [seriesData, setSeriesData] = useState({});
  const [regattas, setRegattas] = useState([]);
  const [clubSeries, setClubSeries] = useState([]);
  // Two ways to browse the year: the club's championships (class → series →
  // results) or its regattas (regatta → the classes that raced in it).
  const [view, setView] = useState("championship");
  const [regattaId, setRegattaId] = useState(null);
  const [regattaDetail, setRegattaDetail] = useState(null);
  const [activeRegattaClass, setActiveRegattaClass] = useState(null);
  const [activeRegattaSeries, setActiveRegattaSeries] = useState(null);
  const [regattaSeriesData, setRegattaSeriesData] = useState({});
  // Progressive disclosure in the hero: the levels (category → class → series,
  // or category → regatta → class → series) are revealed one at a time, and
  // each committed level collapses to a chip, so the results stay hidden until
  // the reader has clicked their way down to them. A deep link that names a
  // class or series opens with every level already committed.
  const [depth, setDepth] = useState(searchParams.get("class") || searchParams.get("series") ? Infinity : 0);
  // Both above are the browse path: category → class → series (or regatta →
  // class → series), with a breadcrumb going up and a tab strip for the
  // siblings at the level being browsed.

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
    api.getClasses({ club_id: clubId }).then((c) => {
      setClasses(c);
      // A ?class= param (e.g. from a boat career page) preselects that class;
      // otherwise the first class is the default.
      const wanted = searchParams.get("class");
      if (wanted && c.some((x) => x.id === wanted)) setActiveClass(wanted);
      else if (c[0]) setActiveClass(c[0].id);
    });
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
  }, [clubId, searchParams]);

  // Series + standings for the active class (drives the selector tabs in the
  // hero and the results content below).
  useEffect(() => {
    if (!clubId || !activeClass) return;
    setSeries([]); setOverall(null); setSeriesData({}); setActiveSeries("overall");
    api.getSeries({ class_id: activeClass, year, club_id: clubId }).then(setSeries).catch(() => {});
    api.overallStandings(activeClass, year, clubId).then(setOverall).catch(() => setOverall(null));
  }, [clubId, activeClass, year]);

  // Regattas are club-wide racing occasions (across classes), independent of
  // the active class — load them for the selected year once.
  useEffect(() => {
    if (!clubId) return;
    api.getRegattas({ year, club_id: clubId }).then(setRegattas).catch(() => setRegattas([]));
  }, [clubId, year]);

  // Club-wide series for the year: tells us whether this club runs
  // championships at all (vs. racing only regattas). Independent of the
  // active class, since a single class may only race regattas while others
  // race championships.
  useEffect(() => {
    if (!clubId) return;
    api.getSeries({ year, club_id: clubId }).then(setClubSeries).catch(() => setClubSeries([]));
  }, [clubId, year]);

  // Split the year's results into the three user-facing racing categories.
  // Linked series belong to Regattas; standalone series retain their explicit
  // Championship or Club Championship type.
  const regattaComps = regattas.filter((r) => (r.competition_type || "regatta") !== "championship");
  const championshipComps = regattas.filter((r) => (r.competition_type || "regatta") === "championship");
  const clubChampionshipSeries = clubSeries.filter((s) => !s.regatta_id && competitionType(s) === "club_championship");
  const championshipSeriesForClub = clubSeries.filter((s) => !s.regatta_id && competitionType(s) === "championship");

  const hasRegattas = clubSeries.some((s) => s.regatta_id) || regattaComps.length > 0;
  const hasClubChampionships = clubChampionshipSeries.length > 0;
  const hasChampionships = championshipSeriesForClub.length > 0 || championshipComps.length > 0;
  const availableViews = [
    hasClubChampionships && "club_championship",
    hasChampionships && "championship",
    hasRegattas && "regattas",
  ].filter(Boolean);
  const showViewToggle = availableViews.length > 1;
  useEffect(() => {
    if (!availableViews.includes(view)) setView(availableViews[0] || "championship");
  }, [hasClubChampionships, hasChampionships, hasRegattas]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default the Regattas view to the first regatta (not championship) of the year.
  useEffect(() => {
    const comps = regattas.filter((r) => (r.competition_type || "regatta") !== "championship");
    if (comps.length === 0) { setRegattaId(null); return; }
    setRegattaId((prev) => (prev && comps.some((r) => r.id === prev) ? prev : comps[0].id));
  }, [regattas]);

  // Per-class summary for the selected regatta (winner / races / boats),
  // computed by the backend from the live standings — never duplicated.
  useEffect(() => {
    if (view !== "regattas" || !clubId || !regattaId) return;
    api.getRegatta(regattaId, { club_id: clubId }).then(setRegattaDetail).catch(() => setRegattaDetail(null));
  }, [view, clubId, regattaId]);

  const regattaClasses = useMemo(() => {
    const seen = [];
    (regattaDetail?.series || []).forEach((s) => {
      if (s.class_name && !seen.includes(s.class_name)) seen.push(s.class_name);
    });
    return seen;
  }, [regattaDetail]);
  const seriesOf = (cn) => (regattaDetail?.series || []).filter((s) => s.class_name === cn);

  // Regatta navigation mirrors the championship display: choose a class,
  // then its series, then read the normal detailed standings table.
  useEffect(() => {
    if (!regattaDetail) {
      setActiveRegattaClass(null);
      setActiveRegattaSeries(null);
      setRegattaSeriesData({});
      return;
    }
    setActiveRegattaClass((prev) => (prev && regattaClasses.includes(prev) ? prev : regattaClasses[0] || null));
    setRegattaSeriesData({});
  }, [regattaDetail, regattaClasses]);

  const activeRegattaSeriesList = seriesOf(activeRegattaClass);
  useEffect(() => {
    setActiveRegattaSeries((prev) => (
      prev && activeRegattaSeriesList.some((s) => s.id === prev)
        ? prev
        : activeRegattaSeriesList[0]?.id || null
    ));
  }, [activeRegattaClass, regattaDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view !== "regattas" || !clubId || !activeRegattaSeries) return;
    if (regattaSeriesData[activeRegattaSeries]) return;
    api.seriesStandings(activeRegattaSeries, clubId)
      .then((d) => setRegattaSeriesData((prev) => ({ ...prev, [activeRegattaSeries]: d })))
      .catch(() => {});
  }, [view, clubId, activeRegattaSeries, regattaSeriesData]);

  useEffect(() => {
    if (!clubId || !activeClass || activeSeries === "overall") return;
    if (seriesData[activeSeries]) return;
    api.seriesStandings(activeSeries, clubId)
      .then((d) => setSeriesData((prev) => ({ ...prev, [activeSeries]: d })))
      .catch(() => {});
  }, [clubId, activeClass, activeSeries, seriesData]);

  // Series linked to a regatta are that regatta's racing, not a championship:
  // they stay out of the championship tabs below (the regatta section and its
  // own page show them instead). A class whose series are ALL regattas still
  // shows its standings in the results block — the nav model just sees the
  // full series list for that case.
  const championshipSeries = series.filter((s) => !s.regatta_id);
  const displaySeries = view === "club_championship"
    ? championshipSeries.filter((s) => competitionType(s) === "club_championship")
    : championshipSeries.filter((s) => competitionType(s) === "championship");
  const categorySeries = view === "club_championship" ? clubChampionshipSeries : championshipSeriesForClub;
  const categoryClassIds = new Set(categorySeries.map((s) => s.class_id).filter(Boolean));
  const visibleClasses = view === "regattas" || categoryClassIds.size === 0
    ? classes
    : classes.filter((c) => categoryClassIds.has(c.id));

  useEffect(() => {
    if (view === "regattas" || !clubSeries.length || !visibleClasses.length) return;
    if (!visibleClasses.some((c) => c.id === activeClass)) setActiveClass(visibleClasses[0].id);
  }, [view, clubSeries, visibleClasses, activeClass]);

  // Navigation model for the year's series: a single-series year shows that
  // series directly (no redundant Overall tab, no "(excl.)" label); with
  // multiple series the Overall tab appears when the overall championship has
  // rows and stays the default. See seriesNavModel for the rules.
  const hasOverall = !!(overall && overall.standings && overall.standings.length > 0);
  const nav = seriesNavModel(displaySeries, hasOverall);
  useEffect(() => {
    if (series.length === 0) return;
    // Deep link from the site search: land on the requested series once.
    const wanted = seriesParamRef.current;
    if (wanted) {
      seriesParamRef.current = null;
      if (series.some((s) => s.id === wanted)) { setActiveSeries(wanted); return; }
    }
    // Single-series year: land straight on the series, whatever the overall
    // payload says (it would only repeat the same standings).
    if (nav.single) {
      if (activeSeries !== displaySeries[0].id) setActiveSeries(displaySeries[0].id);
      return;
    }
    // Multi-series year: wait for the overall result to decide whether the
    // Overall tab exists, then land on a valid tab.
    if (overall === null) return; // overall not loaded yet
    const valid = nav.showOverall
      ? ["overall", ...displaySeries.map((s) => s.id)]
      : displaySeries.map((s) => s.id);
    if (!valid.includes(activeSeries)) setActiveSeries(nav.defaultTab);
  }, [series, displaySeries, overall, hasOverall, activeSeries, nav.single, nav.showOverall, nav.defaultTab]);

  // Past/future years are data-driven: any year this club has seasons for.
  // The switcher sorts and de-dupes; old years collapse into a More dropdown.
  const pastYears = seasons.filter((y) => y < CURRENT_YEAR);
  const futureYears = seasons.filter((y) => y > CURRENT_YEAR);

  // Analytics — coarse, non-identifying props only (sailing data, never
  // people). useTrackView fires once per logical view, so rerenders and
  // state refetches never duplicate events; changing identity records a new
  // view. Props read through refs at fire time (see useTrackView).
  const activeClassObj = (visibleClasses.find((c) => c.id === activeClass) || {});
  const activeSeriesObj = series.find((s) => s.id === activeSeries) || null;
  const selectedRegattaObj = regattas.find((r) => r.id === regattaId) || null;
  useTrackView(SAILSCORE_EVENTS.VIEW_CLASS, view !== "regattas" && activeClass ? `${club?.slug || ""}:${activeClass}:${year}` : null, {
    class_id: activeClass || undefined,
    class_name: activeClassObj.name,
    club: club?.slug,
    year: typeof year === "number" ? year : undefined,
  });
  useTrackView(SAILSCORE_EVENTS.VIEW_SERIES, view !== "regattas" && activeSeries && activeSeries !== "overall" ? `${club?.slug || ""}:${activeSeries}:${year}` : null, {
    series_id: activeSeries !== "overall" ? activeSeries : undefined,
    series_name: activeSeriesObj?.name,
    class_id: activeClass || undefined,
    class_name: activeClassObj.name,
    club: club?.slug,
    regatta_id: activeSeriesObj?.regatta_id || undefined,
  });
  useTrackView(SAILSCORE_EVENTS.VIEW_RESULTS, view !== "regattas" && activeClass && activeSeries === "overall" && overall?.standings?.length ? `${club?.slug || ""}:${activeClass}:overall:${year}` : null, {
    class_id: activeClass || undefined,
    class_name: activeClassObj.name,
    club: club?.slug,
    year: typeof year === "number" ? year : undefined,
  });
  useTrackView(SAILSCORE_EVENTS.VIEW_REGATTA, view === "regattas" && regattaId && regattaDetail ? `${club?.slug || ""}:${regattaId}` : null, {
    regatta_id: regattaId || undefined,
    regatta_name: regattaDetail?.name,
    club: club?.slug,
  });
  useTrackView(SAILSCORE_EVENTS.VIEW_RESULTS, view === "regattas" && activeRegattaSeries && regattaSeriesData[activeRegattaSeries]?.standings ? `regatta-series:${club?.slug || ""}:${activeRegattaSeries}` : null, {
    regatta_id: regattaId || undefined,
    regatta_name: regattaDetail?.name,
    series_id: activeRegattaSeries || undefined,
    series_name: (activeRegattaSeriesList.find((s) => s.id === activeRegattaSeries) || {}).name,
    class_name: activeRegattaClass || undefined,
    club: club?.slug,
  });
  useTrackView(SAILSCORE_EVENTS.VIEW_RESULTS, view === "regattas" && activeRegattaClass && !activeRegattaSeries ? `regatta-class:${club?.slug || ""}:${regattaId}:${activeRegattaClass}` : null, {
    regatta_id: regattaId || undefined,
    regatta_name: regattaDetail?.name,
    class_name: activeRegattaClass || undefined,
    club: club?.slug,
  });

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

  // Hero background: the selected regatta's own photo when one is uploaded,
  // otherwise the default sailing shot. Either way the blue hero-overlay is
  // applied on top, so the two look consistent.
  const selectedRegatta = regattaComps.find((r) => r.id === regattaId);
  const heroPhoto = competitionImage(view === "regattas" ? selectedRegatta : null);

  // The browse hierarchy as one sequence of levels. Only real choices appear:
  // a level with a single option is already decided by the defaults above, so
  // it never asks for a click. `depth` counts the levels the reader has
  // committed to; the levels below that stay hidden, and so do the results.
  const navLevels = [];
  if (showViewToggle) {
    navLevels.push({
      key: "category", label: "Category", value: view, onPick: setView,
      options: availableViews.map((v) => ({ value: v, ...VIEW_LEVELS[v], testId: `view-${v}-btn` })),
    });
  }
  if (view === "regattas") {
    if (regattaComps.length > 1) {
      navLevels.push({
        key: "regatta", label: "Regatta", value: regattaId, onPick: setRegattaId,
        options: regattaComps.map((r) => ({ value: r.id, label: r.name, testId: `regatta-tab-${r.name}` })),
      });
    }
    if (regattaClasses.length > 1) {
      navLevels.push({
        key: "class", label: "Class", value: activeRegattaClass, onPick: setActiveRegattaClass,
        options: regattaClasses.map((n) => ({ value: n, label: n, Icon: Trophy, testId: `regatta-class-tab-${n}` })),
      });
    }
    if (activeRegattaSeriesList.length > 1) {
      navLevels.push({
        key: "series", label: "Series", value: activeRegattaSeries, onPick: setActiveRegattaSeries,
        options: activeRegattaSeriesList.map((s) => ({
          value: s.id, label: s.name === regattaDetail?.name ? "Overall" : s.name,
          testId: `regatta-series-tab-${s.name}`,
        })),
      });
    }
  } else {
    if (visibleClasses.length > 1) {
      navLevels.push({
        key: "class", label: "Class", value: activeClass, onPick: setActiveClass,
        options: visibleClasses.map((c) => ({ value: c.id, label: c.name, testId: `class-tab-${c.name}` })),
        subscription: activeClass && <ResultsSubscription subscriptionType="class" targetId={activeClass}
          targetName={activeClassObj.name || "this class"} />,
      });
    }
    const seriesOptions = [
      ...(nav.showOverall ? [{ value: "overall", label: "Overall", testId: "series-tab-Overall" }] : []),
      ...displaySeries.map((s) => ({
        value: s.id, testId: `series-tab-${s.name}`,
        label: <>{s.name}{nav.showExcl(s) && <span className="ml-1 text-[10px] opacity-70">(excl.)</span>}</>,
      })),
    ];
    if (seriesOptions.length > 1) {
      navLevels.push({
        key: "series", label: "Series", value: activeSeries, onPick: setActiveSeries, options: seriesOptions,
        subscription: activeSeries !== "overall" && activeSeries && (
          <ResultsSubscription subscriptionType="series" targetId={activeSeries}
            targetName={activeSeriesObj?.name || "this series"} />),
      });
    }
  }
  const levelIndex = Math.min(depth, navLevels.length);
  // The panel is always exactly one row: the level being chosen in, or — once
  // every level is settled — the last one, so its siblings stay switchable.
  // Settled levels are not repeated here; the breadcrumb above is the trail.
  const browseLevel = navLevels[levelIndex] || navLevels[navLevels.length - 1] || null;
  const browseSettled = levelIndex >= navLevels.length;
  // Back steps the panel up one level, whichever level it is showing.
  const browseShown = browseSettled ? navLevels.length - 1 : levelIndex;
  // Breadcrumb trail: the club is the root of the browse hierarchy, each
  // committed level is a crumb that steps back up to it, and the deepest
  // choice is the page itself once there is nothing left to choose.
  const crumbs = [
    { label: "Home", href: "/" },
    { label: club.name, onClick: () => setDepth(0) },
  ];
  navLevels.slice(0, levelIndex).forEach((level, i) => {
    const chosen = level.options.find((o) => o.value === level.value);
    const settled = levelIndex >= navLevels.length && i === levelIndex - 1;
    crumbs.push({
      label: chosen ? chosen.label : "—",
      onClick: settled ? undefined : () => setDepth(i),
    });

    // A single class is intentionally omitted from the selector row, but it
    // still belongs in the path so choosing a category never leaves the user
    // wondering which class the results represent.
    const implicitClass = level.key === "category" && (
      view === "regattas" ? regattaClasses.length === 1 : visibleClasses.length === 1
    );
    if (implicitClass) {
      crumbs.push({
        label: view === "regattas" ? activeRegattaClass : activeClassObj.name,
      });
    }
  });
  // The regatta detail carries the class levels, so the regatta results wait
  // for it — otherwise they would flash before that level appears.
  const showResults = levelIndex >= navLevels.length
    && (view !== "regattas" || !!regattaDetail || regattaComps.length === 0);
  return (
    <div className="min-h-screen bg-background">
      <NotificationBanner items={notifications} />

      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
        {/* relative: the header search panel hangs off this row. */}
        <div className="relative max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HeaderMenu title={`${club.name} · results & standings`} text={`Live results and standings for ${club.name} on SailScore`} />
            <Link to="/"><Logo className="h-11 w-auto" /></Link>
            <div className="font-heading text-xl uppercase tracking-tight leading-none">{club.name}</div>
          </div>
          <div className="flex items-center gap-2">
            <BoatSearchBox variant="header" className="" />
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-ocean" data-testid="all-clubs-btn">
                <ArrowLeft className="w-4 h-4" /> All clubs
              </Button>
            </Link>
            <OfficialsLink />
          </div>
        </div>
      </header>

      <section className="relative">
        <img
          src={heroPhoto}
          alt={selectedRegatta ? `${selectedRegatta.name} photo` : "racing"}
          className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 hero-overlay" />
        <div className="relative max-w-6xl mx-auto px-4 py-6 md:py-8">
          <Breadcrumbs items={crumbs} className="mb-3 text-white/70 [&_a]:text-white/80 [&_button]:text-white/80 [&_span]:text-white" />
          <Badge className={`mb-3 uppercase tracking-widest ${year === CURRENT_YEAR ? "bg-safety text-white" : "bg-white/20 text-white border border-white/40"}`} data-testid="season-badge">
            {year} Season
          </Badge>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl uppercase tracking-tighter text-white leading-[0.95] max-w-3xl">
            {club.name} · {year === CURRENT_YEAR ? "live" : year} results & standings
          </h1>

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
            <YearSwitcher grouped value={year} onChange={setYear} years={[...new Set([...pastYears, CURRENT_YEAR - 1, ...futureYears])]}
              labels={{ past: "Past Results", current: "Current Results", future: "Future Series" }} />
            <div className="flex flex-wrap items-center gap-2 self-end">
              <Link to={`/club/${club.slug}/calendar${year !== CURRENT_YEAR ? `?year=${year}` : ""}`}>
                <Button variant="outline" size="sm" className="gap-1.5 border-white/60 bg-white/10 text-white hover:bg-white/15" data-testid="club-calendar-tab">
                  <CalendarDays className="h-4 w-4" /> Calendar
                </Button>
              </Link>
              {club.official_notice_board !== false && <Link to={`/club/${club.slug}/notice-board`} className="self-end">
                <Button variant="outline" size="sm" className="gap-1.5 border-white/60 bg-white/10 text-white hover:bg-white hover:text-ocean" data-testid="notice-board-link">Official Notice Board</Button>
              </Link>}
            </div>
          </div>

          {/* One row, the level being chosen in. Picking a choice opens the
              next level, and Back reopens the one above, so the panel is the
              same size however deep you go. */}
          {browseLevel && (
            <div className="mt-4 w-full max-w-3xl rounded-2xl border border-white/25 bg-white/10 px-4 py-3 backdrop-blur-sm"
              data-testid="browse-nav">
              <div data-testid={`nav-level-${browseLevel.key}`} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-white/60 text-[11px] uppercase tracking-widest font-semibold sm:w-24 sm:shrink-0">
                  {browseLevel.label}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {browseLevel.options.map((option) => (
                    <button key={option.value} type="button" data-testid={option.testId}
                      aria-current={(browseSettled && option.value === browseLevel.value) || undefined}
                      onClick={() => { browseLevel.onPick(option.value); setDepth(levelIndex + 1); }}
                      className={`${HERO_CHIP} ${browseSettled && option.value === browseLevel.value ? HERO_CHIP_CURRENT : HERO_CHIP_REST}`}>
                      {option.Icon && <option.Icon className="w-4 h-4 inline -mt-0.5 mr-1.5" />}{option.label}
                    </button>
                  ))}
                  {browseLevel.subscription}
                  {browseShown > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setDepth(browseShown - 1)}
                      data-testid="nav-back"
                      className="gap-1.5 border border-white/30 text-white/80 hover:bg-white/15 hover:text-white">
                      <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </Button>
                  )}
                </div>
              </div>
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

        {showResults && view !== "regattas" && (
          <div>
            {championshipComps.length > 0 && (
              <div className="mb-10" data-testid="championship-competitions">
                <h2 className="text-lg md:text-lg uppercase tracking-tight mb-1">Championship competitions</h2>
                <p className="text-muted-foreground text-sm mb-4">Competitions scored over the season — each may span several series and classes.</p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {championshipComps.map((c) => (
                    <CompetitionCard key={c.id} competition={c} clubSlug={club.slug} />
                  ))}
                </div>
              </div>
            )}
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
                  clubSlug={club.slug}
                  year={year}
                  clubName={club.name}
                  className={(visibleClasses.find((c) => c.id === activeClass) || {}).name}
                  clubIcon={club.icon}
                  series={displaySeries}
                  activeSeries={activeSeries}
                  adverts={adverts}
                  overall={overall}
                  seriesData={seriesData}
                />
              )}
            </div>
          </div>
        )}

        {showResults && view === "regattas" && (
          <div data-testid="regatta-results">
            {regattaComps.length === 0 ? (
              <div className="mt-8 rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
                <p className="font-heading text-xl uppercase tracking-tight">No regattas for {year}</p>
                <p className="text-muted-foreground text-sm mt-1">Regattas and open meetings will appear here once set up.</p>
              </div>
            ) : (
              <>
                <section className="mb-8" data-testid="regatta-cards">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="font-heading text-2xl uppercase tracking-tight text-ocean">Events &amp; regattas</h2>
                      <p className="text-sm text-muted-foreground">Select a racing occasion to browse its classes and results.</p>
                    </div>
                    <Badge variant="outline" className="gap-1.5 border-ocean/30 text-ocean"><CalendarDays className="h-3.5 w-3.5" />{year}</Badge>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {regattaComps.map((competition) => (
                      <CompetitionCard
                        key={competition.id}
                        competition={competition}
                        clubSlug={club.slug}
                        selected={competition.id === regattaId}
                        compact
                      />
                    ))}
                  </div>
                </section>
                {!regattaDetail ? (
                  <p className="py-6 text-muted-foreground">Loading regatta…</p>
                ) : (
              <div className="pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-heading uppercase tracking-tight text-2xl text-ocean">{regattaDetail.name}</h2>
                      <Badge variant="outline">{regattaDetail.status || "Complete"}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {regattaDetail.date_label && <span className="inline-flex items-center gap-1 mr-4"><CalendarDays className="w-4 h-4" />{regattaDetail.date_label}</span>}
                      {regattaDetail.host_club && <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4" />{regattaDetail.host_club}</span>}
                    </p>
                  </div>
                  <Link to={`/club/${club.slug}/regatta/${regattaId}`}>
                    <Button variant="outline" size="sm" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white shrink-0">
                      View full regatta results <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>

                {/* The class and series are chosen in the hero (and collapse to
                    chips there), so the detail only names the selection. */}
                {activeRegattaSeries && (
                  <section className="rounded-2xl border border-border bg-card p-4 sm:p-6" data-testid="regatta-selected-results">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-heading text-xl uppercase tracking-tight text-ocean">{activeRegattaClass}</h3>
                        <p className="text-sm text-muted-foreground">
                          {activeRegattaSeriesList.find((s) => s.id === activeRegattaSeries)?.name !== regattaDetail.name
                            ? activeRegattaSeriesList.find((s) => s.id === activeRegattaSeries)?.name
                            : "Overall"}
                          {" · "}{regattaDetail.date_label || regattaDetail.year}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white"
                        disabled={!regattaSeriesData[activeRegattaSeries]?.standings?.length}
                        onClick={() => {
                          const selected = activeRegattaSeriesList.find((s) => s.id === activeRegattaSeries);
                          exportSeriesPdf({
                            clubName: club.name, className: activeRegattaClass,
                            seriesName: selected?.name || regattaDetail.name,
                            year: regattaDetail.year, data: regattaSeriesData[activeRegattaSeries],
                            icon: club.icon, competitionLabel: `${regattaDetail.name} · Regatta`,
                          });
                          trackEvent(SAILSCORE_EVENTS.DOWNLOAD_RESULTS_PDF, {
                            regatta_id: regattaId,
                            regatta_name: regattaDetail.name,
                            series_id: activeRegattaSeries,
                            series_name: selected?.name || "Overall",
                            class_name: activeRegattaClass,
                            club: club.slug,
                          });
                        }}>
                        <Download className="h-4 w-4" /> PDF
                      </Button>
                    </div>
                    <SeriesStandings data={regattaSeriesData[activeRegattaSeries]} />
                    <PublishedRaces
                      seriesId={activeRegattaSeries}
                      series={activeRegattaSeriesList.find((s) => s.id === activeRegattaSeries)}
                      classId={activeRegattaSeriesList.find((s) => s.id === activeRegattaSeries)?.class_id}
                      clubId={clubId}
                      clubSlug={club.slug}
                      scoringMode={activeRegattaSeriesList.find((s) => s.id === activeRegattaSeries)?.scoring_mode || "one_design"}
                      testId={`published-races-${activeRegattaSeries}`}
                    />
                  </section>
                )}
              </div>
                )}
              </>
            )}
          </div>
        )}

      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <Logo className="h-8 w-auto mx-auto" />
        <p className="mt-2">{SITE_TAGLINE}</p>
        <p className="mt-2 text-xs">
          Website by {SITE_OWNER} · Queries to{" "}
          <a href={`mailto:${SITE_CONTACT_EMAIL}`} className="underline decoration-border underline-offset-2 hover:text-foreground transition-colors">{SITE_CONTACT_EMAIL}</a>
        </p>
      </footer>
    </div>
  );
}
