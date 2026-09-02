import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeriesStandingsTable } from "@/components/StandingsTable";
import { exportSeriesPdf } from "@/lib/exportPdf";
import { ArrowLeft, CalendarDays, Download, MapPin, Trophy } from "lucide-react";
import { fmtDate } from "@/lib/helpers";

// Human label for a competition's type + championship scope, e.g.
// "Class Championship" or "Regatta".
function competitionLabel(regatta) {
  if ((regatta.competition_type || "regatta") !== "championship") return "Regatta";
  const scope = regatta.championship_scope;
  if (scope === "club") return "Club Championship";
  if (scope === "class") return "Class Championship";
  if (scope === "open") return "Open Championship";
  return "Championship";
}

export default function Regatta() {
  const { slug, regattaId } = useParams();
  const [club, setClub] = useState(null);
  const [regatta, setRegatta] = useState(null);
  const [tab, setTab] = useState("overview");
  const [classFilter, setClassFilter] = useState("all");
  // Standings payloads per series id, fetched lazily when the Results tab
  // needs them (never duplicated or written — straight from the series API).
  const [standings, setStandings] = useState({});

  useEffect(() => {
    api.getClubs().then((cs) => {
      setClub((cs || []).find((c) => c.slug === slug) || (cs || [])[0] || null);
    }).catch(() => {});
  }, [slug]);

  useEffect(() => {
    if (!club || !regattaId) return;
    api.getRegatta(regattaId, { club_id: club.id }).then(setRegatta).catch(() => setRegatta(null));
  }, [club, regattaId]);

  // Class names in the order they appear on the cards (first-seen order).
  const classNames = useMemo(() => {
    const seen = [];
    (regatta?.series || []).forEach((s) => {
      if (s.class_name && !seen.includes(s.class_name)) seen.push(s.class_name);
    });
    return seen;
  }, [regatta]);

  useEffect(() => {
    if (tab !== "results" || !regatta || !club) return;
    (regatta.series || []).forEach((s) => {
      if (standings[s.id]) return;
      api.seriesStandings(s.id, club.id).then((d) => setStandings((prev) => ({ ...prev, [s.id]: d }))).catch(() => {});
    });
  }, [tab, regatta, club, standings]);

  if (!regatta) {
    return (
      <div className="min-h-screen bg-background grid place-items-center text-muted-foreground">
        {club ? "Regatta not found." : "Loading…"}
      </div>
    );
  }

  const seriesOf = (className) => (regatta.series || []).filter((s) => s.class_name === className);
  const compLabel = competitionLabel(regatta);

  // One series' results with its own PDF export header, so the competition
  // hierarchy (Competition → Class → Series) is visible in the PDF too.
  const SeriesResults = ({ s, className }) => (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{s.name !== regatta.name ? s.name : "Overall"}</div>
        <Button size="sm" variant="outline" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white"
          onClick={() => exportSeriesPdf({
            clubName: club?.name || "", className, seriesName: s.name !== regatta.name ? s.name : regatta.name,
            year: regatta.year, data: standings[s.id], icon: club?.icon,
            competitionLabel: `${regatta.name} · ${compLabel}`,
          })}>
          <Download className="w-3.5 h-3.5" /> PDF
        </Button>
      </div>
      <SeriesStandingsTable data={standings[s.id]} />
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to={`/club/${club.slug}`}>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-ocean">
              <ArrowLeft className="w-4 h-4" /> Back to results
            </Button>
          </Link>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">
        {regatta.thumbnail && (
          <div className="relative -mx-4 sm:mx-0 sm:rounded-2xl overflow-hidden h-44 sm:h-60 mb-6 border border-border">
            <img src={regatta.thumbnail} alt={`${regatta.name} photo`} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Badge variant="outline">{regatta.status || "Complete"}</Badge>
          {regatta.competition_type === "championship" ? (
            <Badge className="gap-1 bg-amber-100 text-amber-700 border border-amber-300"><Trophy className="w-3 h-3" />{compLabel}</Badge>
          ) : (
            <Badge variant="secondary" className="gap-1"><CalendarDays className="w-3 h-3" />Regatta</Badge>
          )}
        </div>
        <h1 className="text-3xl sm:text-4xl font-heading uppercase tracking-tighter text-ocean">{regatta.name}</h1>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-4 h-4" />{regatta.date_label || "Dates to be confirmed"}</span>
          {regatta.host_club && <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" />{regatta.host_club}</span>}
        </div>
        {regatta.description && <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{regatta.description}</p>}
        <p className="mt-3 text-sm text-muted-foreground">{classNames.join(" · ")}</p>

        <Tabs value={tab} onValueChange={setTab} className="mt-8">
          <TabsList>
            <TabsTrigger value="overview" data-testid="regatta-tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="results" data-testid="regatta-tab-results">Results</TabsTrigger>
            <TabsTrigger value="notice" data-testid="regatta-tab-notice">Notice Board</TabsTrigger>
          </TabsList>

          {tab === "overview" && (
            <div className="pt-6" data-testid="regatta-overview">
              <p className="text-sm text-muted-foreground mb-5">Each class is summarised separately — there is no combined finishing order.</p>
              <div className="grid gap-5 md:grid-cols-2">
                {classNames.map((cn) => (
                  <div key={cn} className="rounded-2xl border border-border bg-card p-5">
                    <div className="font-heading text-lg uppercase tracking-tight flex items-center gap-2"><Trophy className="w-4 h-4 text-ocean" />{cn}</div>
                    {seriesOf(cn).map((s) => (
                      <div key={s.id} className="mt-3 rounded-xl border border-border/70 bg-muted/20 p-3">
                        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{s.name !== regatta.name ? s.name : "Overall"}</div>
                        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                          <span><span className="text-muted-foreground">Winner:</span> <strong>{s.winner || "—"}</strong></span>
                          <span className="text-muted-foreground">{s.race_count} races</span>
                          <span className="text-muted-foreground">{s.boat_count} boats</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "results" && (
            <div className="pt-6" data-testid="regatta-results">
              <div className="flex flex-wrap gap-2 mb-6">
                <button type="button" onClick={() => setClassFilter("all")}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold uppercase transition-colors ${classFilter === "all" ? "border-safety bg-safety text-white shadow-sm" : "border-ocean/30 bg-card text-ocean hover:bg-ocean/5"}`}>
                  All
                </button>
                {classNames.map((cn) => (
                  <button key={cn} type="button" onClick={() => setClassFilter(cn)}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold uppercase transition-colors ${classFilter === cn ? "border-safety bg-safety text-white shadow-sm" : "border-ocean/30 bg-card text-ocean hover:bg-ocean/5"}`}>
                    {cn}
                  </button>
                ))}
              </div>

              {classFilter === "all" ? (
                <div className="space-y-8">
                  {classNames.map((cn) => (
                    <section key={cn}>
                      <h3 className="font-heading text-xl uppercase tracking-tight mb-3 flex items-center gap-2"><Trophy className="w-5 h-5 text-ocean" />{cn}</h3>
                      {seriesOf(cn).map((s) => <SeriesResults key={s.id} s={s} className={cn} />)}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="space-y-8">
                  {seriesOf(classFilter).map((s) => (
                    <section key={s.id}>
                      <h3 className="font-heading text-xl uppercase tracking-tight mb-3">{s.name !== regatta.name ? s.name : regatta.name}</h3>
                      <SeriesResults s={s} className={classFilter} />
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "notice" && (
            <div className="pt-6" data-testid="regatta-notice">
              <p className="text-sm text-muted-foreground mb-4">Race-day notices for this regatta's classes appear on the club's official notice board.</p>
              <Link to={`/club/${club.slug}/notice-board`}>
                <Button variant="outline" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white">Official Notice Board</Button>
              </Link>
              <p className="text-sm text-muted-foreground mt-4">Dates: {fmtDate(regatta.start_date)}{regatta.end_date && regatta.end_date !== regatta.start_date ? ` – ${fmtDate(regatta.end_date)}` : ""}</p>
            </div>
          )}
        </Tabs>
      </main>
    </div>
  );
}
