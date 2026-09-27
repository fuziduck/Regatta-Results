import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, Sailboat, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { competitionTypeLabel, DEFAULT_COMPETITION_IMAGE } from "@/lib/competition";
import { seriesResultsPath } from "@/lib/seo";
import { CURRENT_YEAR, classDivisions, scoringModeLabel, seriesScoringModes } from "@/lib/helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import HeaderMenu from "@/components/HeaderMenu";
import Logo from "@/components/Logo";
import ClubBadge from "@/components/ClubBadge";
import { RaceReportButton } from "@/components/RaceReports";
import Landing from "@/pages/Landing";

const typeOrder = ["Club Championship", "Class Championship", "Open Championship", "Championship", "Regatta", "Class results"];

function ClassMark({ classData }) {
  return classData?.icon ? (
    <img src={classData.icon} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-border/70 bg-white object-cover shadow-sm" />
  ) : (
    <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-ocean/10 bg-gradient-to-br from-ocean/10 to-ocean/5 text-ocean shadow-sm">
      <Sailboat className="h-5 w-5" />
    </span>
  );
}

// Every series carries its own mark, so a class with five series reads as five
// identifiable entries rather than five bare text links. The class's own boat
// image is reused when it has one, since that is the artwork the club has
// already chosen for the fleet; otherwise the mark is the glyph for the kind
// of results the series holds — a regatta gets a calendar, a championship a
// trophy — which is the same pairing the hero's category tabs use.
function SeriesMark({ classData, typeLabel, size = "h-9 w-9" }) {
  const Glyph = typeLabel === "Regatta" ? CalendarDays : Trophy;
  return classData?.icon ? (
    <img src={classData.icon} alt="" className={`${size} shrink-0 rounded-lg border border-border/70 bg-white object-cover shadow-sm`} />
  ) : (
    <span aria-hidden="true" className={`grid ${size} shrink-0 place-items-center rounded-lg border border-ocean/10 bg-gradient-to-br from-ocean/10 to-ocean/5 text-ocean shadow-sm`}>
      <Glyph className="h-4 w-4" />
    </span>
  );
}

function raceOrderKey(race) {
  return `${race.date || ""}|${String(race.race_number || 0).padStart(4, "0")}`;
}

// First and most recent sailed race per series. Abandoned races are ignored
// throughout, so they never decide a series' position in the list.
function raceBoundsBySeries(races) {
  const first = new Map();
  const latest = new Map();
  races.filter((race) => !race.abandoned).forEach((race) => {
    const currentFirst = first.get(race.series_id);
    if (!currentFirst || raceOrderKey(race) < raceOrderKey(currentFirst)) first.set(race.series_id, race);
    const currentLatest = latest.get(race.series_id);
    if (!currentLatest || raceOrderKey(race) > raceOrderKey(currentLatest)) latest.set(race.series_id, race);
  });
  return { first, latest };
}

// Series inside a class always read as a season's history: oldest racing at the
// top, latest at the bottom. This is deliberately independent of the page's
// Order by selector, which only rearranges the championship and class sections
// around them. The sort date is the series' first sailed race, so a long season
// keeps the place it started. A series that has not raced yet has no place in
// the history at all, so it goes to the bottom rather than jumping to the top.
function compareResultRows(a, b) {
  const dateA = a.firstRace?.date || a.latestRace?.date || "";
  const dateB = b.firstRace?.date || b.latestRace?.date || "";
  if (dateA !== dateB) {
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA.localeCompare(dateB);
  }
  const classOrder = a.className.localeCompare(b.className);
  return classOrder || a.title.localeCompare(b.title);
}

export function groupResultsByClass(rows, classes = [], sortMode = "newest") {
  const classDataById = new Map(classes.map((item) => [item.id, item]));
  const grouped = new Map();
  rows.forEach((row) => {
    const key = row.classId || row.className;
    if (!grouped.has(key)) grouped.set(key, { key: `class-group:${key}`, classId: row.classId, className: row.className, rows: [] });
    grouped.get(key).rows.push(row);
  });
  return [...grouped.values()].map((group) => ({
    ...group,
    rows: group.rows.sort(compareResultRows),
    classData: classDataById.get(group.classId),
    latestDate: group.rows.reduce((date, row) => row.latestRace?.date > date ? row.latestRace.date : date, ""),
  })).map((group) => ({ ...group, ratingLabels: groupScoringModes(group) })).sort((a, b) => sortMode === "alphabetical"
    ? a.className.localeCompare(b.className)
    : b.latestDate.localeCompare(a.latestDate) || a.className.localeCompare(b.className));
}

