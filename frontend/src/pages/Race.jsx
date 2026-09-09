import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, MapPin, Users } from "lucide-react";
import { fmtDate, fmtSeconds, elapsedSecondsOf, correctedSecondsOf, CODE_COLORS, shouldWrapBoatName, wrapBoatName } from "@/lib/helpers";

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

function displayTime(value, hasTiming) {
  return hasTiming ? fmtSeconds(value) : "Not applicable";
}

export default function Race() {
  const { slug, raceId } = useParams();
  const [race, setRace] = useState(null);
  const [boats, setBoats] = useState({});
  const [series, setSeries] = useState(null);
  const [classInfo, setClassInfo] = useState(null);
  const [regatta, setRegatta] = useState(null);
  const [standings, setStandings] = useState(null);

  useEffect(() => {
    let active = true;
    api.getRace(raceId).then(async (result) => {
      const [classBoats, classes, seriesList, regattas, standingsPayload] = await Promise.all([
        api.getBoats({ class_id: result.class_id, club_id: result.club_id }),
        api.getClasses({ club_id: result.club_id }),
        api.getSeries({ club_id: result.club_id, year: result.year }),
        api.getRegattas({ club_id: result.club_id, year: result.year }),
        result.series_id ? api.seriesStandings(result.series_id, result.club_id).catch(() => null) : Promise.resolve(null),
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
    }).catch(() => {
      if (active) setRace(null);
    });
    return () => { active = false; };
  }, [raceId]);

  const rows = useMemo(() => {
    if (!race) return [];
    const pointsByBoat = new Map();
    const raceIndex = (standings?.races || []).findIndex((item) => Number(item.race_number) === Number(race.race_number));
    (standings?.standings || []).forEach((standing) => {
      const score = raceIndex >= 0 ? standing.scores?.[raceIndex] : null;
      pointsByBoat.set(standing.boat_id, score?.points);
    });
    return [...(race.results || [])].sort(resultOrder).map((result) => ({
      ...result,
      points: pointsByBoat.get(result.boat_id),
    }));
  }, [race, standings]);

  if (!race) return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading…</div>;

  const scoringMode = series?.scoring_mode || classInfo?.scoring_mode || "one_design";
  const hasTiming = scoringMode !== "one_design";
  const status = raceStatus(race);
  const parentSeriesHref = series
    ? `/club/${slug}?class=${encodeURIComponent(race.class_id)}&series=${encodeURIComponent(series.id)}&year=${race.year}`
    : `/club/${slug}`;
  const entries = race.entries_count ?? race.results?.length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link to={`/club/${slug}`}>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-ocean">
              <ArrowLeft className="h-4 w-4" /> Back to results
            </Button>
          </Link>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Race results</span><ChevronRight className="h-3.5 w-3.5" />
            <span className="font-semibold text-ocean">R{race.race_number}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-7 sm:py-10">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7" data-testid="race-header">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-safety">{regatta?.name || series?.name || "Race results"}</p>
              <h1 className="mt-1 font-heading text-3xl uppercase tracking-tight text-ocean sm:text-4xl">Race {race.race_number}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{series?.name || "Individual race results"}</p>
            </div>
            <Badge className={RACE_STATUS_CLASS[status] || RACE_STATUS_CLASS.Planned}>{status}</Badge>
          </div>
          <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ocean" /><span><span className="block text-xs uppercase tracking-wider text-muted-foreground">Race date</span><strong>{fmtDate(race.date)}</strong></span></div>
            <div className="flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-ocean" /><span><span className="block text-xs uppercase tracking-wider text-muted-foreground">Scheduled start</span><strong>{race.start_time || classInfo?.default_start_time || "To be confirmed"}</strong></span></div>
            <div className="flex items-start gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0 text-ocean" /><span><span className="block text-xs uppercase tracking-wider text-muted-foreground">Entries</span><strong>{entries}</strong></span></div>
            <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ocean" /><span><span className="block text-xs uppercase tracking-wider text-muted-foreground">Class / fleet</span><strong>{classInfo?.name || "—"}</strong></span></div>
            <div><span className="block text-xs uppercase tracking-wider text-muted-foreground">Scoring</span><strong>{scoringMode === "one_design" ? "One design" : scoringMode.toUpperCase()}</strong></div>
          </div>
          <nav className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4" aria-label="Race parents">
            <Link to={parentSeriesHref} className="text-sm font-semibold text-ocean hover:underline">View parent series</Link>
            {regatta && <><span className="text-muted-foreground">·</span><Link to={`/club/${slug}/regatta/${regatta.id}`} className="text-sm font-semibold text-ocean hover:underline">View {regatta.name}</Link></>}
          </nav>
        </section>

        <section className="mt-7" data-testid="race-results-table">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div><h2 className="font-heading text-2xl uppercase tracking-tight text-ocean">Race results</h2><p className="text-sm text-muted-foreground">Sorted by finishing position · {classInfo?.name || "Fleet results"}</p></div>
            <span className="text-xs text-muted-foreground">{hasTiming ? "Elapsed and corrected times shown" : "Corrected time not applicable to one-design racing"}</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="bg-ocean text-left text-white">
                    <th className="sticky left-0 z-20 bg-ocean px-3 py-2.5">Pos</th>
                    <th className="px-3 py-2.5">Sail Number</th>
                    <th className="px-3 py-2.5">Boat Name</th>
                    <th className="px-3 py-2.5">Class</th>
                    <th className="hidden px-3 py-2.5 md:table-cell">Helm</th>
                    <th className="hidden px-3 py-2.5 lg:table-cell">Crew</th>
                    <th className="px-3 py-2.5 text-right">Elapsed</th>
                    <th className="px-3 py-2.5 text-right">Corrected</th>
                    <th className="px-3 py-2.5 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((result, index) => {
                    const boat = boats[result.boat_id] || {};
                    const position = result.code === "FINISHED" ? Number(result.position) : null;
                    const elapsed = result.code === "FINISHED" ? elapsedSecondsOf(result.finish_time, race) : null;
                    const corrected = result.code === "FINISHED" && hasTiming
                      ? correctedSecondsOf(result.finish_time, race, scoringMode === "py" ? boat.py : boat.tcc, scoringMode)
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
                          <Link to={`/boat/${boat.fleet_id || result.boat_id}`} className={`font-semibold text-ocean hover:underline ${shouldWrapBoatName(boat.name) ? "whitespace-pre-line break-words" : ""}`}>{wrapBoatName(boat.name || "Unknown boat")}</Link>
                          <div className="text-xs text-muted-foreground sm:hidden">Helm: {boat.helm || "—"} · Crew: {crew}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{classInfo?.name || "—"}</td>
                        <td className="hidden px-3 py-2.5 text-muted-foreground md:table-cell">{boat.helm || "—"}</td>
                        <td className="hidden px-3 py-2.5 text-muted-foreground lg:table-cell">{crew}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{result.code === "FINISHED" ? fmtSeconds(elapsed) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{result.code === "FINISHED" ? displayTime(corrected, hasTiming) : "—"}</td>
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
