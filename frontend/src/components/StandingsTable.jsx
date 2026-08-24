import { useEffect, useRef } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy } from "lucide-react";

// Keep the rank (#) column pinned at the left edge and offset the sticky Boat
// column by the rank column's ACTUAL rendered width, so the two sit
// side-by-side while every other column scrolls underneath them. The width is
// content-driven (trophy + single or double-digit ranks), so it is measured
// once per data change and exposed as --rank-w on the scroll container.
function useRankPinning(ref, deps) {
  useEffect(() => {
    const box = ref.current?.closest(".overflow-x-auto");
    const th = ref.current?.querySelector("thead th");
    if (box && th) box.style.setProperty("--rank-w", `${th.getBoundingClientRect().width}px`);
  }, deps); // eslint-disable-line
}

const fmtDateShort = (dstr) => {
  if (!dstr) return "";
  try {
    return new Date(dstr + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  } catch {
    return dstr;
  }
};

const medal = (rank) => {
  if (rank === 1) return "text-amber-500";
  if (rank === 2) return "text-slate-400";
  if (rank === 3) return "text-orange-600 dark:text-orange-400";
  return "text-muted-foreground";
};export function SeriesStandingsTable({ data }) {
  const tableRef = useRef(null);
  useRankPinning(tableRef, [data]);
  if (!data || !data.standings?.length) {
    return <p data-testid="no-standings" className="text-muted-foreground text-sm py-6">No results published yet for this series.</p>;
  }

  const races = data.races || [];
  const schedule = data.schedule || [];
  const totalCols = Math.max(races.length, data.planned_races || 0, schedule.length);
  const cols = Array.from({ length: totalCols }, (_, i) => ({
    race_number: races[i]?.race_number ?? i + 1,
    date: races[i]?.date ?? schedule[i] ?? null,
  }));
  const fmtScore = (s) => {
    const val = Number.isInteger(s.points) ? s.points : s.points.toFixed(1);
    const label = s.code && s.code !== "FINISHED" ? `${val} ${s.code}` : `${val}`;
    return s.discarded ? `(${label})` : label;
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table data-testid="series-standings-table" ref={tableRef}>
        <TableHeader>
          <TableRow className="bg-ocean text-white hover:bg-ocean">
            <TableHead className="text-white w-12 sticky left-0 z-20 bg-ocean">#</TableHead>
            <TableHead className="text-white sticky z-10 bg-ocean" style={{ left: "var(--rank-w, 3rem)" }}>Boat</TableHead>
            <TableHead className="text-white">Club</TableHead>
            {cols.map((r, i) => (
              <TableHead key={i} className="text-white text-center font-mono whitespace-nowrap align-bottom">
                <div>R{r.race_number}</div>
                {r.date
                  ? <div className="text-[10px] font-body font-normal text-white/70 mt-0.5">{fmtDateShort(r.date)}</div>
                  : <div className="text-[10px] font-body font-normal text-white/40 mt-0.5">TBC</div>}
              </TableHead>
            ))}
            <TableHead className="text-white text-center">Net</TableHead>
            <TableHead className="text-white text-center hidden sm:table-cell">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.standings.map((row, i) => (
            // Opaque row backgrounds, hover included: the sticky Boat column
            // uses bg-inherit, so any translucency (the base row's
            // hover:bg-muted/50 included) lets columns scrolling underneath it
            // show through and overlap the boat name.
            <TableRow key={row.boat_id} className={i % 2 ? "bg-muted hover:bg-muted" : "bg-card hover:bg-muted"} data-testid={`standing-row-${row.sail_no}`}>
              <TableCell className="font-heading text-lg sticky left-0 z-20 bg-inherit">
                <span className={`inline-flex items-center gap-1 ${medal(row.rank)}`}>
                  {row.rank <= 3 && <Trophy className="w-4 h-4" />} {row.rank}
                </span>
              </TableCell>
              <TableCell className="sticky z-10 bg-inherit" style={{ left: "var(--rank-w, 3rem)" }}>
                <div className="font-semibold leading-tight whitespace-nowrap">{row.boat_name}</div>
                <div className="font-mono text-xs text-muted-foreground">{row.sail_no} · {row.helm}</div>
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">{row.home_club || "—"}</TableCell>
              {cols.map((_, j) => {
                const s = (row.scores || [])[j];
                if (!s) return <TableCell key={j} className="text-center text-muted-foreground/30">–</TableCell>;
                return (
                  <TableCell key={j} className={`text-center font-mono text-sm ${s.discarded ? "text-muted-foreground/70 italic" : ""} ${s.code && s.code !== "FINISHED" ? "text-red-600 dark:text-red-400" : ""}`}>
                    {fmtScore(s)}
                  </TableCell>
                );
              })}
              <TableCell className="text-center font-mono font-bold text-ocean">{row.net}</TableCell>
              <TableCell className="text-center font-mono text-muted-foreground hidden sm:table-cell">{row.total}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="text-xs text-muted-foreground px-3 py-2 bg-muted/30">
        {data.locked && <span className="font-semibold text-emerald-700">🔒 Season locked</span>}
        {data.race_count} race{data.race_count !== 1 ? "s" : ""} sailed
        {data.discards > 0 ? ` · ${data.discards} discard${data.discards !== 1 ? "s" : ""} applied (shown in brackets)` : " · no discards yet"}
        {data.scoring_config?.a5_convention === "a5_3" ? " · RRS A5.3 start-area scoring in effect" : ""}
        {data.scoring_config?.a5_convention === "finishers" ? " · finishers + 1 scoring in effect" : ""}
        {data.scoring_config?.tle?.enabled ? ` · TLE in effect${data.scoring_config.tle.time_limit_minutes ? ` (${data.scoring_config.tle.time_limit_minutes} min)` : ""}` : ""}
        {data.engine_version ? ` · engine ${data.engine_version}` : ""}
        {data.snapshot_version ? ` · snapshot v${data.snapshot_version}${data.locked_at ? ` ${new Date(data.locked_at).toLocaleDateString()}` : ""}` : ""}
      </div>
    </div>
  );
}

export function OverallStandingsTable({ data }) {
  const tableRef = useRef(null);
  useRankPinning(tableRef, [data]);
  if (!data || !data.standings?.length) {
    return <p data-testid="no-overall" className="text-muted-foreground text-sm py-6">No overall results yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table data-testid="overall-standings-table" ref={tableRef}>
        <TableHeader>
          <TableRow className="bg-ocean-dark text-white hover:bg-ocean-dark">
            <TableHead className="text-white w-12 sticky left-0 z-20 bg-ocean-dark">#</TableHead>
            <TableHead className="text-white sticky z-10 bg-ocean-dark" style={{ left: "var(--rank-w, 3rem)" }}>Boat</TableHead>
            <TableHead className="text-white">Club</TableHead>
            {data.series_names.map((s) => (
              <TableHead key={s} className="text-white text-center hidden md:table-cell whitespace-nowrap">{s}</TableHead>
            ))}
            <TableHead className="text-white text-center">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.standings.map((row, i) => (
            <TableRow key={row.boat_id} className={i % 2 ? "bg-muted hover:bg-muted" : "bg-card hover:bg-muted"} data-testid={`overall-row-${row.sail_no}`}>
              <TableCell className="font-heading text-lg sticky left-0 z-20 bg-inherit">
                <span className={`inline-flex items-center gap-1 ${medal(row.rank)}`}>
                  {row.rank <= 3 && <Trophy className="w-4 h-4" />} {row.rank}
                </span>
              </TableCell>
              <TableCell className="sticky z-10 bg-inherit" style={{ left: "var(--rank-w, 3rem)" }}>
                <div className="font-semibold leading-tight">{row.boat_name}</div>
                <div className="font-mono text-xs text-muted-foreground">{row.sail_no} · {row.helm}</div>
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">{row.home_club || "—"}</TableCell>
              {data.series_names.map((s) => (
                <TableCell key={s} className="text-center font-mono text-sm text-muted-foreground hidden md:table-cell">
                  {row.per_series[s] ?? "—"}
                </TableCell>
              ))}
              <TableCell className="text-center font-mono font-bold text-ocean text-lg">{row.net}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
