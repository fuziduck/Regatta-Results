import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ElapsedInput } from "@/components/ElapsedInput";
import { clockToIso, clockValueOf, outcomeLabel } from "@/lib/helpers";

/**
 * Desk entry for handicap results: one row per racing boat, keyed in rather
 * than tapped live. `mode` is what the officer types - "clock" (the finishing
 * time of day) or "elapsed" (the duration since the start). Both commit
 * through the same finish endpoints the tap grid uses, so the scoring engine,
 * corrected times and sequencing are unchanged. `codes` is the Appendix A
 * catalogue from /rrs-codes ({code, label} entries), the same list every other
 * code menu in the console offers.
 */
export function RaceTimeEntry({ mode, rows, boats, race, codes, hasStart, onClock, onElapsed, onCode }) {
  const clock = mode === "clock";
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={`time-entry-${mode}`}>
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-2">Boat</th>
              <th className="w-14">Pos</th>
              <th className={clock ? "w-32" : "w-40"}>{clock ? "Finish time" : "Elapsed"}</th>
              <th className="w-32">Code / Penalty (RRS)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const b = boats[r.boat_id] || {};
              return (
                <tr key={r.boat_id} className="border-b last:border-0">
                  <td className="py-1.5 font-semibold">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span></td>
                  <td className="font-mono">{r.code === "FINISHED" ? r.position : <span className="text-muted-foreground">—</span>}</td>
                  <td>
                    {clock
                      ? <ClockInput clock={clockValueOf(r.finish_time)} date={race.date} testId={`clock-input-${b.sail_no}`}
                          title="Finishing time of day (HH:MM:SS)" className="h-8 w-28 font-mono"
                          onCommit={(iso) => onClock(r.boat_id, iso)} />
                      : <ElapsedInput finishTime={r.finish_time} race={race} onCommit={(secs) => onElapsed(r.boat_id, secs)} />}
                  </td>
                  <td>
                    <Select value={r.code === "DNS" ? "" : r.code} onValueChange={(v) => v && onCode(r.boat_id, v)}>
                      <SelectTrigger className="h-8" data-testid={`time-code-${b.sail_no}`}><SelectValue placeholder="Code…">{r.code}</SelectValue></SelectTrigger>
                      <SelectContent>{codes.map((c) => <SelectItem key={c.code} value={c.code}>{outcomeLabel(c.code, c.label)}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-sm text-muted-foreground">No racing boats — sign boats on above first.</td></tr>
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