// The rating pills for a class group, in table order. A class that fields
// rating divisions (IRC boats and YTC boats in one fleet, one table per rating)
// is scored under each of them; a class without divisions follows its series,
// which may itself be scored under several rating systems at once. Either way
// every rate gets its own pill — the first one must not stand for the rest —
// and a class that names no rating at all shows no pill, as before.
export function groupScoringModes(group) {
  const divisions = classDivisions(group?.classData);
  const configured = divisions.length
    ? divisions.map((division) => division.scoring_mode)
    : (group?.rows || []).flatMap((row) => row.scoringModes || []);
  const modes = [...new Set(configured.filter(Boolean))];
  if (modes.length) return modes.map(scoringModeLabel);
  return group?.classData?.scoring_mode ? [scoringModeLabel(group.classData.scoring_mode)] : [];
}

// Reports are scoped to a class, so a series' report count is the number of
// documents its class has uploaded against that series. The index reads the
// same per-class endpoints the class archive uses, keyed by series id.
export function groupReportsBySeries(reports = []) {
  const grouped = new Map();
  reports.forEach((report) => {
    if (!report?.series_id) return;
    const items = grouped.get(report.series_id) || [];
    items.push(report);
    grouped.set(report.series_id, items);
  });
  return grouped;
}

export function buildClubResultsRows({ classes = [], series = [], competitions = [], races = [], slug = "" }) {
  const classById = new Map(classes.map((item) => [item.id, item]));
  const competitionById = new Map(competitions.map((item) => [item.id, item]));
  const competitionBySeriesId = new Map();
  competitions.forEach((competition) => (competition.series || []).forEach((child) => {
    if (child.id) competitionBySeriesId.set(child.id, competition);
  }));
  const { first: firstBySeries, latest: latestBySeries } = raceBoundsBySeries(races);

  // The club index has one entry per series, regardless of how many races it
  // contains. Race dates are metadata for recent-first sorting, not race rows.
  const rows = series.map((item) => {
    const competition = competitionBySeriesId.get(item.id) || competitionById.get(item.regatta_id);
    const classData = classById.get(item.class_id);
    const latestRace = latestBySeries.get(item.id) || null;
    const firstRace = firstBySeries.get(item.id) || null;
    const title = competition && item.name === competition.name
      ? "Overall"
      : item.name || competition?.name || "Series results";
    return {
      key: `series:${item.id}`,
      className: classData?.name || "Class",
      classId: item.class_id,
      classData,
      seriesId: item.id,
      // The rating systems this series is scored under, so the class header
      // can show a pill per rate rather than only the first one.
      scoringModes: seriesScoringModes(item),
      typeLabel: competition ? competitionTypeLabel({ competition }) : competitionTypeLabel(item),
      title,
      year: item.year || competition?.year,
      firstRace,
      latestRace,
      href: seriesResultsPath(slug, item.id, item.name, item.year || competition?.year, item.class_id),
    };
  });

  return rows.sort((a, b) => {
    const dateA = a.latestRace?.date || "";
    const dateB = b.latestRace?.date || "";
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    const yearA = Number(a.year) || 0;
    const yearB = Number(b.year) || 0;
    if (yearA !== yearB) return yearB - yearA;
    const classOrder = a.className.localeCompare(b.className);
    return classOrder || a.title.localeCompare(b.title);
  });
}

