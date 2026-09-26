import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Layers, Trophy } from "lucide-react";
import { podiumPlace } from "@/lib/resultCellStyle";
import { divisionTables, scoringModeLabel, shouldWrapBoatName, wrapBoatName } from "@/lib/helpers";

// Keep the rank (#) column pinned at the left edge and offset the sticky Boat
// column by the rank column's ACTUAL rendered width, so the two sit
// side-by-side while every other column scrolls underneath them. The width is
// content-driven (trophy + single or double-digit ranks), so it is measured
// once per data change and exposed as --rank-w on the scroll container.
function useRankPinning(ref, deps) {
  useEffect(() => {
    const table = ref.current;
    const box = table?.parentElement?.parentElement?.closest(".overflow-x-auto");
    if (!box || !table) return undefined;
    const measure = () => {
      const headers = [...table.querySelectorAll("thead th")];
      if (headers.length < 4) return;
      const widths = headers.slice(0, 4).map((header) => header.getBoundingClientRect().width);
      if (widths.some((width) => !width)) return;
      box.style.setProperty("--rank-w", `${widths[0]}px`);
      box.style.setProperty("--boat-end", `${widths[0] + widths[1]}px`);
      box.style.setProperty("--total-end", `${widths[0] + widths[1] + widths[2]}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(box);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
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

// A class that fields more than one rating system (IRC boats and YTC boats in
// the same class and series) is scored in one table per division, so each
// division gets its own titled table and an IRC boat is never ranked against a
// YTC boat. A class without divisions renders the single table, unchanged.
function DivisionHeadings({ data, children }) {
  const tables = divisionTables(data);
  if (tables.length < 2) return children(tables[0]);
  return tables.map((table) => (
    <div key={table.division_name} className="mb-6 last:mb-0">
      <h4 className="mb-2 font-heading text-lg uppercase tracking-tight text-ocean"
          data-testid={`division-${table.division_name}`}>
        {table.table_kind === "scoring_mode" ? (
          <span>{table.division_name} <span className="font-body text-sm normal-case text-muted-foreground">results</span></span>
        ) : (
          <>{table.division_name}{" "}
            <span className="font-body text-sm normal-case text-muted-foreground">
              {scoringModeLabel(table.division_scoring_mode)} division
            </span>
          </>
        )}
      </h4>
      {children(table)}
    </div>
  ));
}

export function SeriesStandings({ data, onOpenMini }) {
  return (
    <DivisionHeadings data={data}>
      {(table) => <SeriesStandingsTable data={table} onOpenMini={onOpenMini} />}
    </DivisionHeadings>
  );
}

export function OverallStandings({ data }) {
  return (
    <DivisionHeadings data={data}>
      {(table) => <OverallStandingsTable data={table} />}
    </DivisionHeadings>
  );
}

// Web equivalents of the PDF export's podium fills (see resultCellStyle.js) —
// medal backgrounds with dark text, so the highlight stays readable on screen
// and in print. Dark-mode variants keep the same hues at lower opacity.
const PODIUM_CELL = {
  1: "bg-amber-400/70 dark:bg-amber-400/40", // gold
  2: "bg-slate-300 dark:bg-slate-400/50", // silver
  3: "bg-orange-400/70 dark:bg-orange-400/40", // bronze
};
const PODIUM_POSITION = {
  1: "bg-amber-400 text-amber-950",
  2: "bg-slate-300 text-slate-800 dark:bg-slate-400/70",
  3: "bg-orange-400 text-orange-950 dark:bg-orange-400/70",
};
const PINNED_PODIUM_BACKGROUND = {
  1: "bg-amber-400",
  2: "bg-slate-300 dark:bg-slate-400",
  3: "bg-orange-400",
};

export function SeriesStandingsTable({ data, onOpenMini }) {
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
    <div className="relative">
      <div className="overflow-x-auto rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:overflow-visible" role="region" aria-label="Series standings; scroll horizontally to see each race result" tabIndex={0}>
      <Table data-testid="series-standings-table" ref={tableRef} className="table-fixed min-w-max md:min-w-full [&_th]:px-1.5 [&_th]:py-2 [&_td]:px-1.5 [&_td]:py-2 sm:[&_th]:px-2 sm:[&_td]:p-2 [&_th:nth-child(1)]:w-10 [&_th:nth-child(2)]:w-24 [&_th:nth-child(3)]:w-12 [&_th:nth-child(4)]:w-12 [&_td:nth-child(1)]:w-10 [&_td:nth-child(2)]:w-24 [&_td:nth-child(3)]:w-12 [&_td:nth-child(4)]:w-12 sm:[&_th:nth-child(2)]:!w-28 sm:[&_th:nth-child(3)]:!w-20 sm:[&_th:nth-child(4)]:!w-20 sm:[&_td:nth-child(2)]:!w-28 sm:[&_td:nth-child(3)]:!w-20 sm:[&_td:nth-child(4)]:!w-20 md:[&_th:nth-child(2)]:!w-48 md:[&_td:nth-child(2)]:!w-48">
        <TableHeader>
          <TableRow className="bg-ocean text-white hover:bg-ocean">
            <TableHead className="sticky top-0 left-0 z-30 w-10 bg-ocean text-center text-white" aria-label="Position"><span className="sm:hidden" data-testid="standing-position-mobile">#</span><span className="hidden sm:inline">Position</span></TableHead>
            <TableHead className="sticky top-0 z-20 w-24 bg-ocean text-white sm:!w-28 md:!w-48" style={{ left: "var(--rank-w, 2.5rem)" }}>Sail No. / Boat</TableHead>
            <TableHead className="sticky top-0 z-20 hidden w-12 bg-ocean text-center text-white sm:!w-20 sm:table-cell" style={{ left: "var(--boat-end, 10rem)" }}>Total</TableHead>
            <TableHead className="sticky top-0 z-20 hidden w-12 bg-ocean text-center text-white sm:!w-20 sm:table-cell" style={{ left: "var(--total-end, 13rem)" }}>Net</TableHead>
            {cols.map((r, i) => (
              <TableHead key={i} className="sticky top-0 z-10 w-14 whitespace-nowrap bg-ocean text-center align-bottom font-mono text-white">
                {r.combined && onOpenMini ? (
                  <button onClick={() => onOpenMini(r.mini_index)} data-testid={`open-mini-${r.mini_index || i}`}
                    className="inline-flex min-h-11 items-center gap-1.5 underline decoration-dotted underline-offset-4 hover:text-safety transition-colors" title={`View the ${r.mini_races || ""} races that make up this combined result`}>
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
            {miniCombined && <TableHead className="sticky top-0 z-10 w-16 bg-ocean text-center text-white">Daily avg</TableHead>}
            <TableHead className="sticky top-0 z-10 w-12 bg-ocean text-center text-white sm:hidden" data-testid="standing-total-mobile-header">Total</TableHead>
            <TableHead className="sticky top-0 z-10 w-12 bg-ocean text-center text-white sm:hidden" data-testid="standing-net-mobile-header">Net</TableHead>
            <TableHead className="sticky top-0 z-10 hidden max-w-40 bg-ocean text-white sm:table-cell">Club</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.standings.map((row, i) => (
            // Opaque row backgrounds, hover included: the sticky Boat column
            // uses bg-inherit, so any translucency (the base row's
            // hover:bg-muted/50 included) lets columns scrolling underneath it
            // show through and overlap the boat name.
            <TableRow key={row.boat_id} className={i % 2 ? "bg-muted hover:bg-muted" : "bg-card hover:bg-muted"} data-testid={`standing-row-${row.sail_no}`}>
              <TableCell className={`sticky left-0 z-30 w-10 text-center font-heading text-lg ${PINNED_PODIUM_BACKGROUND[row.rank] || (i % 2 ? "bg-muted" : "bg-card")}`}>
                <span className={`inline-grid h-8 min-w-8 place-items-center rounded-full px-1 font-bold ${PODIUM_POSITION[row.rank] || medal(row.rank)}`}>
                  {row.rank <= 3 && <Trophy className="h-3.5 w-3.5" />} {row.rank}
                </span>
              </TableCell>
              <TableCell className={`sticky z-20 w-24 sm:!w-28 md:!w-48 ${PINNED_PODIUM_BACKGROUND[row.rank] || (i % 2 ? "bg-muted" : "bg-card")}${shouldWrapBoatName(row.boat_name) ? " max-w-52" : ""}`} style={{ left: "var(--rank-w, 2.5rem)" }}>
                {/* Keep sail number and boat identity together; both profile links
                    have a generous tap area on touch screens. */}
                <Link to={`/boat/${row.boat_id}`} className="inline-flex min-h-6 items-center font-mono text-xs font-semibold text-muted-foreground hover:text-ocean transition-colors" data-testid={`boat-sail-link-${row.sail_no}`}>{row.sail_no}</Link>
                <Link to={`/boat/${row.boat_id}`} className={`block min-h-11 content-center font-semibold leading-tight hover:text-ocean transition-colors ${shouldWrapBoatName(row.boat_name) ? "whitespace-pre-line break-words" : "sm:whitespace-nowrap"}`} data-testid={`boat-link-${row.sail_no}`}>{wrapBoatName(row.boat_name)}</Link>
                <div className="hidden font-mono text-xs text-muted-foreground sm:block">{row.helm}</div>
              </TableCell>
              <TableCell className={`sticky z-20 hidden w-12 text-center font-mono font-bold text-ocean sm:!w-20 sm:table-cell ${PINNED_PODIUM_BACKGROUND[row.rank] || (i % 2 ? "bg-muted" : "bg-card")}`} style={{ left: "var(--boat-end, 10rem)" }} data-testid={`standing-total-${row.sail_no}`}>{row.total}</TableCell>
              <TableCell className={`sticky z-20 hidden w-12 text-center font-mono font-bold text-ocean sm:!w-20 sm:table-cell ${PINNED_PODIUM_BACKGROUND[row.rank] || (i % 2 ? "bg-muted" : "bg-card")}`} style={{ left: "var(--total-end, 13rem)" }} data-testid={`standing-net-${row.sail_no}`}>{row.net}</TableCell>
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
              <TableCell className={`w-12 text-center font-mono font-bold text-ocean sm:hidden ${PINNED_PODIUM_BACKGROUND[row.rank] || (i % 2 ? "bg-muted" : "bg-card")}`} data-testid={`standing-total-mobile-${row.sail_no}`}>{row.total}</TableCell>
              <TableCell className={`w-12 text-center font-mono font-bold text-ocean sm:hidden ${PINNED_PODIUM_BACKGROUND[row.rank] || (i % 2 ? "bg-muted" : "bg-card")}`} data-testid={`standing-net-mobile-${row.sail_no}`}>{row.net}</TableCell>
              <TableCell className="hidden max-w-40 whitespace-nowrap text-muted-foreground sm:table-cell">
                {row.home_club_slug ? <Link to={`/club/${row.home_club_slug}`} className="hover:text-ocean transition-colors">{row.home_club || "—"}</Link> : (row.home_club || "—")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
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
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-5 bg-gradient-to-l from-card to-transparent lg:block xl:hidden" aria-hidden="true" />
      <p className="mt-1 text-right text-[10px] text-muted-foreground xl:hidden">Swipe horizontally for race results →</p>
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
                  {row.rank <= 3 && <Trophy className="w-4 h-4" />}
                  <span className="whitespace-nowrap">{row.rank}<span className="text-muted-foreground text-sm font-normal"> / {row.entries ?? data.entries ?? "–"}</span></span>
                </span>
              </TableCell>
              <TableCell className={`sticky z-10 bg-inherit${shouldWrapBoatName(row.boat_name) ? " max-w-52" : ""}`} style={{ left: "var(--rank-w, 3rem)" }}>
                <Link to={`/boat/${row.boat_id}`} className={`font-semibold leading-tight ${shouldWrapBoatName(row.boat_name) ? "whitespace-pre-line break-words" : "whitespace-nowrap"} hover:text-ocean transition-colors`} data-testid={`boat-link-${row.sail_no}`}>{wrapBoatName(row.boat_name)}</Link>
                <div className="font-mono text-xs text-muted-foreground">
                  <Link to={`/boat/${row.boat_id}`} className="hover:text-ocean transition-colors" data-testid={`boat-sail-link-${row.sail_no}`}>{row.sail_no}</Link> · {row.helm}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {row.home_club_slug ? <Link to={`/club/${row.home_club_slug}`} className="hover:text-ocean transition-colors">{row.home_club || "—"}</Link> : (row.home_club || "—")}
              </TableCell>
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
