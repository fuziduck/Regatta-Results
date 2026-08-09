import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Marquee from "react-fast-marquee";
import { api } from "@/lib/api";
import { fmtDate, fmtTime, fmtDur, CURRENT_YEAR, CODE_COLORS } from "@/lib/helpers";
import { SeriesStandingsTable, OverallStandingsTable } from "@/components/StandingsTable";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Anchor, LifeBuoy, Clock, Flag, LogIn, Sailboat, AlertTriangle } from "lucide-react";

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

function PublishedRaces({ seriesId, classId }) {
  const [races, setRaces] = useState([]);
  const [boats, setBoats] = useState({});

  useEffect(() => {
    api.getRaces({ series_id: seriesId, status: "published" }).then(setRaces);
    api.getBoats({ class_id: classId }).then((bs) => {
      const m = {}; bs.forEach((b) => (m[b.id] = b)); setBoats(m);
    });
  }, [seriesId, classId]);

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
                <div className="w-10 h-10 rounded-lg bg-ocean/10 grid place-items-center text-ocean font-heading text-lg">R{race.race_number}</div>
                <div>
                  <div className="font-semibold">Race {race.race_number}</div>
                  <div className="text-xs text-muted-foreground">{fmtDate(race.date)}</div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              {(() => {
                const showCorrected = rows.some((r) => r.corrected_seconds != null);
                return (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 w-10">Pos</th><th>Boat</th><th>Helm</th>{showCorrected && <th className="text-right">Corrected</th>}<th className="text-center">Code</th><th className="text-right">Finish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const b = boats[r.boat_id] || {};
                      return (
                        <tr key={r.boat_id} className="border-b last:border-0">
                          <td className="py-2 font-heading text-base">{r.code === "FINISHED" ? r.position : "–"}</td>
                          <td><span className="font-semibold">{b.name}</span> <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span></td>
                          <td className="text-muted-foreground">{b.helm}</td>
                          {showCorrected && <td className="text-right font-mono text-xs font-bold text-ocean">{r.corrected_seconds != null ? fmtDur(r.corrected_seconds) : "—"}</td>}
                          <td className="text-center"><Badge variant="outline" className={`${CODE_COLORS[r.code] || ""} text-[10px]`}>{r.code}</Badge></td>
                          <td className="text-right font-mono text-xs">{r.code === "FINISHED" ? fmtTime(r.finish_time) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
                );
              })()}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function ClassResults({ classId }) {
  const [series, setSeries] = useState([]);
  const [tab, setTab] = useState("overall");
  const [overall, setOverall] = useState(null);
  const [seriesData, setSeriesData] = useState({});

  useEffect(() => {
    api.getSeries({ class_id: classId, year: CURRENT_YEAR }).then((s) => {
      setSeries(s); setTab("overall");
    });
    api.overallStandings(classId, CURRENT_YEAR).then(setOverall).catch(() => setOverall(null));
  }, [classId]);

  useEffect(() => {
    if (tab !== "overall" && !seriesData[tab]) {
      api.seriesStandings(tab).then((d) => setSeriesData((prev) => ({ ...prev, [tab]: d })));
    }
  }, [tab]); // eslint-disable-line

  const active = series.find((s) => s.id === tab);

  return (
    <Tabs value={tab} onValueChange={setTab} className="mt-4">
      <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/60 p-1" data-testid="series-tabs">
        <TabsTrigger value="overall" className="data-[state=active]:bg-ocean data-[state=active]:text-white">Overall</TabsTrigger>
        {series.map((s) => (
          <TabsTrigger key={s.id} value={s.id} className="data-[state=active]:bg-ocean data-[state=active]:text-white">
            {s.name}{!s.included_in_overall && <span className="ml-1 text-[10px] opacity-70">(excl.)</span>}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overall" className="pt-5">
        <h3 className="text-xl uppercase tracking-tight mb-3 flex items-center gap-2"><Sailboat className="w-5 h-5 text-ocean" /> Overall Championship</h3>
        <OverallStandingsTable data={overall} />
      </TabsContent>

      {series.map((s) => (
        <TabsContent key={s.id} value={s.id} className="pt-5">
          <h3 className="text-xl uppercase tracking-tight mb-3">{s.name} Series</h3>
          <SeriesStandingsTable data={seriesData[s.id]} />
          {tab === s.id && <PublishedRaces seriesId={s.id} classId={classId} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default function Landing() {
  const [classes, setClasses] = useState([]);
  const [activeClass, setActiveClass] = useState(null);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    api.getClasses().then((c) => { setClasses(c); if (c[0]) setActiveClass(c[0].id); });
    const load = () => api.getNotifications().then(setNotifications).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NotificationBanner items={notifications} />

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
          src="https://static.prod-images.emergentagent.com/jobs/9a281200-d99f-4e2c-a917-cc4479c7c0e0/images/513a9c83841c6acfa0d3c05816b985e8701005ed99f1e193caf2ab4284c14369.jpeg"
          alt="Fleet racing on the tidal River Medway" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 hero-overlay" />
        <div className="relative max-w-6xl mx-auto px-4 py-16 md:py-24">
          <Badge className="bg-safety text-white mb-4 uppercase tracking-widest">{CURRENT_YEAR} Season</Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl uppercase tracking-tighter text-white leading-[0.95] max-w-3xl">
            Live club racing results & standings
          </h1>
          <p className="text-white/80 mt-4 max-w-xl leading-relaxed">
            Follow every fleet across the season. Provisional and confirmed results, series championships and race-day notices — all in one place.
          </p>
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
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

        <h2 className="text-lg md:text-lg uppercase tracking-tight mb-1">Results by class</h2>
        <p className="text-muted-foreground text-sm mb-4">Each fleet races its own series and overall championship.</p>

        {classes.length === 0 ? (
          <p className="text-muted-foreground">No classes set up yet.</p>
        ) : (
          <Tabs value={activeClass || undefined} onValueChange={setActiveClass}>
            <TabsList className="flex flex-wrap h-auto gap-2 bg-transparent p-0" data-testid="class-tabs">
              {classes.map((c) => (
                <TabsTrigger key={c.id} value={c.id}
                  data-testid={`class-tab-${c.name}`}
                  className="px-5 py-2.5 rounded-full border border-border data-[state=active]:bg-ocean data-[state=active]:text-white data-[state=active]:border-ocean font-heading uppercase tracking-wide">
                  {c.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {classes.map((c) => (
              <TabsContent key={c.id} value={c.id}>
                <ClassResults classId={c.id} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        Scored under the RRS Low Point System · {CURRENT_YEAR}
      </footer>
    </div>
  );
}
