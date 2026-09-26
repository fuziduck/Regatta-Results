import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Users } from "lucide-react";
import Breadcrumbs from "@/components/Breadcrumbs";
import { fmtDate, fmtSeconds, elapsedSecondsOf, correctedSecondsOf, boatRating, boatDivision, boatScoringMode, classDivisions, divisionTables, seriesScoringModes, scoringModeLabel, CODE_COLORS, shouldWrapBoatName, wrapBoatName } from "@/lib/helpers";
import { boatProfilePath, raceResultPath } from "@/lib/seo";
import { competitionPath } from "@/lib/competition";

const PODIUM_ROW = {
  1: "bg-amber-100/80 dark:bg-amber-400/15",
  2: "bg-slate-100 dark:bg-slate-400/10",
  3: "bg-orange-100/80 dark:bg-orange-400/15",
};
const PODIUM_POSITION = {
  1: "bg-amber-400 text-amber-950",
  2: "bg-slate-300 text-slate-800 dark:bg-slate-400/70",
  3: "bg-orange-400 text-orange-950 dark:bg-orange-400/70",
};
const RACE_STATUS_CLASS = {
  Completed: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
  Provisional: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
  Planned: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-200",
  Postponed: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
  Abandoned: "border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200",
  Cancelled: "border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200",
};

function raceStatus(race) {
  const status = (race?.status || "").toLowerCase();
  if (race?.abandoned || status === "abandoned") return "Abandoned";
  if (race?.cancelled || status === "cancelled") return "Cancelled";
  if (race?.postponed || status === "postponed") return "Postponed";
  if (status === "published") return "Completed";
  if (status === "provisional") return "Provisional";
  return "Planned";
}

function resultOrder(a, b) {
  const aFinished = a.code === "FINISHED" && Number.isFinite(Number(a.position));
  const bFinished = b.code === "FINISHED" && Number.isFinite(Number(b.position));
  if (aFinished && bFinished) return Number(a.position) - Number(b.position);
  if (aFinished) return -1;
  if (bFinished) return 1;
  return (Number(a.position) || Number.MAX_SAFE_INTEGER) - (Number(b.position) || Number.MAX_SAFE_INTEGER);
}

