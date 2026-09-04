import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { competitionPath, competitionTagClass, competitionType, competitionTypeLabel } from "@/lib/competition";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { ArrowLeft, ArrowRight, Building2, CalendarDays, Flag, LogIn, Sailboat, Trophy } from "lucide-react";

const DEFAULT_CLASS_COLOUR = "#0A369D";

function ClassMark({ classData, size = "h-20 w-20" }) {
  if (classData?.icon) {
    return <img src={classData.icon} alt="" className={`${size} shrink-0 rounded-2xl object-cover shadow-lg`} />;
  }
  return (
    <div className={`${size} shrink-0 rounded-2xl grid place-items-center text-white shadow-lg`} style={{ backgroundColor: classData?.color || DEFAULT_CLASS_COLOUR }}>
      <Sailboat className="h-10 w-10" />
    </div>
  );
}

function CompetitionType({ competition }) {
  const championship = competitionType(competition || {}) !== "regatta";
  return (
    <Badge className={`gap-1.5 rounded-full border ${competitionTagClass(competition || {})}`}>
      {championship ? <Trophy className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
      {competitionTypeLabel(competition || {})}
    </Badge>
  );
}

function SeriesCard({ item, clubSlug }) {
  const competition = item.competition;
  const itemClubSlug = item.club_slug || clubSlug;
  const href = competition && itemClubSlug
    ? competitionPath({ ...competition, series_type: item.series_type }, itemClubSlug)
    : `/club/${itemClubSlug || ""}?class=${item.class_id || ""}&series=${item.id}${item.year ? `&year=${item.year}` : ""}`;
  return (
    <Link to={href} className="group block rounded-2xl border border-border bg-card p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-ocean/45 hover:shadow-lg" data-testid={`class-series-${item.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <CompetitionType competition={competition || item} />
            <Badge variant="outline" className="font-mono">{item.year}</Badge>
          </div>
          <h2 className="font-heading text-xl uppercase leading-tight tracking-tight text-ocean group-hover:text-safety">{competition?.name || item.name}</h2>
          {competition && competition.name !== item.name && <p className="mt-0.5 text-xs font-semibold text-foreground">Series: {item.name}</p>}
          {item.club_name && <p className="mt-1 text-xs font-semibold text-muted-foreground">{item.club_name}{item.class_name ? ` · ${item.class_name}` : ""}</p>}
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-safety" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {competition?.date_label && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-ocean" />{competition.date_label}</span>}
        {competition?.host_club && <span className="inline-flex items-center gap-1"><Flag className="h-3.5 w-3.5 text-ocean" />{competition.host_club}</span>}
        <span className="font-semibold text-foreground">{item.race_count} {item.race_count === 1 ? "race" : "races"}</span>
      </div>
      <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ocean group-hover:text-safety">View results <ArrowRight className="h-3.5 w-3.5" /></div>
    </Link>
  );
}

export default function Class() {
  const { classId, classKey } = useParams();
  const groupedView = Boolean(classKey);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setLoading(true); setMissing(false); setData(null);
    const request = groupedView ? api.getClassGroupDirectory(classKey) : api.getClassDirectory(classId);
    request.then(setData).catch(() => setMissing(true)).finally(() => setLoading(false));
  }, [classId, classKey, groupedView]);

  const grouped = useMemo(() => {
    const byYear = new Map();
    (data?.series || []).forEach((item) => {
      const year = item.year;
      if (!byYear.has(year)) byYear.set(year, new Map());
      const clubKey = item.club_id || item.club_name || "club";
      const clubs = byYear.get(year);
      if (!clubs.has(clubKey)) clubs.set(clubKey, { name: item.club_name || "Club results", items: [] });
      clubs.get(clubKey).items.push(item);
    });
    return [...byYear.entries()]
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([year, clubs]) => [year, [...clubs.values()].sort((a, b) => a.name.localeCompare(b.name))]);
  }, [data]);

  if (loading) return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading…</div>;
  if (missing || !data) {
    return <div className="min-h-screen grid place-items-center bg-background"><div className="text-center space-y-4"><p className="text-muted-foreground">Class not found.</p><Link to="/"><Button variant="outline" className="gap-2 border-ocean text-ocean"><ArrowLeft className="h-4 w-4" /> Back to all classes</Button></Link></div></div>;
  }

  const classData = data.class || {};
  const club = data.club || {};
  const groupedClubs = data.clubs || [];
  const classCount = data.classes?.length || 1;
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/"><Logo className="h-11 w-auto shrink-0" /></Link>
            <span className="hidden h-6 w-px bg-border sm:block" />
            <span className="hidden truncate font-heading text-lg uppercase tracking-tight sm:block">{groupedView ? "One-design fleet" : club.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/login"><Button variant="outline" size="sm" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white"><LogIn className="h-4 w-4" /> Officials</Button></Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-ocean-dark text-white">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-safety/20 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-white/75 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to all classes</Link>
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <ClassMark classData={classData} />
            <div>
              <Badge className="mb-3 border border-white/30 bg-white/15 text-white uppercase tracking-widest">{groupedView ? "One-design fleet" : "Class results"}</Badge>
              <h1 className="font-heading text-4xl uppercase leading-none tracking-tight sm:text-6xl">{classData.name}</h1>
              <p className="mt-3 max-w-2xl text-white/75">{groupedView ? `All championships, series and regattas for this fleet across ${classCount} clubs.` : "All championships, series and regattas connected to this fleet."}</p>
              {groupedView && groupedClubs.length > 0 && <p className="mt-2 text-sm font-semibold text-white/60">{groupedClubs.map((item) => item.name).join(" · ")}</p>}
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-10">
        {!grouped.length ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center"><Sailboat className="mx-auto h-8 w-8 text-ocean/50" /><p className="mt-3 font-heading text-xl uppercase">No championships or regattas yet</p><p className="mt-1 text-sm text-muted-foreground">Results for this class will appear here when a series is set up.</p></div>
        ) : grouped.map(([year, clubs]) => (
          <section key={year} className="mb-10" data-testid={`class-year-${year}`}>
            <div className="mb-5 flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-safety">{year} season</p><h2 className="font-heading text-3xl uppercase tracking-tight text-ocean">Championships &amp; regattas</h2></div><Badge variant="outline">{clubs.reduce((count, clubGroup) => count + clubGroup.items.length, 0)} competitions</Badge></div>
            <div className="space-y-7">
              {clubs.map((clubGroup) => (
                <section key={clubGroup.name} data-testid={`class-club-${year}-${clubGroup.name}`}>
                  <div className="mb-3 flex items-center gap-2 border-b border-border pb-2">
                    <Building2 className="h-4 w-4 text-safety" />
                    <h3 className="font-heading text-xl uppercase tracking-tight text-foreground">{clubGroup.name}</h3>
                    <span className="text-xs text-muted-foreground">{clubGroup.items.length} {clubGroup.items.length === 1 ? "competition" : "competitions"}</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">{clubGroup.items.map((item) => <SeriesCard key={`${item.id}-${item.class_id}`} item={item} clubSlug={club.slug} />)}</div>
                </section>
              ))}
            </div>
          </section>
        ))}
      </main>
      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground"><Logo className="mx-auto h-8 w-auto" /><p className="mt-2">SailScore · {groupedView ? classData.name : club.name}</p></footer>
    </div>
  );
}
