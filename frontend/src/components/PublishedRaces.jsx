import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { fmtDate, fmtSeconds, elapsedSecondsOf, correctedSecondsOf, CODE_COLORS, shouldWrapBoatName, wrapBoatName } from "@/lib/helpers";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { FlagOff } from "lucide-react";

const STATUS_CLASS = {
  Completed: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
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
  return status === "published" ? "Completed" : "Planned";
}

export default function PublishedRaces({
  seriesId,
  series,
  classId,
  clubId,
  clubSlug,
  scoringMode = "one_design",
  testId = "published-races-accordion",
}) {
  const [races, setRaces] = useState([]);
  const [boats, setBoats] = useState({});
  const [classInfo, setClassInfo] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getRaces({ series_id: seriesId, club_id: clubId }),
      api.getBoats({ class_id: classId, club_id: clubId }),
      api.getClasses({ club_id: clubId }),
    ]).then(([seriesRaces, classBoats, classes]) => {
      if (!active) return;
      setRaces(seriesRaces || []);
      setClassInfo((classes || []).find((item) => item.id === classId) || null);
      const byId = {};
      (classBoats || []).forEach((boat) => { byId[boat.id] = boat; });
      setBoats(byId);
    }).catch(() => {
      if (active) {
        setRaces([]);
        setBoats({});
        setClassInfo(null);
      }
    });
    return () => { active = false; };
  }, [seriesId, classId, clubId]);

  const completed = useMemo(() => races.filter((race) => raceStatus(race) === "Completed"), [races]);
  const sorted = useMemo(() => [...completed].sort((a, b) => (a.date < b.date ? 1 : -1)), [completed]);
  const scheduleRows = useMemo(() => {
    const byNumber = new Map();
    races.filter((race) => race.race_number != null).forEach((race) => {
      const number = Number(race.race_number);
      const group = byNumber.get(number) || [];
      group.push(race);
      byNumber.set(number, group);
    });
    const configured = series?.schedule || [];
    const count = Math.max(Number(series?.planned_races) || 0, configured.length, ...Array.from(byNumber.keys()), 0);
    return Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      const actual = byNumber.get(number) || [];
      const rows = actual.length ? actual : [null];
      return rows.map((race, rowIndex) => ({
        number,
        label: race?.mini_group_label || (rows.length > 1 ? `R${number}${String.fromCharCode(65 + rowIndex)}` : `R${number}`),
        race,
        date: race && raceStatus(race) === "Completed"
          ? race.date
          : configured[index] || race?.original_date || race?.scheduled_date || race?.date || null,
        startTime: race?.start_time || race?.scheduled_start_time || classInfo?.default_start_time || null,
        status: raceStatus(race),
      }));
    }).flat();
  }, [races, series, classInfo]);

  if (!races.length && !scheduleRows.length) return null;

  return (
    <>
      {sorted.length > 0 && <Accordion type="single" collapsible className="mt-6" data-testid={testId}>
        {sorted.map((race) => {
          const rows = [...(race.results || [])].sort((a, b) => {
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
                        {rows.map((result) => {
                          const boat = boats[result.boat_id] || {};
                          return (
                            <tr key={result.boat_id} className="border-b last:border-0">
                              <td className="py-2 font-heading text-base">{result.code === "FINISHED" ? result.position : "–"}</td>
                              <td className={shouldWrapBoatName(boat.name) ? "max-w-52" : ""}>
                                <span className={`font-semibold ${shouldWrapBoatName(boat.name) ? "whitespace-pre-line break-words" : "whitespace-nowrap"}`}>{wrapBoatName(boat.name)}</span>{" "}
                                <span className="font-mono text-xs text-muted-foreground">{boat.sail_no}</span>
                              </td>
                              <td className="text-muted-foreground whitespace-nowrap">{boat.home_club || "—"}</td>
                              <td className="text-muted-foreground">{boat.helm}</td>
                              <td className="text-center"><Badge variant="outline" className={`${CODE_COLORS[result.code] || ""} text-[10px]`}>{result.code}</Badge></td>
                              {scoringMode !== "one_design" && <>
                                <td className="text-muted-foreground">{scoringMode === "py" ? (boat.py ? Math.round(boat.py) : "—") : (boat.boat_type || "—")}</td>
                                <td className="text-right font-mono text-xs">{result.code === "FINISHED" ? fmtSeconds(elapsedSecondsOf(result.finish_time, race)) : "—"}</td>
                                <td className="text-right font-mono text-xs">{result.code === "FINISHED" ? fmtSeconds(correctedSecondsOf(result.finish_time, race, scoringMode === "py" ? boat.py : boat.tcc, scoringMode)) : "—"}</td>
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
      </Accordion>}

      <section className="mt-8" data-testid="race-schedule">
        <div className="mb-3">
          <h3 className="font-heading text-xl uppercase tracking-tight text-ocean">Race Schedule</h3>
          <p className="mt-1 text-sm text-muted-foreground">Every scheduled race in this series, including races still to be sailed.</p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="bg-ocean text-left text-white">
                <th className="px-3 py-2">Race</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Start Time</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Results</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.map((row, index) => (
                <tr key={`${row.number}-${row.race?.id || row.label}`} className={index % 2 ? "bg-muted" : "bg-card"} data-testid={`schedule-row-${row.number}`}>
                  <td className="px-3 py-2 font-heading">
                    {row.status === "Completed" && row.race && clubSlug ? (
                      <Link to={`/club/${clubSlug}/race/${row.race.id}`} className="text-ocean hover:underline">{row.label}</Link>
                    ) : row.label}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{row.date ? fmtDate(row.date) : "To be confirmed"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">{row.startTime || "To be confirmed"}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className={STATUS_CLASS[row.status]}>{row.status}</Badge></td>
                  <td className="px-3 py-2">
                    {row.status === "Completed" && row.race && clubSlug ? (
                      <Link to={`/club/${clubSlug}/race/${row.race.id}`} className="font-semibold text-ocean hover:underline">View Results</Link>
                    ) : <span className="text-xs text-muted-foreground">Results not yet available</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
