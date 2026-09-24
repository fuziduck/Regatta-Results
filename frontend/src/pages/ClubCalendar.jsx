import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import HeaderMenu from "@/components/HeaderMenu";
import Logo from "@/components/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, ChevronRight, Clock, Flag, Sailboat } from "lucide-react";

const monthKey = (date) => date.slice(0, 7);
const monthLabel = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, {
  month: "long", year: "numeric",
});
const dayLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
  weekday: "short", day: "numeric", month: "short",
});

function groupedMonth(key, races) {
  const byDate = (races || []).reduce((out, race) => {
    (out[race.date] ||= []).push(race);
    return out;
  }, {});
  return { key, label: monthLabel(key), dates: Object.keys(byDate).sort(), byDate };
}

export default function ClubCalendar() {
  const { slug } = useParams();
  const [club, setClub] = useState(null);
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.getClubs()
      .then((clubs) => {
        if (!active) return null;
        const found = (clubs || []).find((item) => item.slug === slug) || (clubs || [])[0];
        setClub(found || null);
        if (!found) return [];
        return api.scheduledRaces({ club_id: found.id });
      })
      .then((scheduled) => {
        if (!active || !scheduled) return;
        const today = new Date().toISOString().slice(0, 10);
        setRaces((scheduled || []).filter((race) => race.status === "scheduled" && race.date >= today));
      })
      .catch(() => { if (active) { setClub(null); setRaces([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  const months = useMemo(() => {
    const grouped = new Map();
    races.forEach((race) => {
      const key = monthKey(race.date);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(race);
    });
    return [...grouped.keys()].sort().map((key) => groupedMonth(key, grouped.get(key)));
  }, [races]);

  if (loading) return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading calendar…</div>;
  if (!club) return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Club not found.</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HeaderMenu title={`${club.name} · race calendar`} />
            <Link to="/" className="flex items-center"><Logo className="h-11 w-auto" /></Link>
            <div className="hidden sm:block font-heading text-xl uppercase tracking-tight">{club.name}</div>
          </div>
          <Link to={`/club/${club.slug}`}>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-ocean" data-testid="calendar-back">
              Results <ChevronRight className="w-4 h-4 rotate-180" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <Badge variant="outline" className="mb-3 border-ocean/30 text-ocean"><CalendarDays className="h-3.5 w-3.5 mr-1" />Race calendar</Badge>
            <h1 className="text-3xl sm:text-4xl uppercase tracking-tighter">{club.name} · Future races</h1>
            <p className="mt-2 text-muted-foreground">Every planned race across the club’s classes and series.</p>
          </div>
          <Badge variant="outline" className="border-ocean/30 text-ocean"><Flag className="h-3.5 w-3.5 mr-1" />{races.length} planned</Badge>
        </div>

        {months.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground" data-testid="calendar-empty">
            No future races are planned at this club yet.
          </div>
        ) : (
          <div className="space-y-8" data-testid="club-calendar">
            {months.map((month) => (
              <section key={month.key} className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-ocean/5 flex items-center justify-between">
                  <h2 className="font-heading text-xl uppercase tracking-tight text-ocean">{month.label}</h2>
                  <span className="text-xs text-muted-foreground">{races.filter((race) => monthKey(race.date) === month.key).length} races</span>
                </div>
                <div className="divide-y divide-border">
                  {month.dates.map((date) => {
                    const dayRaces = month.byDate[date];
                    return (
                      <div key={date} data-testid={`calendar-day-${date}`} className="grid gap-3 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:items-start">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-ocean shrink-0" />
                          <span className="font-semibold text-sm">{dayLabel(date)}</span>
                          <span className="text-xs text-muted-foreground">{dayRaces.length} race{dayRaces.length === 1 ? "" : "s"}</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {dayRaces.map((race, raceIndex) => (
                            <div key={`${race.series_id}-${race.race_number}-${raceIndex}`} data-testid="calendar-race" className="flex items-center gap-2 rounded-lg border border-ocean/15 bg-ocean/5 px-3 py-2 text-xs text-ocean" title={`${race.class_name || "Class"} · ${race.series_name} · Race ${race.race_number}`}>
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-ocean/10"><Sailboat className="h-3.5 w-3.5" /></span>
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{race.class_name || "Race"} · R{race.race_number}</span>
                                <span className="block truncate text-muted-foreground">{race.series_name}{race.start_time ? ` · ${race.start_time}` : ""}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
