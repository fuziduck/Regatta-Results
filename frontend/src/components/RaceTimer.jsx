import { Clock, Play, RotateCcw, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ClockInput } from "@/components/RaceTimeEntry";
import { clockValueOf, fmtClock, fmtElapsed, raceClock } from "@/lib/helpers";

/**
 * The officer's timing strip: the race timer the officer acts on, the time of
 * day they read a finish time off, and the start both are measured from. What
 * the timer number means — its label, its note, how it reads — is raceClock()'s
 * business; this only lays it out.
 *
 * `onSetStart` takes the actual start as an ISO instant, `onClearStart` drops
 * the gun back to the planned start, `onStart` fires the gun now.
 */
export default function RaceTimer({ race, now, showStartEditor, onSetStart, onClearStart, onStart }) {
  const clock = raceClock(race, now);
  return (
    <section className="rounded-2xl overflow-hidden bg-ocean-dark text-white relative" data-testid="timing-strip">
      <div className="absolute inset-0 bg-gradient-to-br from-ocean-dark via-ocean to-ocean-light opacity-90" />
      <div className="relative p-4 sm:p-5 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="min-w-[8.5rem]">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/60">
            <Timer className="w-3.5 h-3.5" /> {clock.label}
          </div>
          <div className={`font-mono text-3xl sm:text-4xl font-bold tabular-nums leading-none mt-1.5 ${clock.tone}`} data-testid="race-clock">
            {clock.ms == null ? "--:--" : fmtElapsed(clock.ms)}
          </div>
          <div className="text-xs text-white/70 mt-1.5" data-testid="race-clock-note">{clock.note}</div>
        </div>

        <div className="hidden sm:block w-px self-stretch bg-white/20" />

        <div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/50">
            <Clock className="w-3.5 h-3.5" /> Time of day
          </div>
          <div className="font-mono text-lg font-semibold tabular-nums leading-none mt-1.5 text-white/70" data-testid="wall-clock">
            {fmtClock(now)}
          </div>
        </div>

        <div className="flex-1" />

        {showStartEditor && (
          <div className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5" data-testid="start-time-editor">
            <Label className="text-[10px] uppercase tracking-widest text-white/60">Actual start</Label>
            <ClockInput
              key={`${race.id}-${race.actual_start || race.start_time || "none"}`}
              clock={race.actual_start ? clockValueOf(race.actual_start) : (race.start_time || "")}
              date={race.date}
              testId="start-time-input"
              title="The instant every finish time is measured from — type the actual start (HH:MM:SS)"
              onCommit={onSetStart}
              className="h-8 w-[5.5rem] px-1.5 font-mono text-sm text-white bg-white/15 border-white/30 focus-visible:ring-white/40"
            />
            {race.actual_start && (
              <Button size="sm" variant="ghost" className="h-8 px-2 text-white/80 hover:bg-white/15 hover:text-white"
                onClick={onClearStart} data-testid="clear-gun-btn" title="Drop the gun and time from the planned start">
                <RotateCcw className="w-4 h-4" /> Reset
              </Button>
            )}
          </div>
        )}

        <Button className="gap-2 bg-safety hover:bg-safety-dark text-white" onClick={onStart} data-testid="start-gun-btn">
          <Play className="w-4 h-4" /> {race.actual_start ? "Re-start" : "Start race"}
        </Button>
      </div>
    </section>
  );
}
