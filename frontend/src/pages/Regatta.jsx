import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeriesStandingsTable } from "@/components/StandingsTable";
import { exportSeriesPdf } from "@/lib/exportPdf";
import { competitionImage, competitionStatusLabel } from "@/lib/competition";
import { ArrowLeft, ArrowRight, CalendarDays, Download, MapPin, Medal, Trophy } from "lucide-react";
import { fmtDate } from "@/lib/helpers";
import NoticeBoard from "@/components/NoticeBoard";
import ResultsSubscription from "@/components/ResultsSubscription";

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
  const [noticeBoard, setNoticeBoard] = useState(null);

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
    if (!regattaId) return;
    if (!club) return;
    api.getRegattaNoticeBoard(regattaId, { club_id: club.id }).then(setNoticeBoard).catch(() => setNoticeBoard(null));
  }, [regattaId, club]);

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

  // Medal chip styling for the 1st / 2nd / 3rd podium rows on the overview.
  const PODIUM = [
    { chip: "bg-amber-100 text-amber-600", label: "1st" },
    { chip: "bg-slate-200 text-slate-500", label: "2nd" },
    { chip: "bg-orange-100 text-orange-700", label: "3rd" },
  ];

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
        <div className="relative -mx-4 mb-6 h-48 overflow-hidden border border-border bg-ocean/10 sm:mx-0 sm:h-72 sm:rounded-[1.5rem]">
          <img src={competitionImage(regatta)} alt={`${regatta.name} photo`} className="absolute inset-0 h-full w-full object-cover" style={{ filter: "saturate(.9) contrast(1.04)" }} />
          <div className="absolute inset-0 bg-ocean/25 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#071d55]/85 via-[#0a369d]/10 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-end justify-between gap-3 sm:bottom-5 sm:left-6 sm:right-6">
            <div className="flex flex-wrap gap-2">
              {regatta.competition_type === "championship" ? (
                <Badge className="gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700 shadow-sm"><Trophy className="h-3.5 w-3.5" />{compLabel}</Badge>
              ) : (
                <Badge className="gap-1.5 rounded-full border border-white/60 bg-white/90 px-3 py-1 text-xs font-bold text-ocean shadow-sm"><CalendarDays className="h-3.5 w-3.5" />Regatta</Badge>
              )}
              <Badge className="rounded-full border border-white/70 bg-white/90 px-3 py-1 text-xs font-bold text-foreground shadow-sm">{competitionStatusLabel(regatta)}</Badge>
            </div>
            <span className="rounded-full bg-black/35 px-3 py-1 text-xs font-semibold tracking-wide text-white backdrop-blur-sm">
              {regatta.class_count || classNames.length} {Number(regatta.class_count || classNames.length) === 1 ? "class" : "classes"} · {regatta.race_count || 0} {Number(regatta.race_count) === 1 ? "race" : "races"}
            </span>
          </div>
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
              <p className="text-sm text-muted-foreground mb-5">Each class is summarised separately — tap a class to see its full results.</p>
              <div className="grid gap-5 md:grid-cols-2">
                {classNames.map((cn) => (
                  <div key={cn} role="button" tabIndex={0}
                    onClick={() => { setClassFilter(cn); setTab("results"); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setClassFilter(cn); setTab("results"); } }}
                    data-testid={`regatta-class-card-${cn}`}
                    className="group cursor-pointer rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-ocean/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-heading text-lg uppercase tracking-tight flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-ocean/10 text-ocean"><Trophy className="w-4 h-4" /></span>
                        {cn}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground group-hover:text-ocean">
                        View results <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                    {seriesOf(cn).map((s, si) => (
                      <div key={s.id} className={`mt-3 rounded-xl border p-3 ${si % 2 === 0 ? "border-ocean/20 bg-ocean/5" : "border-amber-200 bg-amber-50"}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{s.name !== regatta.name ? s.name : "Overall"}</div>
                          <div className="text-xs text-muted-foreground">{s.race_count} races · {s.boat_count} boats</div>
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {(s.podium || []).map((p, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${PODIUM[i]?.chip || "bg-muted text-muted-foreground"}`} title={PODIUM[i]?.label}>
                                <Medal className="w-3.5 h-3.5" />
                              </span>
                              <span className="w-5 font-mono text-xs text-muted-foreground">{p.rank}</span>
                              <strong className="truncate">{p.boat_name}</strong>
                              {p.sail_no && <span className="hidden sm:inline font-mono text-xs text-muted-foreground">{p.sail_no}</span>}
                              <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">{p.net} pts</span>
                            </div>
                          ))}
                          {(s.podium || []).length === 0 && (
                            <div className="text-sm"><span className="text-muted-foreground">Winner:</span> <strong>{s.winner || "—"}</strong></div>
                          )}
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
              <div className="mb-5 rounded-xl border border-ocean/20 bg-ocean/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-heading uppercase tracking-tight text-ocean">{noticeBoard?.title || `${regatta.name} Official Notice Board`}</div>
                    <p className="mt-1 text-sm text-muted-foreground">Official notices for this competition only. Club-wide notices remain on the main club board.</p>
                  </div>
                  {noticeBoard && <ResultsSubscription
                    subscriptionType="notice_board"
                    targetId={noticeBoard.id}
                    targetName={noticeBoard.title || `${regatta.name} Official Notice Board`}
                    buttonLabel="Subscribe to this ONB"
                    dialogTitle={`Subscribe to ${regatta.name} notices`}
                    description={<>We'll email you whenever a new notice is published to the <strong className="text-foreground">{noticeBoard.title || `${regatta.name} Official Notice Board`}</strong>. No Sailscore account is needed.</>}
                  />}
                </div>
              </div>
              {noticeBoard ? <NoticeBoard clubId={club.id} boardId={noticeBoard.id} embedded /> : (
                <p className="text-sm text-muted-foreground">The competition notice board is unavailable.</p>
              )}
              <p className="text-sm text-muted-foreground mt-4">Dates: {fmtDate(regatta.start_date)}{regatta.end_date && regatta.end_date !== regatta.start_date ? ` – ${fmtDate(regatta.end_date)}` : ""}</p>
            </div>
          )}
        </Tabs>
      </main>
    </div>
  );
}
