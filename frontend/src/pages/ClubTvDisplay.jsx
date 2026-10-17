import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { fmtDate, fmtDateShort } from "@/lib/helpers";
import ClubBadge from "@/components/ClubBadge";
import {
  AlertTriangle,
  Anchor,
  Award,
  CalendarDays,
  CheckCircle2,
  Clock,
  Compass,
  Flag,
  LifeBuoy,
  Megaphone,
  Radio,
  Sailboat,
  ShieldAlert,
  Trophy,
  Tv,
  UserCheck,
  WifiOff,
} from "lucide-react";

// Poll interval for background updates (45 seconds, within the 30-60s spec)
export const TV_POLL_INTERVAL_MS = 45000;
// Maximum competitor rows per page in a TV standings table so text remains
// readable from several metres away on a 1920x1080 screen.
export const TV_ROWS_PER_PAGE = 10;

const PODIUM_BADGE = {
  1: "bg-amber-400 text-slate-950 ring-2 ring-amber-300/60 shadow-lg shadow-amber-500/20",
  2: "bg-slate-200 text-slate-900 ring-2 ring-slate-100/50",
  3: "bg-amber-600 text-white ring-2 ring-amber-500/50",
};

const PODIUM_ROW_BG = {
  1: "bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent border-l-4 border-l-amber-400",
  2: "bg-gradient-to-r from-slate-300/12 via-slate-300/5 to-transparent border-l-4 border-l-slate-300",
  3: "bg-gradient-to-r from-amber-600/15 via-amber-600/5 to-transparent border-l-4 border-l-amber-600",
};