function ClubHomeIndex({ club }) {
  const [classes, setClasses] = useState([]);
  const [series, setSeries] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const [races, setRaces] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState("newest");
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR));

  useEffect(() => {
    let current = true;
    Promise.all([
      api.getClasses({ club_id: club.id }),
      api.getSeries({ club_id: club.id }),
      api.getRegattas({ club_id: club.id }),
      api.getRaces({ club_id: club.id, status: "published" }),
    ]).then(([classRows, seriesRows, competitionRows, raceRows]) => {
      if (!current) return;
      setClasses(classRows || []);
      setSeries(seriesRows || []);
      setCompetitions(competitionRows || []);
      setRaces(raceRows || []);
    }).catch(() => {
      if (!current) return;
      setClasses([]);
      setSeries([]);
      setCompetitions([]);
      setRaces([]);
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [club.id]);

  // Race reports hang off classes, so they are fetched per class once the
  // class list lands. A class that cannot be read contributes no reports
  // rather than failing the page — the rest of the index is still useful.
  const classIds = useMemo(() => classes.map((item) => item.id).filter(Boolean), [classes]);
  useEffect(() => {
    let current = true;
    if (!classIds.length) {
      setReports([]);
      return undefined;
    }
    Promise.all(classIds.map((id) => api.getClassRaceReports(id).catch(() => [])))
      .then((lists) => { if (current) setReports(lists.flat()); })
      .catch(() => { if (current) setReports([]); });
    return () => { current = false; };
  }, [classIds]);

  const reportsBySeries = useMemo(() => groupReportsBySeries(reports), [reports]);

  const rows = useMemo(() => buildClubResultsRows({ classes, series, competitions, races, slug: club.slug }),
    [classes, series, competitions, races, club.slug]);
  const years = useMemo(() => [...new Set([CURRENT_YEAR, ...rows.map((row) => row.year).filter(Boolean)])]
    .sort((a, b) => Number(b) - Number(a)), [rows]);
  const filteredRows = useMemo(() => selectedYear === "all"
    ? rows
    : rows.filter((row) => String(row.year) === selectedYear), [rows, selectedYear]);
  const types = useMemo(() => typeOrder
    .map((type, order) => ({
      type,
      order,
      latest: filteredRows.filter((row) => row.typeLabel === type)
        .reduce((date, row) => row.latestRace?.date > date ? row.latestRace.date : date, ""),
    }))
    .filter((item) => filteredRows.some((row) => row.typeLabel === item.type))
    .sort((a, b) => sortMode === "alphabetical"
      ? a.type.localeCompare(b.type)
      : b.latest.localeCompare(a.latest) || a.order - b.order)
    .map((item) => item.type), [filteredRows, sortMode]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            <HeaderMenu title={`${club.name} · results`} />
            <Link to="/" aria-label="SailScore home"><Logo className="h-10 w-auto" /></Link>
            <span className="hidden truncate font-heading text-lg uppercase tracking-tight sm:block">{club.name}</span>
          </div>
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-ocean" data-testid="club-home-back">
              <ArrowLeft className="h-4 w-4" /> Clubs
            </Button>
          </Link>
        </div>
      </header>

      <section className="relative isolate overflow-hidden bg-ocean text-white">
        <img src={DEFAULT_COMPETITION_IMAGE} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#061947]/95 via-[#0a369d]/85 to-[#087e9d]/65" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-24 bg-gradient-to-t from-[#061947]/40 to-transparent" />
        <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10 lg:py-14">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-7">
            <ClubBadge club={club} size="h-16 w-16 rounded-2xl sm:h-20 sm:w-20 lg:h-24 lg:w-24" textSize="text-3xl lg:text-4xl" className="ring-4 ring-white/15 shadow-2xl" />
            <div className="min-w-0 flex-1">
              <Badge className="mb-3 gap-1.5 border border-white/25 bg-white/10 text-white shadow-sm backdrop-blur-sm"><Sailboat className="h-3.5 w-3.5" />Club results</Badge>
              <h1 className="font-heading text-3xl uppercase leading-[0.95] tracking-tight sm:text-4xl lg:text-5xl">{club.name}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">Find your fleet, then jump straight to the latest championship or event results.</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:min-w-48 sm:grid-cols-1">
              <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-lg backdrop-blur-sm">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><Sailboat className="h-5 w-5" /></span>
                <span><span className="block font-heading text-2xl leading-none">{classes.length}</span><span className="mt-1 block text-[10px] font-semibold uppercase tracking-widest text-white/70">classes</span></span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-lg backdrop-blur-sm">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><Trophy className="h-5 w-5" /></span>
                <span><span className="block font-heading text-2xl leading-none">{rows.length}</span><span className="mt-1 block text-[10px] font-semibold uppercase tracking-widest text-white/70">results pages</span></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-7 sm:py-9 lg:py-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-safety">Explore the fleet</p>
            <h2 className="font-heading text-2xl uppercase tracking-tight text-ocean sm:text-3xl">Browse results</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose a class and championship to open its results.</p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:justify-end">
            {!loading && <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">{filteredRows.length} result page{filteredRows.length === 1 ? "" : "s"}</span>}
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground" htmlFor="club-results-year">
              <span>Year</span>
              <select id="club-results-year" data-testid="club-results-year" value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="h-9 rounded-lg border border-ocean/25 bg-card px-3 text-sm font-semibold text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ocean">
                <option value="all">All years</option>
                {years.map((year) => <option key={year} value={String(year)}>{year}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground" htmlFor="club-results-sort">
              <span>Order by</span>
              <select id="club-results-sort" data-testid="club-results-sort" value={sortMode}
                onChange={(event) => setSortMode(event.target.value)}
                className="h-9 rounded-lg border border-ocean/25 bg-card px-3 text-sm font-semibold text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ocean">
                <option value="newest">Newest activity</option>
                <option value="alphabetical">A–Z</option>
              </select>
            </label>
          </div>
        </div>

        {types.length > 0 && (
          <nav aria-label="Championship types" className="mb-5 flex snap-x gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
            {types.map((type) => (
              <a key={type} href={`#results-${type.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                className="inline-flex shrink-0 snap-start items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-ocean/40 hover:text-ocean hover:shadow">
                {type} <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{filteredRows.filter((row) => row.typeLabel === type).length}</span>
              </a>
            ))}
          </nav>
        )}

        {loading ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">Loading club results…</div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center" data-testid="club-results-empty">
            <Trophy className="mx-auto mb-3 h-8 w-8 text-ocean/60" />
            <h3 className="font-heading text-xl uppercase tracking-tight">{selectedYear === "all" ? "No results pages yet" : `No results pages for ${selectedYear}`}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{selectedYear === "all" ? "Classes and championships will appear here when they are set up." : "Choose another year to browse more club results."}</p>
          </div>
        ) : (
          <div className="space-y-7" data-testid="club-results-tables">
            {types.map((type) => {
              const typeRows = filteredRows.filter((row) => row.typeLabel === type);
              const classGroups = groupResultsByClass(typeRows, classes, sortMode);
              const anchorId = `results-${type.toLowerCase().replace(/[^a-z]+/g, "-")}`;
              return (
                <section key={type} id={anchorId} className="scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:rounded-3xl sm:shadow-md">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-muted/70 to-muted/20 px-4 py-3.5 sm:px-5 sm:py-4">
                    <div>
                      <h2 className="font-heading text-lg uppercase tracking-tight text-ocean sm:text-xl">{type}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">{typeRows.length} results page{typeRows.length === 1 ? "" : "s"}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-card/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{sortMode === "alphabetical" ? "A–Z" : <><Clock3 className="h-3.5 w-3.5 text-ocean" />Newest activity</>}</span>
                  </div>
                  <div className="space-y-3 p-3 sm:p-4">
                    {classGroups.map((group) => {
                      // One lookup per rendered row; reports are keyed by series
                      // id, so a row without a document reads as empty.
                      const seriesReports = (row) => reportsBySeries.get(row.seriesId) || [];
                      const ratingPills = group.ratingLabels || groupScoringModes(group);
                      return (
                      <section key={group.key} data-testid="club-result-class-group" className="overflow-hidden rounded-2xl border border-border/80 bg-background/70">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/25 px-3 py-3 sm:px-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <ClassMark classData={group.classData} />
                            <div className="min-w-0">
                              <h3 className="truncate font-heading text-base uppercase leading-tight tracking-tight text-foreground sm:text-lg">{group.className}</h3>
                              <p className="mt-0.5 text-xs text-muted-foreground">{group.rows.length} result page{group.rows.length === 1 ? "" : "s"}</p>
                            </div>
                          </div>
                          {ratingPills.length > 0 && (
                            <span className="flex shrink-0 flex-wrap items-center gap-1.5" data-testid="club-result-ratings">
                              {ratingPills.map((label) => <Badge key={label} variant="outline" className="border-ocean/20 bg-card text-ocean">{label}</Badge>)}
                            </span>
                          )}
                        </div>
                        <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:hidden">{group.rows.map((row) => (
                          // The report control sits beside the series link rather
                          // than inside it: a website report is an anchor too, and
                          // one link cannot be nested in another.
                          <div key={row.key} data-testid="club-result-card" data-first-race={row.firstRace?.date || ""}
                            className="group/card relative flex min-h-16 items-center overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-ocean/40 hover:shadow-md">
                            <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-safety via-ocean to-cyan-500 opacity-75 transition-opacity group-hover/card:opacity-100" />
                            <Link to={row.href}
                              className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean sm:pl-3.5">
                              <SeriesMark classData={row.classData || group.classData} typeLabel={row.typeLabel} />
                              <span className="min-w-0 flex-1 font-heading text-base uppercase leading-tight tracking-tight text-foreground transition-colors group-hover/card:text-ocean">{row.title}</span>
                              <span className="flex shrink-0 items-center gap-2">
                                <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">{row.year || "All seasons"}</span>
                                <span className="grid h-7 w-7 place-items-center rounded-full bg-ocean/5 text-ocean transition-all group-hover/card:bg-ocean group-hover/card:text-white"><ChevronRight className="h-4 w-4" /></span>
                              </span>
                            </Link>
                            {seriesReports(row).length > 0 && (
                              <span className="flex shrink-0 items-center pr-2">
                                <RaceReportButton report={seriesReports(row)[0]}
                                  label={seriesReports(row).length > 1 ? `Report ×${seriesReports(row).length}` : "Report"} />
                              </span>
                            )}
                          </div>
                        ))}</div>
                        <div className="hidden overflow-x-auto xl:block">
                          <table className="w-full min-w-[640px] text-left text-sm">
                            <thead className="border-b border-border text-[11px] uppercase tracking-widest text-muted-foreground">
                              <tr>
                                <th scope="col" className="px-3 py-2.5 font-semibold">Series</th>
                                <th scope="col" className="px-3 py-2.5 font-semibold">Season</th>
                                <th scope="col" className="px-3 py-2.5 font-semibold">Race report</th>
                                <th scope="col" className="px-3 py-2.5"><span className="sr-only">Open results</span></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {group.rows.map((row) => (
                                <tr key={row.key} className="group transition-colors hover:bg-ocean/[0.035]" data-testid="club-result-row"
                                  data-result-date={row.latestRace?.date || ""} data-first-race={row.firstRace?.date || ""}>
                                  <td className="min-w-48 px-3 py-2.5">
                                    <span className="flex items-center gap-2.5">
                                      <SeriesMark classData={row.classData || group.classData} typeLabel={row.typeLabel} size="h-7 w-7" />
                                      <Link to={row.href} className="min-w-0 truncate font-semibold text-ocean hover:text-safety hover:underline" data-testid={`club-result-link-${row.key}`}>
                                        {row.title}
                                      </Link>
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{row.year || "—"}</td>
                                  <td className="whitespace-nowrap px-3 py-2.5" data-testid={`club-result-report-cell-${row.key}`}>
                                    {seriesReports(row).length > 0
                                      ? <RaceReportButton report={seriesReports(row)[0]} label={seriesReports(row).length > 1 ? `Report ×${seriesReports(row).length}` : "Report"} />
                                      : <span className="text-muted-foreground/60">—</span>}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    <Link to={row.href} aria-label={`Open ${row.className} ${row.title} results`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors group-hover:bg-ocean group-hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean">
                                      <ChevronRight className="h-4 w-4" />
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export default function ClubHomeRoute() {
  const { slug, seriesId } = useParams();
  const [searchParams] = useSearchParams();
  const [club, setClub] = useState(null);
  const [loading, setLoading] = useState(true);
  const isDeepLink = Boolean(seriesId) || searchParams.has("class") || searchParams.has("series") || searchParams.has("year");

  useEffect(() => {
    if (isDeepLink) return undefined;
    let active = true;
    api.getClubs().then((clubs) => {
      if (active) setClub((clubs || []).find((item) => item.slug === slug) || null);
    }).catch(() => { if (active) setClub(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, isDeepLink]);

  if (isDeepLink) return <Landing />;
  if (loading) return <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">Loading club…</div>;
  if (!club) return <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">Club not found.</div>;
  return <ClubHomeIndex club={club} />;
}
