import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ElapsedInput } from "@/components/ElapsedInput";
import { boatDivision, boatRating, clockToIso, clockValueOf, outcomeLabel, scoringModeLabel } from "@/lib/helpers";

/**
 * Desk entry for handicap results: one row per racing boat, keyed in rather
 * than tapped live. `mode` is what the officer types - "clock" (the finishing
 * time of day) or "elapsed" (the duration since the start). Both commit
 * through the same finish endpoints the tap grid uses, so the scoring engine,
 * corrected times and sequencing are unchanged. `codes` is the Appendix A
 * catalogue from /rrs-codes ({code, label} entries), the same list every other
 * code menu in the console offers.
 */
export function RaceTimeEntry({ mode, rows, boats, race, codes, hasStart, onClock, onElapsed, onCode,
                               pendingCode = null, positionModes = [], scoringPositions = {},
                               divisions = [], ratingModes = [] }) {
  const clock = mode === "clock";
  // One place column per scoring system when the series is dual-scored
  // (e.g. IRC Pos / YTC Pos); otherwise the single stored place. The fixed
  // widths keep this table in line with the provisional table below it.
  const posCols = positionModes.length ? positionModes : [null];
  const minWidth = 592 + 80 * (posCols.length - 1);
  // A handicap table only holds boats holding its certificate: she keeps her
  // finish time, which still scores her in the other system's table.
  const missingCertificates = (boat) => ratingModes.filter((m) => !boatRating(m, boat));
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed" style={{ minWidth }} data-testid={`time-entry-${mode}`}>
          <colgroup>
            <col className="w-40" />
            {posCols.map((col) => <col key={col || "pos"} className="w-20" />)}
            <col className="w-44" />
            <col className="w-44" />
          </colgroup>
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-2">Boat</th>
              {posCols.map((col) => (
                <th key={col || "pos"} className="text-center" data-testid={col ? `time-pos-head-${col}` : "time-pos-head"}>
                  {col ? `${scoringModeLabel(col)} Pos` : "Pos"}
                </th>
              ))}
              <th>{clock ? "Finish time" : "Elapsed"}</th>
              <th>Code / Penalty (RRS)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const b = boats[r.boat_id] || {};
              // Held DPI/RDG: the stored code is unchanged until the panel is
              // saved, but the menu must show the pick — snapping back to the
              // old code is what made RDG look broken here.
              const held = pendingCode?.boatId === r.boat_id ? pendingCode.code : null;
              const shown = held || r.code;
              const division = divisions.length ? boatDivision(b, divisions) : "";
              const missing = divisions.length ? (division ? [] : ratingModes) : missingCertificates(b);
              const unrated = missing.length > 0;
              return (
                <tr key={r.boat_id} className="border-b last:border-0">
                  <td className="py-1.5 font-semibold">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span>
                    {division && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-safety" data-testid={`time-division-${b.sail_no}`}>{division}</span>}
                    {unrated && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground" data-testid={`time-unrated-${b.sail_no}`}>
                        {divisions.length ? "No rating" : missing.map((m) => `No ${scoringModeLabel(m)} rating`).join(" · ")}
                      </span>
                    )}
                  </td>
                  {posCols.map((col, i) => {
                    const pos = col
                      ? (scoringPositions?.[col]?.[r.boat_id] ?? null)
                      : (shown === "FINISHED" && !unrated ? r.position : null);
                    return (
                      <td key={col || "pos"} className="text-center font-mono"
                        data-testid={col ? `time-pos-${col}-${b.sail_no}` : `time-pos-${b.sail_no}`}>
                        {pos != null ? pos
                          : held && i === 0 ? <span className="font-sans text-[10px] font-bold uppercase tracking-wide text-ocean">{held}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    );
                  })}
                  <td>
                    {clock
                      ? <ClockInput clock={clockValueOf(r.finish_time)} date={race.date} testId={`clock-input-${b.sail_no}`}
                          title="Finishing time of day (HH:MM:SS)" className="h-8 w-28 font-mono"
                          onCommit={(iso) => onClock(r.boat_id, iso)} />
                      : <ElapsedInput finishTime={r.finish_time} race={race} onCommit={(secs) => onElapsed(r.boat_id, secs)} />}
                  </td>
                  <td>
                    <Select value={shown === "DNS" ? "" : shown} onValueChange={(v) => v && onCode(r.boat_id, v)}>
                      <SelectTrigger className="h-8" data-testid={`time-code-${b.sail_no}`}><SelectValue placeholder="Code…">{shown}</SelectValue></SelectTrigger>
                      <SelectContent>{codes.map((c) => <SelectItem key={c.code} value={c.code}>{outcomeLabel(c.code, c.label)}</SelectItem>)}</SelectContent>
                    </Select>
                    {held && (
                      <button type="button" data-testid={`time-pending-${b.sail_no}`}
                        onClick={() => document.getElementById(`decision-row-${r.boat_id}`)?.scrollIntoView?.({ block: "nearest" })}
                        className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-ocean hover:underline">
                        {held} — enter points ↓
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={posCols.length + 3} className="py-4 text-sm text-muted-foreground">No racing boats — sign boats on above first.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {!clock && !hasStart && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300" data-testid="elapsed-no-start-note">
          No start time is recorded for this race — set the class start time or fire the start gun first, because every elapsed time is measured from the start.
        </p>
      )}
    </>
  );
}

// A time of day (HH:MM:SS) keyed in on the race date, as an ISO instant for
// `onCommit`. Commits on Enter or on blur, and only when the officer actually
// changed the value, so tabbing down prefilled inputs costs nothing. Shared by
// the per-boat finish times below and the race's own start time.
export function ClockInput({ clock, date, testId, title, onCommit, className }) {
  const last = useRef(clock || "");
  const commit = (text) => {
    if (!text || text === last.current) return;
    const iso = clockToIso(date, text);
    if (!iso) return;
    last.current = text;
    onCommit(iso);
  };
  return (
    <Input
      type="time"
      step="1"
      defaultValue={last.current}
      data-testid={testId}
      title={title}
      onKeyDown={(e) => { if (e.key === "Enter") commit(e.target.value); }}
      onBlur={(e) => commit(e.target.value)}
      className={className}
    />
  );
}