const STATUS_STYLES = {
  scheduled: { label: "Scheduled", cls: "bg-sky-500/20 text-sky-200 border-sky-400/40" },
  racing: { label: "Racing Underway", cls: "bg-emerald-500/25 text-emerald-200 border-emerald-400/50 animate-pulse" },
  provisional: { label: "Provisional Results", cls: "bg-amber-500/25 text-amber-200 border-amber-400/50" },
  completed: { label: "Completed", cls: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40" },
  postponed: { label: "Postponed (AP)", cls: "bg-amber-500/30 text-amber-100 border-amber-400/60" },
  abandoned: { label: "Abandoned (N)", cls: "bg-red-500/30 text-red-100 border-red-400/60" },
  cancelled: { label: "Cancelled", cls: "bg-red-500/30 text-red-100 border-red-400/60" },
};

function chunkRows(rows = [], pageSize = TV_ROWS_PER_PAGE) {
  if (!rows || rows.length === 0) return [];
  const pages = [];
  for (let i = 0; i < rows.length; i += pageSize) {
    pages.push(rows.slice(i, i + pageSize));
  }
  return pages;
}

/**
 * Build the sequence of rotating slides from the TV display payload.
 * Exported as a pure helper so rotation fairness, empty-view skipping,
 * and large-fleet pagination can be unit-tested deterministically.
 */
export function buildRotationSlides(payload, rowsPerPage = TV_ROWS_PER_PAGE) {
  if (!payload || !payload.views) return [];
  const cfg = payload.config || {};
  const baseSeconds = Math.max(5, Math.min(120, Number(cfg.rotation_seconds) || 15));
  const views = payload.views || {};
  const slides = [];

  const durationForCount = (totalRows, isMultiPage) => {
    if (isMultiPage) return Math.round(baseSeconds * 1.15);
    if (totalRows > 8) return Math.round(baseSeconds * 1.25);
    return baseSeconds;
  };

  // View A — Overall series standings (default opening view)
  if (Array.isArray(views.overall)) {
    views.overall.forEach((ov) => {
      const allRows = ov.standings || [];
      if (!allRows.length) return;
      const pages = chunkRows(allRows, rowsPerPage);
      pages.forEach((pageRows, pageIdx) => {
        slides.push({
          key: `A:${ov.id}:p${pageIdx + 1}`,
          viewType: "A",
          categoryLabel: "Overall Standings",
          title: ov.title || "Overall Series Standings",
          subtitle: ov.subtitle || "",
          scoringLabel: ov.scoring_label || "One-Design",
          data: ov,
          rows: pageRows,
          totalRows: allRows.length,
          leader: allRows[0] || null,
          pageIndex: pageIdx + 1,
          pageCount: pages.length,
          durationMs: durationForCount(allRows.length, pages.length > 1) * 1000,
        });
      });
    });
  }

  // Race-day pairing — each raced class/division gets one slide per race of
  // the day, with its overall standings on the left and that race's results
  // on the right. Views that cannot be paired fall through to B and C below.
  const pairedClassIds = new Set();
  const pairedRaceIds = new Set();
  if (cfg.display_mode === "race_day" && Array.isArray(views.classes) && Array.isArray(views.latest_races)) {
    views.classes.forEach((cv) => {
      const key = raceDayPairKey(cv);
      const races = views.latest_races.filter((lr) => lr.results?.length && raceDayPairKey(lr) === key);
      if (!races.length) return;
      pairedClassIds.add(cv.id);
      races.forEach((lr) => {
        pairedRaceIds.add(lr.id);
        const overallPages = chunkRows(cv.standings || [], rowsPerPage);
        const racePages = chunkRows(lr.results || [], rowsPerPage);
        const pageCount = Math.max(overallPages.length, racePages.length, 1);
        const longest = Math.max((cv.standings || []).length, (lr.results || []).length);
        for (let i = 0; i < pageCount; i += 1) {
          slides.push({
            key: `E:${cv.id}:${lr.id}:p${i + 1}`,
            viewType: "E",
            categoryLabel: "Class Results · Race Day",
            title: cv.heading || cv.class_name || "Class Results",
            subtitle: [cv.series_name, fmtDate(lr.date)].filter(Boolean).join(" · "),
            scoringLabel: cv.scoring_label || "One-Design",
            isProvisional: Boolean(lr.is_provisional),
            data: cv,
            race: lr,
            overallRows: overallPages[i] || [],
            raceRows: racePages[i] || [],
            leader: null,
            pageIndex: i + 1,
            pageCount,
            durationMs: durationForCount(longest, pageCount > 1) * 1000,
          });
        }
      });
    });
  }

  // View B — Individual class standings (cycles through every configured class/division fairly)
  if (Array.isArray(views.classes)) {
    views.classes.forEach((cv) => {
      if (pairedClassIds.has(cv.id)) return;
      const allRows = cv.standings || [];
      if (!allRows.length) return;
      // Avoid exact duplicate if there is only 1 class view and it was already pushed identically as the sole View A fallback
      if (
        slides.length === 1 &&
        slides[0].viewType === "A" &&
        String(ovIdOf(slides[0].data)) === String(cv.id) &&
        !views.latest_races?.length &&
        !views.series_progress?.length
      ) {
        return;
      }
      const pages = chunkRows(allRows, rowsPerPage);
      pages.forEach((pageRows, pageIdx) => {
        slides.push({
          key: `B:${cv.id}:p${pageIdx + 1}`,
          viewType: "B",
          categoryLabel: "Class Standings",
          title: cv.heading || cv.class_name || "Class Standings",
          subtitle: `${cv.series_name || "Series"} · ${cv.year || ""}`.replace(/ · $/, ""),
          scoringLabel: cv.scoring_label || "One-Design",
          data: cv,
          rows: pageRows,
          totalRows: allRows.length,
          leader: allRows[0] || null,
          pageIndex: pageIdx + 1,
          pageCount: pages.length,
          durationMs: durationForCount(allRows.length, pages.length > 1) * 1000,
        });
      });
    });
  }

  // View C — Latest race results
  if (Array.isArray(views.latest_races)) {
    views.latest_races.forEach((lr) => {
      if (pairedRaceIds.has(lr.id)) return;
      const allRows = lr.results || [];
      if (!allRows.length) return;
      const pages = chunkRows(allRows, rowsPerPage);
      pages.forEach((pageRows, pageIdx) => {
        const classLabel = lr.division_name
          ? `${lr.class_name} (${lr.division_name})`
          : lr.class_name;
        slides.push({
          key: `C:${lr.id}:p${pageIdx + 1}`,
          viewType: "C",
          categoryLabel: lr.is_provisional ? "Latest Race · Provisional" : "Latest Race Results",
          title: `${classLabel} — ${lr.race_label || `Race ${lr.race_number}`}`,
          subtitle: [lr.series_name, fmtDate(lr.date)].filter(Boolean).join(" · "),
          scoringLabel: lr.scoring_label || "One-Design",
          isProvisional: Boolean(lr.is_provisional),
          data: lr,
          rows: pageRows,
          totalRows: allRows.length,
          leader: allRows[0] || null,
          pageIndex: pageIdx + 1,
          pageCount: pages.length,
          durationMs: durationForCount(allRows.length, pages.length > 1) * 1000,
        });
      });
    });
  }

  // View D — Series progress
  if (Array.isArray(views.series_progress)) {
    views.series_progress.forEach((sp) => {
      const allRows = sp.standings || [];
      if (!allRows.length && !sp.completed_races && !sp.upcoming_races?.length) return;
      slides.push({
        key: `D:${sp.id}`,
        viewType: "D",
        categoryLabel: "Series Progress",
        title: `${sp.class_name} · ${sp.series_name}`,
        subtitle: `${sp.completed_races} of ${sp.planned_races || sp.completed_races} races completed`,
        scoringLabel: sp.scoring_label || "One-Design",
        data: sp,
        rows: allRows.slice(0, rowsPerPage),
        totalRows: allRows.length,
        leader: allRows[0] || null,
        pageIndex: 1,
        pageCount: 1,
        durationMs: baseSeconds * 1000,
      });
    });
  }

  return slides;
}

function raceDayPairKey(item) {
  return `${item.class_id || item.class_name || ""}|${item.division_name || ""}`;
}

function ovIdOf(data) {
  if (!data) return "";
  return String(data.id || "").replace(/^overall-fallback-/, "");
}

/**
 * Determine whether the persistent race-day information panel has any
 * populated content to display.
 */
export function hasRaceDayContent(raceDay, config) {
  if (!raceDay) return false;
  return Boolean(
    raceDay.title ||
    raceDay.race_officer ||
    raceDay.status ||
    raceDay.courses ||
    (raceDay.live_courses && raceDay.live_courses.length > 0) ||
    raceDay.course_diagram ||
    raceDay.start_sequence ||
    (raceDay.schedule && raceDay.schedule.length > 0) ||
    raceDay.notes ||
    (raceDay.live_notes && raceDay.live_notes.length > 0) ||
    raceDay.life_jackets ||
    raceDay.announcements ||
    (raceDay.onb_notices && raceDay.onb_notices.length > 0) ||
    (raceDay.calendar && raceDay.calendar.length > 0)
  );
}

function fmtPoints(val) {
  if (val == null || val === "") return "—";
  const num = Number(val);
  if (Number.isNaN(num)) return String(val);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function PodiumRankBadge({ rank }) {
  if (rank == null) return <span className="font-mono text-xl text-slate-400">—</span>;
  const style = PODIUM_BADGE[rank];
  if (style) {
    return (
      <span
        data-testid={`tv-podium-badge-${rank}`}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-lg font-heading text-xl font-bold ${style}`}
      >
        {rank}
      </span>
    );
  }
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center font-mono text-xl font-bold text-slate-200">
      {rank}
    </span>
  );
}

function LeaderSpotlight({ leader, viewType, scoringLabel, raceCount }) {
  if (!leader) return null;
  const isRace = viewType === "C";
  return (
    <div
      data-testid="tv-leader-banner"
      className="mb-3 flex items-center justify-between gap-4 rounded-xl border border-amber-400/35 bg-gradient-to-r from-amber-500/20 via-amber-400/10 to-slate-900/60 px-5 py-3 shadow-md"
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-slate-950 shadow-md">
          <Trophy className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-amber-300">
              {isRace ? "Race Winner" : "Current Series Leader"}
            </span>
            {scoringLabel && (
              <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-200">
                {scoringLabel}
              </span>
            )}
          </div>
          <div className="truncate font-heading text-2xl uppercase tracking-tight text-white">
            {leader.boat_name}
            {leader.sail_no && (
              <span className="ml-3 font-mono text-lg font-normal text-amber-200">
                {leader.sail_no}
              </span>
            )}
            {leader.helm && (
              <span className="ml-3 font-body text-base font-medium normal-case text-slate-300">
                · {leader.helm}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        {isRace ? (
          <div>
            <div className="font-mono text-2xl font-bold text-amber-300">
              {leader.corrected_formatted || leader.elapsed_formatted || (leader.points != null ? `${fmtPoints(leader.points)} pts` : "1st")}
            </div>
            <div className="text-xs uppercase tracking-wider text-slate-300">
              {leader.corrected_formatted ? "Corrected Time" : leader.elapsed_formatted ? "Elapsed Time" : "1st Place"}
            </div>
          </div>
        ) : (
          <div>
            <div className="font-mono text-2xl font-bold text-amber-300">
              {fmtPoints(leader.net)} <span className="text-sm font-normal text-amber-200/80">pts</span>
            </div>
            <div className="text-xs uppercase tracking-wider text-slate-300">
              Net Score{raceCount ? ` · ${raceCount} race${raceCount === 1 ? "" : "s"}` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StandingsSlideView({ slide }) {
  const { data, rows, leader, pageIndex, viewType } = slide;
  const showClassCol = viewType === "A";
  const raceMeta = (data.races || []).slice(-6); // Show up to 6 recent race columns so typography stays large

  return (
    <div className="flex h-full flex-col" data-testid={`tv-slide-${viewType}`}>
      {pageIndex === 1 && leader && (
        <LeaderSpotlight
          leader={leader}
          viewType={viewType}
          scoringLabel={slide.scoringLabel}
          raceCount={data.race_count}
        />
      )}
      <div className="flex-1 overflow-hidden rounded-xl border border-white/15 bg-slate-900/75 shadow-xl">
        <table className="w-full border-collapse text-left" data-testid="tv-standings-table">
          <thead>
            <tr className="border-b border-white/15 bg-slate-950/90 text-xs font-bold uppercase tracking-widest text-slate-300">
              <th className="w-16 px-4 py-3 text-center">Pos</th>
              <th className="px-4 py-3">Boat</th>
              <th className="px-4 py-3">Sail No</th>
              {showClassCol && <th className="px-4 py-3">Class</th>}
              <th className="px-4 py-3">Helm / Skipper</th>
              {raceMeta.map((rm, idx) => (
                <th key={idx} className="hidden xl:table-cell px-2.5 py-3 text-center font-mono">
                  {rm.mini_name || `R${rm.race_number}`}
                </th>
              ))}
              <th className="px-4 py-3 text-center">Races</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-5 py-3 text-right text-amber-300">Net Pts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row) => {
              const rank = row.rank;
              const podiumRow = PODIUM_ROW_BG[rank] || "hover:bg-white/[0.02]";
              const allScores = row.scores || [];
              const recentScores = raceMeta.length
                ? allScores.slice(-raceMeta.length)
                : [];
              return (
                <tr
                  key={row.boat_id || `${row.sail_no}-${rank}`}
                  data-testid={`tv-row-${row.sail_no || row.boat_name}`}
                  className={`transition-colors ${podiumRow}`}
                >
                  <td className="px-4 py-2.5 text-center">
                    <PodiumRankBadge rank={rank} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-heading text-2xl uppercase tracking-tight text-white">
                      {row.boat_name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-lg font-semibold text-sky-200">
                    {row.sail_no || "—"}
                  </td>
                  {showClassCol && (
                    <td className="px-4 py-2.5 text-base font-semibold text-slate-300">
                      {row.class_name || data.class_name || "—"}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-lg font-medium text-slate-200">
                    {row.helm || "—"}
                  </td>
                  {raceMeta.map((_, idx) => {
                    const s = recentScores[idx];
                    if (!s) {
                      return (
                        <td key={idx} className="hidden xl:table-cell px-2.5 py-2.5 text-center font-mono text-base text-slate-500">
                          —
                        </td>
                      );
                    }
                    const pts = fmtPoints(s.points);
                    const code = s.code && s.code !== "FINISHED" && s.code !== "MINI" ? ` ${s.code}` : "";
                    const cellText = s.discarded ? `(${pts}${code})` : `${pts}${code}`;
                    return (
                      <td
                        key={idx}
                        className={`hidden xl:table-cell px-2.5 py-2.5 text-center font-mono text-base ${
                          s.discarded
                            ? "text-slate-500 line-through"
                            : s.points === 1
                            ? "font-bold text-amber-300"
                            : "text-slate-200"
                        }`}
                      >
                        {cellText}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-center font-mono text-lg text-slate-300">
                    {row.races_completed != null ? row.races_completed : data.race_count ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-lg text-slate-300">
                    {fmtPoints(row.total)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-2xl font-bold text-amber-300">
                    {fmtPoints(row.net)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SlidePanel({ testId, label, badge, children }) {
  return (
    <div data-testid={testId} className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-heading text-xl uppercase tracking-wide text-white">{label}</span>
        {badge}
      </div>
      <div className="flex-1 overflow-hidden rounded-xl border border-white/15 bg-slate-900/75 shadow-xl">
        {children}
      </div>
    </div>
  );
}

/**
 * Race-day slide: a class's overall standings (left) beside that day's
 * results for the same class/division (right), on one page.
 */
function SideBySideSlideView({ slide }) {
  const { data, race, overallRows, raceRows, pageIndex, isProvisional } = slide;
  const hasElapsed = raceRows.some((r) => r.elapsed_formatted);
  const raceLabel = race.race_label || `Race ${race.race_number}`;

  return (
    <div className="flex h-full flex-col" data-testid="tv-slide-E">
      <div className="grid h-full min-h-0 grid-cols-2 gap-5">
        <SlidePanel
          testId="tv-overall-panel"
          label="Overall Standings"
          badge={
            data.race_count != null ? (
              <span className="font-mono text-sm text-slate-300">{data.race_count} races</span>
            ) : null
          }
        >
          {overallRows.length === 0 ? (
            pageIndex === 1 && (
              <p className="p-6 text-center text-lg text-slate-400">No standings yet</p>
            )
          ) : (
            <table className="w-full border-collapse text-left" data-testid="tv-overall-table">
              <thead>
                <tr className="border-b border-white/15 bg-slate-950/90 text-xs font-bold uppercase tracking-widest text-slate-300">
                  <th className="w-14 px-3 py-2.5 text-center">Pos</th>
                  <th className="px-3 py-2.5">Boat</th>
                  <th className="px-3 py-2.5">Sail</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5 text-right text-amber-300">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {overallRows.map((row) => (
                  <tr
                    key={row.boat_id || `${row.sail_no}-${row.rank}`}
                    data-testid={`tv-overall-row-${row.sail_no || row.boat_name}`}
                    className={PODIUM_ROW_BG[row.rank] || ""}
                  >
                    <td className="px-3 py-2 text-center">
                      <PodiumRankBadge rank={row.rank} />
                    </td>
                    <td className="px-3 py-2 font-heading text-xl uppercase tracking-tight text-white">
                      {row.boat_name}
                    </td>
                    <td className="px-3 py-2 font-mono text-base font-semibold text-sky-200">
                      {row.sail_no || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-base text-slate-300">
                      {fmtPoints(row.total)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-lg font-bold text-amber-300">
                      {fmtPoints(row.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SlidePanel>

        <SlidePanel
          testId="tv-race-panel"
          label={raceLabel}
          badge={
            isProvisional ? (
              <span className="rounded-full bg-amber-400 px-3 py-0.5 font-heading text-xs font-bold uppercase tracking-wider text-slate-950">
                Provisional
              </span>
            ) : null
          }
        >
          {raceRows.length === 0 ? (
            pageIndex === 1 && (
              <p className="p-6 text-center text-lg text-slate-400">No race results yet</p>
            )
          ) : (
            <table className="w-full border-collapse text-left" data-testid="tv-race-table">
              <thead>
                <tr className="border-b border-white/15 bg-slate-950/90 text-xs font-bold uppercase tracking-widest text-slate-300">
                  <th className="w-14 px-3 py-2.5 text-center">Pos</th>
                  <th className="px-3 py-2.5">Boat</th>
                  <th className="px-3 py-2.5">Sail</th>
                  {hasElapsed && <th className="px-3 py-2.5 text-right">Elapsed</th>}
                  <th className="px-4 py-2.5 text-right">Status / Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {raceRows.map((row, idx) => {
                  const pos = row.code === "FINISHED" ? row.position : null;
                  return (
                    <tr
                      key={row.boat_id || idx}
                      data-testid={`tv-race-row-${row.sail_no || row.boat_name}`}
                      className={pos ? PODIUM_ROW_BG[pos] || "" : ""}
                    >
                      <td className="px-3 py-2 text-center">
                        {pos ? (
                          <PodiumRankBadge rank={pos} />
                        ) : (
                          <span className="inline-block rounded border border-red-400/40 bg-red-500/20 px-2 py-0.5 font-mono text-sm font-bold text-red-200">
                            {row.code}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-heading text-xl uppercase tracking-tight text-white">
                        {row.boat_name}
                      </td>
                      <td className="px-3 py-2 font-mono text-base font-semibold text-sky-200">
                        {row.sail_no || "—"}
                      </td>
                      {hasElapsed && (
                        <td className="px-3 py-2 text-right font-mono text-base text-slate-200">
                          {row.elapsed_formatted || "—"}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right font-mono text-lg font-bold text-amber-300">
                        {row.points != null
                          ? `${fmtPoints(row.points)} pts`
                          : row.code === "FINISHED"
                          ? `Pos ${row.position}`
                          : row.code}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </SlidePanel>
      </div>
    </div>
  );
}

function LatestRaceSlideView({ slide }) {
  const { data, rows, leader, pageIndex, isProvisional } = slide;
  const hasCorrected = rows.some((r) => r.corrected_formatted);
  const hasElapsed = rows.some((r) => r.elapsed_formatted);

  return (
    <div className="flex h-full flex-col" data-testid="tv-slide-C">
      {isProvisional && (
        <div
          data-testid="tv-provisional-banner"
          className="mb-3 flex items-center justify-between rounded-xl border border-amber-400/50 bg-amber-500/20 px-4 py-2 text-amber-100"
        >
          <div className="flex items-center gap-2.5 font-heading text-lg uppercase tracking-wide">
            <AlertTriangle className="h-5 w-5 text-amber-300 animate-pulse" />
            Provisional Race Results — Subject to Protest &amp; Verification
          </div>
          <span className="rounded-full bg-amber-400 px-3 py-0.5 font-heading text-xs font-bold uppercase tracking-wider text-slate-950">
            Provisional
          </span>
        </div>
      )}
      {!isProvisional && pageIndex === 1 && leader && (
        <LeaderSpotlight leader={leader} viewType="C" scoringLabel={slide.scoringLabel} />
      )}
      <div className="flex-1 overflow-hidden rounded-xl border border-white/15 bg-slate-900/75 shadow-xl">
        <table className="w-full border-collapse text-left" data-testid="tv-latest-race-table">
          <thead>
            <tr className="border-b border-white/15 bg-slate-950/90 text-xs font-bold uppercase tracking-widest text-slate-300">
              <th className="w-16 px-4 py-3 text-center">Pos</th>
              <th className="px-4 py-3">Boat</th>
              <th className="px-4 py-3">Sail No</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Helm / Skipper</th>
              {hasElapsed && <th className="px-4 py-3 text-right">Elapsed</th>}
              {hasCorrected && <th className="px-4 py-3 text-right">Corrected</th>}
              <th className="px-5 py-3 text-right">Status / Pts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row, idx) => {
              const pos = row.code === "FINISHED" ? row.position : null;
              const podiumRow = pos ? PODIUM_ROW_BG[pos] || "" : "";
              return (
                <tr
                  key={row.boat_id || idx}
                  data-testid={`tv-race-row-${row.sail_no || row.boat_name}`}
                  className={podiumRow}
                >
                  <td className="px-4 py-2.5 text-center">
                    {pos ? (
                      <PodiumRankBadge rank={pos} />
                    ) : (
                      <span className="inline-block rounded border border-red-400/40 bg-red-500/20 px-2 py-0.5 font-mono text-sm font-bold text-red-200">
                        {row.code}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-heading text-2xl uppercase tracking-tight text-white">
                    {row.boat_name}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-lg font-semibold text-sky-200">
                    {row.sail_no || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-base font-semibold text-slate-300">
                    {row.class_name || data.class_name || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-lg font-medium text-slate-200">
                    {row.helm || "—"}
                  </td>
                  {hasElapsed && (
                    <td className="px-4 py-2.5 text-right font-mono text-lg text-slate-200">
                      {row.elapsed_formatted || "—"}
                    </td>
                  )}
                  {hasCorrected && (
                    <td className="px-4 py-2.5 text-right font-mono text-lg font-bold text-sky-300">
                      {row.corrected_formatted || "—"}
                    </td>
                  )}
                  <td className="px-5 py-2.5 text-right font-mono text-xl font-bold text-amber-300">
                    {row.points != null
                      ? `${fmtPoints(row.points)} pts`
                      : row.code === "FINISHED"
                      ? `Pos ${row.position}`
                      : row.code}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SeriesProgressSlideView({ slide }) {
  const { data, rows } = slide;
  const pct =
    data.planned_races > 0
      ? Math.min(100, Math.round((data.completed_races / data.planned_races) * 100))
      : 100;

  return (
    <div className="flex h-full flex-col gap-4" data-testid="tv-slide-D">
      {/* Progress KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-white/15 bg-slate-900/80 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Races Completed
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold text-white" data-testid="tv-progress-completed">
              {data.completed_races}
            </span>
            {data.planned_races > 0 && (
              <span className="font-mono text-lg text-slate-400">/ {data.planned_races}</span>
            )}
          </div>
          {data.planned_races > 0 && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-sky-400 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/15 bg-slate-900/80 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Remaining Races
          </div>
          <div className="mt-1 font-mono text-3xl font-bold text-sky-300">
            {data.remaining_races}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {data.abandoned_races > 0 ? `${data.abandoned_races} abandoned` : "Scheduled in series"}
          </div>
        </div>

        <div className="rounded-xl border border-white/15 bg-slate-900/80 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Active Discards
          </div>
          <div className="mt-1 font-mono text-3xl font-bold text-amber-300">
            {data.discards}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {data.discard_policy === "increasing" ? "Progressive discard rule" : "Fixed series discards"}
          </div>
        </div>

        <div className="rounded-xl border border-white/15 bg-slate-900/80 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Next Scheduled Race
          </div>
          <div className="mt-1 font-heading text-2xl uppercase text-emerald-300" data-testid="tv-progress-next-date">
            {data.next_race_date ? fmtDateShort(data.next_race_date) : "Series Complete"}
          </div>
          {data.upcoming_races?.length > 1 && (
            <div className="mt-1 text-xs text-slate-400">
              +{data.upcoming_races.length - 1} further date{data.upcoming_races.length - 1 === 1 ? "" : "s"} scheduled
            </div>
          )}
        </div>
      </div>

      {/* Standings + Upcoming Dates side by side */}
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3 overflow-hidden">
        <div className="lg:col-span-2 overflow-hidden rounded-xl border border-white/15 bg-slate-900/75">
          <div className="border-b border-white/10 bg-slate-950/80 px-4 py-2.5 flex items-center justify-between">
            <span className="font-heading text-sm uppercase tracking-wider text-slate-300">
              Current Series Standings
            </span>
            <span className="font-mono text-xs text-slate-400">{slide.scoringLabel}</span>
          </div>
          {rows.length > 0 ? (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
                  <th className="w-14 px-3 py-2 text-center">Pos</th>
                  <th className="px-3 py-2">Boat</th>
                  <th className="px-3 py-2">Sail No</th>
                  <th className="px-3 py-2">Helm</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-right text-amber-300">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {rows.slice(0, 8).map((row) => (
                  <tr key={row.boat_id || row.sail_no} className={PODIUM_ROW_BG[row.rank] || ""}>
                    <td className="px-3 py-2 text-center">
                      <PodiumRankBadge rank={row.rank} />
                    </td>
                    <td className="px-3 py-2 font-heading text-xl uppercase text-white">
                      {row.boat_name}
                    </td>
                    <td className="px-3 py-2 font-mono text-base text-sky-200">{row.sail_no}</td>
                    <td className="px-3 py-2 text-base text-slate-300">{row.helm || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-base text-slate-400">
                      {fmtPoints(row.total)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xl font-bold text-amber-300">
                      {fmtPoints(row.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-slate-400">
              No races scored yet in this series.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-white/15 bg-slate-900/75 p-4 overflow-y-auto">
          <div className="font-heading text-sm uppercase tracking-wider text-sky-300 flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Series Schedule
          </div>
          {data.upcoming_races?.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                Upcoming Races
              </div>
              <div className="space-y-1.5">
                {data.upcoming_races.map((u) => (
                  <div
                    key={`${u.race_number}-${u.date}`}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2"
                  >
                    <span className="font-heading text-base uppercase text-white">
                      Race {u.race_number}
                    </span>
                    <span className="font-mono text-sm text-sky-200">{fmtDate(u.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.completed_race_list?.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                Completed Races
              </div>
              <div className="space-y-1">
                {data.completed_race_list.slice(-5).map((c) => (
                  <div
                    key={`${c.race_number}-${c.date}`}
                    className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-1.5 text-sm"
                  >
                    <span className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Race {c.race_number}
                    </span>
                    <span className="font-mono text-xs text-slate-400">{fmtDateShort(c.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PersistentRaceDayPanel({ raceDay }) {
  const statusInfo = STATUS_STYLES[String(raceDay.status || "").toLowerCase()] || null;
  const hasCourses = Boolean(raceDay.courses || raceDay.live_courses?.length || raceDay.course_diagram);
  const hasSchedule = Boolean(raceDay.start_sequence || raceDay.schedule?.length);
  const hasNotes = Boolean(raceDay.notes || raceDay.live_notes?.length || raceDay.life_jackets);
  const hasAnnouncements = Boolean(raceDay.announcements || raceDay.onb_notices?.length);
  const hasCalendar = Boolean(raceDay.calendar?.length);

  return (
    <aside
      data-testid="tv-race-day-panel"
      aria-label="Current race-day information"
      className="flex h-full flex-col gap-3.5 rounded-2xl border border-white/15 bg-slate-900/90 p-5 shadow-2xl overflow-y-auto"
    >
      {/* Panel header */}
      <div className="border-b border-white/15 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-sky-300">
            <Radio className="h-4 w-4 text-safety" /> Race-Day Information
          </span>
          {statusInfo && (
            <span
              data-testid="tv-race-day-status"
              className={`rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${statusInfo.cls}`}
            >
              {statusInfo.label}
            </span>
          )}
        </div>
        {raceDay.title && (
          <h2
            data-testid="tv-race-day-title"
            className="mt-1.5 font-heading text-2xl uppercase leading-tight tracking-tight text-white"
          >
            {raceDay.title}
          </h2>
        )}
        {raceDay.date && (
          <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-300">
            <CalendarDays className="h-4 w-4 text-sky-400" />
            <span>{fmtDate(raceDay.date)}</span>
          </div>
        )}
        {raceDay.race_officer && (
          <div
            data-testid="tv-race-officer"
            className="mt-2 flex items-center gap-2 rounded-lg bg-white/[0.05] px-3 py-1.5 text-sm text-slate-200"
          >
            <UserCheck className="h-4 w-4 shrink-0 text-amber-300" />
            <span>
              <strong className="text-white">Race Officer:</strong> {raceDay.race_officer}
            </span>
          </div>
        )}
      </div>

      {/* Life Jackets Alert */}
      {raceDay.life_jackets && (
        <div
          data-testid="tv-life-jackets-alert"
          className="flex items-center gap-2.5 rounded-xl border border-safety/60 bg-safety/25 px-3.5 py-2.5 text-white shadow-sm"
        >
          <LifeBuoy className="h-5 w-5 shrink-0 text-safety" />
          <span className="font-heading text-base uppercase tracking-wide">
            Personal Buoyancy / Life Jackets Mandatory
          </span>
        </div>
      )}

      {/* Courses & Mark Sequences */}
      {hasCourses && (
        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5" data-testid="tv-courses-section">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-amber-300">
            <Compass className="h-4 w-4" /> Courses &amp; Marks
          </div>
          {raceDay.courses && (
            <p className="whitespace-pre-line text-base font-semibold leading-snug text-white">
              {raceDay.courses}
            </p>
          )}
          {raceDay.course_diagram && (
            <div className="mt-2 rounded-lg border border-sky-400/30 bg-sky-950/40 px-3 py-2 font-mono text-sm font-bold text-sky-200">
              {raceDay.course_diagram}
            </div>
          )}
          {!raceDay.courses && raceDay.live_courses?.length > 0 && (
            <ul className="space-y-1 text-sm font-semibold text-white">
              {raceDay.live_courses.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Start Times & Schedule */}
      {hasSchedule && (
        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5" data-testid="tv-schedule-section">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-sky-300">
            <Clock className="h-4 w-4" /> Start Sequence &amp; Schedule
          </div>
          {raceDay.start_sequence && (
            <p className="mb-2 whitespace-pre-line text-sm font-medium text-slate-200">
              {raceDay.start_sequence}
            </p>
          )}
          {raceDay.schedule?.length > 0 && (
            <div className="space-y-1.5">
              {raceDay.schedule.slice(0, 6).map((item, idx) => {
                const st = STATUS_STYLES[item.status] || STATUS_STYLES.scheduled;
                return (
                  <div
                    key={item.race_id || `${item.series_id}-${item.race_number}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-heading text-base uppercase text-white">
                        {item.class_name} · {item.race_label}
                      </div>
                      {item.course && (
                        <div className="truncate text-xs text-slate-300">Course: {item.course}</div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {item.start_time && (
                        <div className="font-mono text-base font-bold text-amber-300">
                          {item.start_time}
                        </div>
                      )}
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${st.cls}`}>
                        {st.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Start-Line / Course Notes */}
      {hasNotes && (
        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5" data-testid="tv-notes-section">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-slate-300">
            <Flag className="h-4 w-4 text-safety" /> Start-Line &amp; Course Notes
          </div>
          {raceDay.notes && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">
              {raceDay.notes}
            </p>
          )}
          {!raceDay.notes && raceDay.live_notes?.length > 0 && (
            <ul className="space-y-1 text-sm text-slate-200">
              {raceDay.live_notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Racing Calendar Summary */}
      {hasCalendar && (
        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5" data-testid="tv-calendar-section">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-sky-300">
            <CalendarDays className="h-4 w-4" /> Racing Calendar
          </div>
          <div className="space-y-1.5">
            {raceDay.calendar.map((day) => (
              <div
                key={day.date}
                data-testid="tv-calendar-day"
                className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <span className="shrink-0 font-mono text-sm font-bold text-sky-200">{fmtDate(day.date)}</span>
                <span className="min-w-0 text-right text-xs text-slate-200">
                  {day.races.map((r) => `${r.class_name} R${r.race_number}`).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Announcements & ONB Notices */}
      {hasAnnouncements && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3.5" data-testid="tv-announcements-section">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-amber-300">
            <Megaphone className="h-4 w-4" /> Club Announcements
          </div>
          {raceDay.announcements && (
            <p className="whitespace-pre-line text-sm font-medium leading-relaxed text-amber-100">
              {raceDay.announcements}
            </p>
          )}
          {raceDay.onb_notices?.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-amber-400/20 pt-2">
              {raceDay.onb_notices.map((n) => (
                <div key={n.id} className="text-xs text-slate-200">
                  <span className="font-bold text-white">{n.title}:</span> {n.summary}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

export default function ClubTvDisplay() {
  const { slug, clubId } = useParams();
  const identifier = slug || clubId;
  const [searchParams] = useSearchParams();
  const seriesOverride = searchParams.get("series_id") || searchParams.get("series") || undefined;
  const regattaOverride = searchParams.get("regatta_id") || searchParams.get("regatta") || undefined;
  const yearOverride = searchParams.get("year") ? Number(searchParams.get("year")) : undefined;
  const previewParam = searchParams.get("preview") || undefined;

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [disabledMessage, setDisabledMessage] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [clockNow, setClockNow] = useState(() => new Date());

  // Rotation state: kept by stable slide key so background data refreshes
  // never reset the active rotation position unnecessarily.
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const activeSlideKeyRef = useRef(null);
  const [progressPct, setProgressPct] = useState(0);

  const fetchDisplayData = useCallback(async (isInitial = false) => {
    if (!identifier) return;
    try {
      const params = {};
      if (seriesOverride) params.series_id = seriesOverride;
      if (regattaOverride) params.regatta_id = regattaOverride;
      if (yearOverride) params.year = yearOverride;
      if (previewParam) params.preview = previewParam;

      const data = await api.getClubTvDisplay(identifier, params);
      setPayload(data);
      setError(null);
      setDisabledMessage(null);
      setLastUpdatedAt(new Date());
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 403) {
        setDisabledMessage(detail || "Public TV display is not enabled for this club.");
      } else {
        setError(detail || "Temporary connection issue — retaining last retrieved results.");
      }
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [identifier, seriesOverride, regattaOverride, yearOverride, previewParam]);

  // Initial fetch + periodic polling without page reload
  useEffect(() => {
    setLoading(true);
    fetchDisplayData(true);
    const interval = setInterval(() => {
      fetchDisplayData(false);
    }, TV_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchDisplayData]);

  // Live wall clock in the header (updates every 15 seconds)
  useEffect(() => {
    const t = setInterval(() => setClockNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  const slides = useMemo(() => buildRotationSlides(payload), [payload]);

  // Preserve current slide across background polls if its key still exists
  useEffect(() => {
    if (!slides.length) {
      setActiveSlideIndex(0);
      activeSlideKeyRef.current = null;
      return;
    }
    if (activeSlideKeyRef.current) {
      const foundIdx = slides.findIndex((s) => s.key === activeSlideKeyRef.current);
      if (foundIdx !== -1 && foundIdx !== activeSlideIndex) {
        setActiveSlideIndex(foundIdx);
        return;
      }
    }
    if (activeSlideIndex >= slides.length) {
      setActiveSlideIndex(0);
      activeSlideKeyRef.current = slides[0]?.key || null;
    } else {
      activeSlideKeyRef.current = slides[activeSlideIndex]?.key || null;
    }
  }, [slides, activeSlideIndex]);

  const currentSlide = slides[activeSlideIndex] || slides[0] || null;
  const currentDurationMs = currentSlide?.durationMs || 15000;

  // Automatic rotation timer + smooth subtle progress indicator
  useEffect(() => {
    if (slides.length <= 1) {
      setProgressPct(100);
      return undefined;
    }
    const startMs = Date.now();
    setProgressPct(0);

    const progressTimer = setInterval(() => {
      const elapsed = Date.now() - startMs;
      setProgressPct(Math.min(100, (elapsed / currentDurationMs) * 100));
    }, 200);

    const advanceTimer = setTimeout(() => {
      setActiveSlideIndex((prev) => {
        const next = (prev + 1) % slides.length;
        activeSlideKeyRef.current = slides[next]?.key || null;
        return next;
      });
    }, currentDurationMs);

    return () => {
      clearInterval(progressTimer);
      clearTimeout(advanceTimer);
    };
  }, [activeSlideIndex, slides.length, currentDurationMs, slides]);

  // Loading state (before any payload has arrived)
  if (loading && !payload) {
    return (
      <div
        data-testid="tv-display-loading"
        className="flex min-h-screen w-screen flex-col items-center justify-center bg-[#071126] text-white"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ocean/30 ring-2 ring-sky-400/40 animate-pulse">
          <Sailboat className="h-9 w-9 text-sky-300" />
        </div>
        <h1 className="mt-4 font-heading text-3xl uppercase tracking-tight">
          Loading Clubhouse Display…
        </h1>
        <p className="mt-1 text-sm text-slate-400">Connecting to live SailScore race results</p>
      </div>
    );
  }

  // Disabled state (403)
  if (disabledMessage && !payload) {
    return (
      <div
        data-testid="tv-display-disabled"
        className="flex min-h-screen w-screen flex-col items-center justify-center bg-[#071126] px-6 text-center text-white"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-300">
          <Tv className="h-8 w-8" />
        </div>
        <h1 className="mt-4 font-heading text-3xl uppercase tracking-tight">
          Clubhouse TV Display Offline
        </h1>
        <p className="mt-2 max-w-md text-base text-slate-300">{disabledMessage}</p>
      </div>
    );
  }

  // Hard error state when no cached payload is available
  if (error && !payload) {
    return (
      <div
        data-testid="tv-display-error"
        className="flex min-h-screen w-screen flex-col items-center justify-center bg-[#071126] px-6 text-center text-white"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/20 text-red-300">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h1 className="mt-4 font-heading text-3xl uppercase tracking-tight">
          Display Temporarily Unavailable
        </h1>
        <p className="mt-2 max-w-md text-base text-slate-300">{error}</p>
        <p className="mt-4 text-xs uppercase tracking-widest text-slate-400">
          Retrying automatically…
        </p>
      </div>
    );
  }

  const club = payload?.club || {};
  const activeEvent = payload?.active_event || {};
  const raceDay = payload?.race_day || {};
  const showSidePanel = hasRaceDayContent(raceDay, payload?.config);

  const formattedToday = clockNow.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const formattedUpdatedTime = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "—";

  return (
    <div
      data-testid="tv-display-root"
      className="flex h-screen w-screen flex-col overflow-hidden bg-gradient-to-br from-[#061024] via-[#0A1936] to-[#071226] text-white select-none"
    >
      {/* Persistent Top Header */}
      <header
        data-testid="tv-display-header"
        className="flex h-20 shrink-0 items-center justify-between border-b border-white/15 bg-slate-950/80 px-6 backdrop-blur-md"
      >
        <div className="flex items-center gap-4 min-w-0">
          {club.icon ? (
            <img
              data-testid="tv-club-logo"
              src={club.icon}
              alt={club.name || "Club"}
              className="h-12 w-auto max-w-[10rem] shrink-0 rounded-lg bg-white object-contain p-1 shadow-lg"
            />
          ) : (
            <ClubBadge
              club={club}
              size="h-12 w-12 rounded-xl"
              textSize="text-xl"
              className="ring-2 ring-white/20 shadow-lg shrink-0"
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1
                data-testid="tv-club-name"
                className="truncate font-heading text-3xl uppercase leading-none tracking-tight text-white"
              >
                {club.name || "Sailing Club"}
              </h1>
              <span
                data-testid="tv-event-badge"
                className="rounded-lg border border-sky-400/40 bg-sky-500/20 px-3 py-1 font-heading text-base uppercase tracking-wider text-sky-200"
              >
                {activeEvent.title || "Current Season"}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
              <span data-testid="tv-current-date">{formattedToday}</span>
              <span>·</span>
              <span>Official Clubhouse Results Display</span>
            </div>
          </div>
        </div>

        {/* Current View Indicator & Slide Pills */}
        <div className="flex items-center gap-5">
          {error && (
            <div
              data-testid="tv-connection-warning"
              className="flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200"
            >
              <WifiOff className="h-4 w-4 text-amber-300" />
              <span>Offline — showing last retrieved results ({formattedUpdatedTime})</span>
            </div>
          )}

          {slides.length > 1 && (
            <div className="hidden md:flex items-center gap-1.5" data-testid="tv-rotation-indicators">
              {slides.map((s, idx) => (
                <span
                  key={s.key}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    idx === activeSlideIndex ? "w-7 bg-amber-400" : "w-2 bg-white/25"
                  }`}
                />
              ))}
            </div>
          )}

          <div className="text-right">
            <div className="font-mono text-2xl font-bold leading-none text-white">
              {clockNow.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Clubhouse Time
            </div>
          </div>
        </div>
      </header>

      {/* Subtle Rotation Progress Bar */}
      <div className="h-1 w-full bg-slate-900 shrink-0" data-testid="tv-progress-bar">
        <div
          className="h-full bg-gradient-to-r from-sky-400 to-amber-400 transition-all duration-200 ease-linear"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Main Content Area: 70-80% Rotating Results + 20-30% Persistent Race-Day Info */}
      <main className="flex-1 min-h-0 px-6 py-4">
        <div
          className={`grid h-full gap-5 ${
            showSidePanel ? "grid-cols-1 lg:grid-cols-12" : "grid-cols-1"
          }`}
        >
          {/* Primary Area: Rotating Results */}
          <section
            data-testid="tv-primary-results-area"
            className={`flex h-full min-h-0 flex-col ${
              showSidePanel ? "lg:col-span-9" : "col-span-1"
            }`}
          >
            {currentSlide ? (
              <div key={currentSlide.key} className="flex h-full flex-col animate-in fade-in duration-300">
                {/* Slide Header Bar */}
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        data-testid="tv-slide-category"
                        className="rounded-md bg-ocean px-2.5 py-0.5 font-heading text-xs uppercase tracking-widest text-white"
                      >
                        {currentSlide.categoryLabel}
                      </span>
                      {currentSlide.scoringLabel && (
                        <span
                          data-testid="tv-slide-scoring"
                          className="rounded-md border border-white/20 bg-white/10 px-2.5 py-0.5 font-mono text-xs font-bold text-sky-200"
                        >
                          {currentSlide.scoringLabel}
                        </span>
                      )}
                      {currentSlide.pageCount > 1 && (
                        <span
                          data-testid="tv-slide-page"
                          className="rounded-md bg-white/10 px-2.5 py-0.5 font-mono text-xs text-slate-300"
                        >
                          Page {currentSlide.pageIndex} of {currentSlide.pageCount}
                        </span>
                      )}
                    </div>
                    <h2
                      data-testid="tv-slide-title"
                      className="mt-1 font-heading text-4xl uppercase leading-none tracking-tight text-white"
                    >
                      {currentSlide.title}
                    </h2>
                  </div>
                  {currentSlide.subtitle && (
                    <div
                      data-testid="tv-slide-subtitle"
                      className="font-heading text-xl uppercase tracking-wide text-slate-300"
                    >
                      {currentSlide.subtitle}
                    </div>
                  )}
                </div>

                {/* Slide Body */}
                <div className="flex-1 min-h-0">
                  {(currentSlide.viewType === "A" || currentSlide.viewType === "B") && (
                    <StandingsSlideView slide={currentSlide} />
                  )}
                  {currentSlide.viewType === "C" && (
                    <LatestRaceSlideView slide={currentSlide} />
                  )}
                  {currentSlide.viewType === "E" && (
                    <SideBySideSlideView slide={currentSlide} />
                  )}
                  {currentSlide.viewType === "D" && (
                    <SeriesProgressSlideView slide={currentSlide} />
                  )}
                </div>
              </div>
            ) : (
              /* Empty State when no results are published yet */
              <div
                data-testid="tv-empty-results"
                className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-slate-900/50 p-12 text-center"
              >
                <Anchor className="h-14 w-14 text-sky-400/70" />
                <h2 className="mt-4 font-heading text-3xl uppercase tracking-tight text-white">
                  Awaiting Race Results
                </h2>
                <p className="mt-2 max-w-lg text-lg text-slate-300">
                  No race results have been published for{" "}
                  <span className="font-semibold text-white">
                    {activeEvent.title || club.name || "this series"}
                  </span>{" "}
                  yet. Standings will appear here automatically as soon as races are scored.
                </p>
              </div>
            )}
          </section>

          {/* Persistent Race-Day Information Area (25% width on landscape 16:9) */}
          {showSidePanel && (
            <div className="lg:col-span-3 h-full min-h-0">
              <PersistentRaceDayPanel raceDay={raceDay} />
            </div>
          )}
        </div>
      </main>

      {/* Persistent Footer */}
      <footer
        data-testid="tv-display-footer"
        className="flex h-10 shrink-0 items-center justify-between border-t border-white/10 bg-slate-950/90 px-6 text-xs text-slate-400"
      >
        <div className="flex items-center gap-4">
          <span data-testid="tv-last-updated">
            Last updated: <strong className="font-mono text-slate-200">{formattedUpdatedTime}</strong>
          </span>
          {slides.length > 0 && (
            <span>
              Showing view {activeSlideIndex + 1} of {slides.length} · Auto-rotating every{" "}
              {Math.round(currentDurationMs / 1000)}s
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-heading uppercase tracking-widest text-slate-400">
          <Award className="h-3.5 w-3.5 text-sky-400" />
          <span>Powered by SailScore</span>
        </div>
      </footer>
    </div>
  );
}