export default function Race() {
  const { slug, raceId } = useParams();
  const [race, setRace] = useState(null);
  const [boats, setBoats] = useState({});
  const [series, setSeries] = useState(null);
  const [classInfo, setClassInfo] = useState(null);
  const [regatta, setRegatta] = useState(null);
  const [standings, setStandings] = useState(null);
  const [raceList, setRaceList] = useState([]);

  useEffect(() => {
    let active = true;
    api.getRace(raceId).then(async (result) => {
      const [classBoats, classes, seriesList, regattas, standingsPayload, relatedRaces] = await Promise.all([
        api.getBoats({ class_id: result.class_id, club_id: result.club_id }),
        api.getClasses({ club_id: result.club_id }),
        api.getSeries({ club_id: result.club_id, year: result.year }),
        api.getRegattas({ club_id: result.club_id, year: result.year }),
        result.series_id ? api.seriesStandings(result.series_id, result.club_id).catch(() => null) : Promise.resolve(null),
        Promise.resolve().then(() => api.getRaces({
          ...(result.series_id ? { series_id: result.series_id } : { class_id: result.class_id }),
          club_id: result.club_id,
        })).catch(() => []),
      ]);
      if (!active) return;
      setRace(result);
      const byId = {};
      (classBoats || []).forEach((boat) => { byId[boat.id] = boat; });
      setBoats(byId);
      setClassInfo((classes || []).find((item) => item.id === result.class_id) || null);
      const selectedSeries = (seriesList || []).find((item) => item.id === result.series_id) || null;
      setSeries(selectedSeries);
      const linkedRegatta = (regattas || []).find((item) => item.id === selectedSeries?.regatta_id)
        || (regattas || []).find((item) => {
          const competitionName = (item.name || "").trim().toLowerCase();
          const seriesName = (selectedSeries?.name || "").trim().toLowerCase();
          return item.year === result.year
            && (seriesName === competitionName || seriesName.startsWith(`${competitionName} `));
        })
        || null;
      setRegatta(linkedRegatta);
      setStandings(standingsPayload);
      setRaceList(relatedRaces || []);
    }).catch(() => {
      if (active) setRace(null);
    });
    return () => { active = false; };
  }, [raceId]);

  const raceNavigation = useMemo(() => {
    if (!race) return { previous: null, next: null };
    const siblings = (raceList || [])
      .filter((item) => item.id && String(item.status || "").toLowerCase() === "published")
      .sort((a, b) => Number(a.race_number || 0) - Number(b.race_number || 0)
        || String(a.date || "").localeCompare(String(b.date || "")));
    const index = siblings.findIndex((item) => item.id === race.id);
    return index < 0 ? { previous: null, next: null } : {
      previous: siblings[index - 1] || null,
      next: siblings[index + 1] || null,
    };
  }, [race, raceList]);

  const divisions = classDivisions(classInfo);
  const scoringModes = seriesScoringModes({
    ...(series || {}), scoring_mode: series?.scoring_mode || classInfo?.scoring_mode || "one_design",
  });
  const activeScoringModes = useMemo(() => scoringModes.length ? scoringModes : ["one_design"], [scoringModes]);
  const multiScoring = !divisions.length && activeScoringModes.length > 1;
  const [raceMode, setRaceMode] = useState(null);
  const activeRaceMode = raceMode && activeScoringModes.includes(raceMode) ? raceMode : activeScoringModes[0];
  const displayMode = activeRaceMode || "one_design";
  const racePositions = useMemo(() => race?.scoring_positions?.[displayMode] || {}, [race, displayMode]);

  const rows = useMemo(() => {
    if (!race) return [];
    // Points come from each boat's own table — a class split into rating
    // divisions scores her against her division, not the whole class.
    const pointsByBoat = new Map();
    const positionsByMode = new Map();
    const allPointsByBoat = new Map();
    const allPositionsByBoat = new Map();
    const raceIndex = (standings?.races || []).findIndex((item) => Number(item.race_number) === Number(race.race_number));
    divisionTables(standings).forEach((table) => {
      const mode = table.division_scoring_mode || activeScoringModes[0];
      const modePoints = pointsByBoat.get(mode) || new Map();
      const modePositions = positionsByMode.get(mode) || new Map();
      (table.standings || []).forEach((standing) => {
        const score = raceIndex >= 0 ? standing.scores?.[raceIndex] : null;
        modePoints.set(standing.boat_id, score?.points);
        modePositions.set(standing.boat_id, standing.positions?.[raceIndex]);
        allPointsByBoat.set(standing.boat_id, score?.points);
        allPositionsByBoat.set(standing.boat_id, standing.positions?.[raceIndex]);
      });
      pointsByBoat.set(mode, modePoints);
      positionsByMode.set(mode, modePositions);
    });
    const activePoints = multiScoring
      ? (pointsByBoat.get(displayMode) || pointsByBoat.get(activeScoringModes[0]) || new Map())
      : allPointsByBoat;
    const activePositions = multiScoring
      ? (positionsByMode.get(displayMode) || positionsByMode.get(activeScoringModes[0]) || new Map())
      : allPositionsByBoat;
    return [...(race.results || [])]
      // Divisions are shown as separate results: the rows of one division stay
      // together, each in its own finishing order.
      .sort((a, b) => {
        if (divisions.length) {
          const da = boatDivision(boats[a.boat_id], divisions);
          const db = boatDivision(boats[b.boat_id], divisions);
          if (da !== db) return da.localeCompare(db);
        }
        if (multiScoring) {
          const aPos = racePositions[a.boat_id] ?? activePositions.get(a.boat_id);
          const bPos = racePositions[b.boat_id] ?? activePositions.get(b.boat_id);
          if (aPos != null && bPos != null) return aPos - bPos;
        }
        return resultOrder(a, b);
      })
      .map((result) => ({
        ...result,
        position: multiScoring ? (racePositions[result.boat_id] ?? activePositions.get(result.boat_id) ?? null) : result.position,
        points: activePoints.get(result.boat_id),
        division: boatDivision(boats[result.boat_id], divisions),
      }));
  }, [race, standings, boats, divisions, multiScoring, displayMode, activeScoringModes, racePositions]);

  if (!race) return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading…</div>;

  const scoringMode = series?.scoring_mode || classInfo?.scoring_mode || "one_design";
  // A split class is timed when any division uses a handicap; dual-scored
  // series also display the corrected time for the currently selected table.
  const hasTiming = divisions.length ? divisions.some((d) => d.scoring_mode !== "one_design") : activeScoringModes.some((mode) => mode !== "one_design");
  const scoringLabel = divisions.length
    ? divisions.map((d) => `${d.name} (${scoringModeLabel(d.scoring_mode)})`).join(" · ")
    : activeScoringModes.map(scoringModeLabel).join(" + ");
  const status = raceStatus(race);
  // Keep the established query-form back-link working for copied bookmarks;
  // the series page itself also has a readable URL.
  const parentSeriesHref = series
    ? `/club/${slug}?class=${encodeURIComponent(race.class_id)}&series=${encodeURIComponent(series.id)}&year=${encodeURIComponent(series.year || race.year)}`
    : `/club/${slug}?class=${encodeURIComponent(race.class_id)}&year=${encodeURIComponent(race.year)}`;
  const racePath = (item) => raceResultPath(
    slug, item.id,
    `${classInfo?.name || "Sailing"} ${series?.name || "Series"} race ${item.race_number} ${race.year || ""}`,
  );
  const entries = race.entries_count ?? race.results?.length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-1 px-2 sm:gap-2 sm:px-4">
          <Link to={parentSeriesHref} aria-label="Back to series and class results"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm font-semibold text-ocean hover:bg-muted sm:gap-1.5 sm:px-3">
            <ArrowLeft className="h-4 w-4 shrink-0" /><span className="sm:hidden">Series</span><span className="hidden sm:inline">Series results</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Navigate between races">
            {raceNavigation.previous && <Link to={racePath(raceNavigation.previous)} aria-label={`Previous race ${raceNavigation.previous.race_number}`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold text-ocean hover:bg-muted">
              <ChevronLeft className="h-4 w-4" /><span>R{raceNavigation.previous.race_number}</span>
            </Link>}
            {raceNavigation.next && <Link to={racePath(raceNavigation.next)} aria-label={`Next race ${raceNavigation.next.race_number}`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold text-ocean hover:bg-muted">
              <span>R{raceNavigation.next.race_number}</span><ChevronRight className="h-4 w-4" />
            </Link>}
          </nav>
          <div className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
            <span className="truncate">{classInfo?.name || "Race results"}</span><ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap font-semibold text-ocean">Race {race.race_number}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-8">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6" data-testid="race-header">
          <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Club", href: `/club/${slug}` }, { label: series?.name || "Series" }, { label: `Race ${race.race_number}` }]} className="mb-3 hidden sm:block" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-safety">{regatta?.name || series?.name || "Race results"}</p>
              <h1 className="mt-0.5 font-heading text-3xl uppercase leading-none tracking-tight text-ocean">Race {race.race_number}</h1>
            </div>
            <Badge className={`shrink-0 ${RACE_STATUS_CLASS[status] || RACE_STATUS_CLASS.Planned}`} aria-label={`Status: ${status}`}><span className="hidden sm:inline">Status · </span>{status}</Badge>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div className="flex min-w-0 items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ocean" /><span className="min-w-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Class</span><strong className="block break-words">{classInfo?.name || "—"}</strong></span></div>
            <div className="flex min-w-0 items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ocean" /><span className="min-w-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Date</span><strong className="block">{fmtDate(race.date)}</strong></span></div>
            <div className="flex min-w-0 items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-ocean" /><span className="min-w-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Start time</span><strong className="block">{race.start_time || classInfo?.default_start_time || "To be confirmed"}</strong></span></div>
            <div className="flex min-w-0 items-start gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0 text-ocean" /><span className="min-w-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Boats entered</span><strong className="block">{entries}</strong></span></div>
            <div className="col-span-2 border-t border-border pt-2 text-xs sm:col-span-1 sm:border-0 sm:pt-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{divisions.length ? "Divisions" : "Scoring"}</span><strong className="break-words">{scoringLabel}</strong></div>
          </div>
          <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2" aria-label="Race and class navigation">
            <Link to={parentSeriesHref} className="inline-flex min-h-11 items-center font-semibold text-ocean hover:underline">Series results</Link>
            {regatta && <Link to={competitionPath({ ...regatta, competition_type: regatta.competition_type || "regatta" }, slug)} className="inline-flex min-h-11 items-center font-semibold text-ocean hover:underline">{regatta.name}</Link>}
          </nav>
        </section>

        <section className="mt-7" data-testid="race-results-table">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div><h2 className="font-heading text-2xl uppercase tracking-tight text-ocean">Race results</h2><p className="text-sm text-muted-foreground">Sorted by finishing position · {classInfo?.name || "Fleet results"}</p></div>
            {multiScoring && <div className="flex gap-2" role="group" aria-label="Race scoring system">
              {activeScoringModes.map((mode) => <Button key={mode} size="sm" variant={displayMode === mode ? "default" : "outline"}
                className="min-h-11 px-3" data-testid={`race-scoring-${mode}`} onClick={() => setRaceMode(mode)}>{scoringModeLabel(mode)}</Button>)}
            </div>}
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className={`w-full text-sm ${hasTiming ? "min-w-[48rem]" : "min-w-[32rem]"}`}>
                <thead>
                  <tr className="bg-ocean text-left text-white">
                    <th className="sticky left-0 z-20 bg-ocean px-3 py-2.5">Pos</th>
                    <th className="px-3 py-2.5">Sail Number</th>
                    <th className="px-3 py-2.5">Boat Name</th>
                    <th className="px-3 py-2.5">Class</th>
                    <th className="hidden px-3 py-2.5 md:table-cell">Helm</th>
                    <th className="hidden px-3 py-2.5 lg:table-cell">Crew</th>
                    {hasTiming && <th className="px-3 py-2.5 text-right">Elapsed</th>}
                    {hasTiming && <th className="px-3 py-2.5 text-right">Corrected</th>}
                    <th className="px-3 py-2.5 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((result, index) => {
                    const boat = boats[result.boat_id] || {};
                    const position = result.code === "FINISHED" ? Number(result.position) : null;
                    const elapsed = result.code === "FINISHED" ? elapsedSecondsOf(result.finish_time, race) : null;
                    // Corrected time follows the boat's own division's rating
                    // system (one-design divisions have none to show).
                    const boatMode = multiScoring ? displayMode : boatScoringMode(boat, divisions, scoringMode);
                    const corrected = result.code === "FINISHED" && hasTiming
                      ? correctedSecondsOf(result.finish_time, race, boatRating(boatMode, boat), boatMode)
                      : null;
                    const crew = boat.crew || boat.crew_name || (Array.isArray(boat.crew_names) ? boat.crew_names.join(", ") : "—");
                    const resultCode = result.code && result.code !== "FINISHED" ? result.code : null;
                    return (
                      <tr key={result.boat_id} className={`${index % 2 ? "bg-muted" : "bg-card"} ${PODIUM_ROW[position] || ""}`}>
                        <td className="sticky left-0 z-10 px-3 py-2.5 font-heading text-lg font-bold bg-inherit">
                          {position ? <span className={`inline-grid h-8 min-w-8 place-items-center rounded-full px-1 ${PODIUM_POSITION[position] || "text-ocean"}`}>{position}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-semibold">{boat.sail_no || "—"}</td>
                        <td className={shouldWrapBoatName(boat.name) ? "max-w-48 px-3 py-2.5" : "whitespace-nowrap px-3 py-2.5"}>
                          <Link to={boatProfilePath(boat.fleet_id || result.boat_id, boat.name)} className={`font-semibold hover:underline ${shouldWrapBoatName(boat.name) ? "whitespace-pre-line break-words" : ""}`}>{wrapBoatName(boat.name || "Unknown boat")}</Link>
                          <div className="text-xs text-muted-foreground sm:hidden">Helm: {boat.helm || "—"} · Crew: {crew}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{classInfo?.name || "—"}{result.division && <span className="ml-1 font-semibold text-ocean">· {result.division}</span>}</td>
                        <td className="hidden px-3 py-2.5 text-muted-foreground md:table-cell">{boat.helm || "—"}</td>
                        <td className="hidden px-3 py-2.5 text-muted-foreground lg:table-cell">{crew}</td>
                        {hasTiming && <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{result.code === "FINISHED" ? fmtSeconds(elapsed) : "—"}</td>}
                        {hasTiming && <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{result.code === "FINISHED" ? fmtSeconds(corrected) : "—"}</td>}
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-ocean">
                          <span>{result.points ?? "—"}</span>
                          {resultCode && <Badge variant="outline" className={`ml-1 align-middle text-[10px] ${CODE_COLORS[resultCode] || ""}`}>{resultCode}</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
