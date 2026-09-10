import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { fmtDateShort } from "@/lib/helpers";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, ChevronRight, Clock, Flag, Sailboat } from "lucide-react";

/**
 * Shows upcoming (planned / scheduled) races across all series for a club.
 * Uses the existing /api/scheduled-races endpoint.
 */
export default function UpcomingRaces({ clubId, clubSlug, year }) {
  const [races, setRaces] = useState([]);

  useEffect(() => {
    if (!clubId) return;
    let active = true;
    api.scheduledRaces({ club_id: clubId })
      .then((data) => {
        if (!active) return;
        // Filter to only future/today's planned races
        const today = new Date().toISOString().slice(0, 10);
        setRaces((data || []).filter((r) => {
          if (r.status !== "scheduled") return false;
          return r.date >= today;
        }));
      })
      .catch(() => { if (active) setRaces([]); });
    return () => { active = false; };
  }, [clubId]);

  // Group by date
  const grouped = useMemo(() => {
    const byDate = new Map();
    races.forEach((r) => {
      const list = byDate.get(r.date) || [];
      list.push(r);
      byDate.set(r.date, list);
    });
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [races]);

  if (races.length === 0) return null;

  return (
    <section className="mt-10" data-testid="upcoming-racing">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg md:text-xl uppercase tracking-tight flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-ocean" /> Upcoming Racing
          </h2>
          <p className="text-sm text-muted-foreground">Planned races across all series for this club.</p>
        </div>
        <Badge variant="outline" className="border-ocean/30 text-ocean">
          <Flag className="h-3.5 w-3.5 mr-1" />{races.length} race{races.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="space-y-4">
        {grouped.map(([date, dayRaces]) => (
          <div key={date} className="rounded-xl border border-border overflow-hidden">
            <div className="bg-ocean/5 border-b border-border px-4 py-2.5 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-ocean" />
              <span className="font-semibold text-sm">{fmtDateShort(date)}</span>
              <span className="text-xs text-muted-foreground ml-auto">{dayRaces.length} race{dayRaces.length === 1 ? "" : "s"}</span>
            </div>
            <div className="divide-y divide-border">
              {dayRaces.map((r, i) => (
                <div key={`${r.series_id}-${r.race_number}-${i}`} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-ocean/10 grid place-items-center text-ocean shrink-0">
                    <Sailboat className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{r.class_name || "Class"} · Race {r.race_number}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{r.series_name}</span>
                      {r.start_time && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{r.start_time}</span>}
                    </div>
                  </div>
                  {r.race_id ? (
                    <Link to={`/club/${clubSlug}/race/${r.race_id}`} className="text-xs font-semibold text-ocean hover:underline inline-flex items-center gap-1 shrink-0">
                      View <ChevronRight className="w-3 h-3" />
                    </Link>
                  ) : (
                    <Badge variant="outline" className="text-[10px] shrink-0">Planned</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
