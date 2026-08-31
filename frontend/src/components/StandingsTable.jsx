import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Layers, Trophy } from "lucide-react";
import { podiumPlace } from "@/lib/resultCellStyle";
import { shouldWrapBoatName, wrapBoatName } from "@/lib/helpers";

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
};

// Web equivalents of the PDF export's podium fills (see resultCellStyle.js) —
// medal backgrounds with dark text, so the highlight stays readable on screen
// and in print. Dark-mode variants keep the same hues at lower opacity.
const PODIUM_CELL = {
  1: "bg-amber-400/70 dark:bg-amber-400/40", // gold
  2: "bg-slate-300 dark:bg-slate-400/50", // silver
  3: "bg-orange-400/70 dark:bg-orange-400/40", // bronze
};export function SeriesStandingsTable({ data, onOpenMini }) {
  const tableRef = useRef(null);
  useRankPinning(tableRef, [data]);
  if (!data || !data.standings?.length) {
    return <p data-testid="no-standings" className="text-muted-foreground text-sm py-6">No results published yet for this series.</p>;
  }

  const races = data.races || [];
  const schedule = data.schedule || [];
  // The planned/TBC columns only make sense while the scored races run
  // contiguously from race 1. When a race has been abandoned (or is otherwise
  // missing), the remaining races no longer line up with their schedule index,
  // so padding with an index-derived race number would invent a duplicate —
  // show only the races actually scored instead.
  // Check if published races are contiguous (no gaps between them), regardless
  // of whether they start from race 1. This allows future planned races to
  // be shown as TBC columns even when earlier races haven't been published yet.
  const sortedRaceNums = races.map((r) => r.race_number).sort((a, b) => a - b);
  const contiguous = sortedRaceNums.length === 0 ||
    sortedRaceNums.every((n, i) => i === 0 || n === sortedRaceNums[i - 1] + 1);
  // When viewing a mini-series group (combined or individual), the parent
  // series' planned_races / schedule would pad phantom columns for races
  // outside the group — cap at the actual race count so only the group's
  // races are shown.
  const isMiniGroupView = !!data.mini_combined;
  const planned = isMiniGroupView ? races.length : (contiguous ? data.planned_races || 0 : races.length);
  const totalCols = isMiniGroupView ? races.length : Math.max(races.length, planned, contiguous ? schedule.length : 0);
  // A combined mini-series day is a single scoring unit: it carries the mini
  // series' name instead of a race number (see _fold_combined_mini_groups).
  const cols = Array.from({ length: totalCols }, (_, i) => {
    const r = races[i];
    return {
      race_number: r ? r.race_number : i + 1,
      date: r ? r.date : schedule[i] ?? null,
      mini_name: r ? r.mini_name : null,
      combined: r ? !!r.combined : false,
      mini_races: r ? r.mini_races : null,
      mini_index: r ? r.mini_index : null,
    };
  });
  const fmtScore = (s) => {
    const val = Number.isInteger(s.points) ? s.points : s.points.toFixed(1);
    const showCode = s.code && s.code !== "FINISHED" && s.code !== "MINI";
    const label = showCode ? `${val} ${s.code}` : `${val}`;
    return s.discarded ? `(${label})` : label;
  };
  const miniCombined = data.mini_combined || null;
  const combinedGroups = (data.mini_series?.groups || []).filter((g) => g.scoring === "combined");
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
                {r.combined && onOpenMini ? (
                  <button onClick={() => onOpenMini(r.mini_index)} data-testid={`open-mini-${r.mini_index || i}`}
                    className="inline-flex items-center gap-1.5 underline decoration-dotted underline-offset-4 hover:text-safety transition-colors" title={`View the ${r.mini_races || ""} races that make up this combined result`}>
                    <Layers className="w-3.5 h-3.5 shrink-0" />
                    <span>{r.mini_name || `R${r.race_number}`}</span>
                  </button>
                ) : (
                  <div>{r.mini_name || `R${r.race_number}`}</div>
                )}
                {r.combined
                  ? <div className="text-[10px] font-body font-normal text-white/70 mt-0.5">combined{r.mini_races ? ` · ${r.mini_races} races` : ""}</div>
                  : (r.date
                    ? <div className="text-[10px] font-body font-normal text-white/70 mt-0.5">{fmtDateShort(r.date)}</div>
                    : <div className="text-[10px] font-body font-normal text-white/40 mt-0.5">TBC</div>)}
              </TableHead>
            ))}
            {miniCombined && <TableHead className="text-white text-center">Daily avg</TableHead>}
            <TableHead className="text-white text-center">Total</TableHead>
            <TableHead className="text-white text-center">Net</TableHead>
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
              <TableCell className={`sticky z-10 bg-inherit${shouldWrapBoatName(row.boat_name) ? " max-w-52" : ""}`} style={{ left: "var(--rank-w, 3rem)" }}>
                {/* Long names (>14 chars) wrap at a space onto a second line
                    (wrapBoatName inserts the break at the last space within
                    the 14-character head); short names keep the single
                    unbroken line. The helm line below already wraps
                    naturally — the boat name simply stops forcing the column
                    wider. */}
                <Link to={`/boat/${row.boat_id}`} className={`font-semibold leading-tight ${shouldWrapBoatName(row.boat_name) ? "whitespace-pre-line break-words" : "whitespace-nowrap"} hover:text-ocean transition-colors`} data-testid={`boat-link-${row.sail_no}`}>{wrapBoatName(row.boat_name)}</Link>
                <div className="font-mono text-xs text-muted-foreground">
                  <Link to={`/boat/${row.boat_id}`} className="hover:text-ocean transition-colors" data-testid={`boat-sail-link-${row.sail_no}`}>{row.sail_no}</Link> · {row.helm}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">{row.home_club || "—"}</TableCell>
              {cols.map((_, j) => {
                const s = (row.scores || [])[j];
                if (!s) return <TableCell key={j} className="text-center text-muted-foreground/30">–</TableCell>;
                // Discard beats podium: a discarded 1st/2nd/3rd keeps the grey
                // italic discard style, never the medal fill.
                const place = podiumPlace(s);
                const podium = place ? PODIUM_CELL[place] : "";
                return (
                  <TableCell key={j} className={`text-center font-mono text-sm ${s.discarded ? "text-muted-foreground/70 italic" : podium ? `${podium} font-bold` : ""} ${s.code && s.code !== "FINISHED" && s.code !== "MINI" ? "text-red-600 dark:text-red-400" : ""}`}>
                    {fmtScore(s)}
                  </TableCell>
                );
              })}
              {miniCombined && (
                <TableCell className="text-center font-mono font-bold text-ocean" data-testid="daily-avg-cell">
                  {row.combined_average != null ? row.combined_average : "–"}
                </TableCell>
              )}
              <TableCell className="text-center font-mono font-bold text-ocean">{row.total}</TableCell>
              <TableCell className="text-center font-mono text-muted-foreground">{row.net}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="text-xs text-muted-foreground px-3 py-2 bg-muted/30">
        {data.locked && <span className="font-semibold text-emerald-700">🔒 Season locked</span>}
        {data.race_count} race{data.race_count !== 1 ? "s" : ""} sailed
        {data.discards > 0 ? ` · ${data.discards} discard${data.discards !== 1 ? "s" : ""} applied (shown in brackets)` : " · no discards yet"}
        {combinedGroups.length > 0 ? ` · ${combinedGroups.length} combined mini-series day${combinedGroups.length !== 1 ? "s" : ""} (avg after mini discards)` : ""}
        {miniCombined ? ` · daily result = average of counting mini races after ${miniCombined.discards || 0} discard${(miniCombined.discards || 0) !== 1 ? "s" : ""}` : ""}
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
            <TableHead className="text-white text-center">Net</TableHead>
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
              <TableCell className={`sticky z-10 bg-inherit${shouldWrapBoatName(row.boat_name) ? " max-w-52" : ""}`} style={{ left: "var(--rank-w, 3rem)" }}>
                <Link to={`/boat/${row.boat_id}`} className={`font-semibold leading-tight ${shouldWrapBoatName(row.boat_name) ? "whitespace-pre-line break-words" : "whitespace-nowrap"} hover:text-ocean transition-colors`} data-testid={`boat-link-${row.sail_no}`}>{wrapBoatName(row.boat_name)}</Link>
                <div className="font-mono text-xs text-muted-foreground">
                  <Link to={`/boat/${row.boat_id}`} className="hover:text-ocean transition-colors" data-testid={`boat-sail-link-${row.sail_no}`}>{row.sail_no}</Link> · {row.helm}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">{row.home_club || "—"}</TableCell>
              {data.series_names.map((s) => (
                <TableCell key={s} className="text-center font-mono text-sm text-muted-foreground hidden md:table-cell">
                  {row.per_series[s] ?? "—"}
                </TableCell>
              ))}
              <TableCell className="text-center font-mono font-bold text-ocean text-lg">{row.total}</TableCell>
              <TableCell className="text-center font-mono text-muted-foreground text-lg">{row.net}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
