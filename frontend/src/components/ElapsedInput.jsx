import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { elapsedSecondsOf } from "@/lib/helpers";

/**
 * Editable elapsed time as hours : minutes : seconds. Prefills from the
 * recorded finish minus the race start, and commits the whole H:M:S value as
 * whole seconds via onCommit (used to correct a wrong finish-button duration).
 * Phone-friendly: three compact numeric fields, native numeric keypad.
 *
 * The value commits once, when focus leaves the whole group (or on Enter) —
 * never on each field, because moving from hours to minutes is not a finished
 * time: committing there would score 1h → 1h30m → 1h30m00s as three separate
 * results and re-sequence the fleet mid-entry.
 */
export function ElapsedInput({ finishTime, race, onCommit, className = "" }) {
  const initial = elapsedSecondsOf(finishTime, race);
  const h0 = initial == null ? "" : Math.floor(initial / 3600);
  const m0 = initial == null ? "" : Math.floor((initial % 3600) / 60);
  const s0 = initial == null ? "" : Math.round(initial % 60);
  const [h, setH] = useState(h0);
  const [m, setM] = useState(m0);
  const [s, setS] = useState(s0);
  const dirty = useRef(false);

  // Re-prefill when the recorded finish or the race start moves under us — an
  // officer correcting the start, or a gun fired after the field was drawn.
  // Leaving the old duration on screen next to the live one invites a
  // correction measured from the wrong start.
  useEffect(() => {
    setH(h0);
    setM(m0);
    setS(s0);
    dirty.current = false;
  }, [h0, m0, s0]);

  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const hs = h === "" ? 0 : Number(h);
    const ms = m === "" ? 0 : Number(m);
    const ss = s === "" ? 0 : Number(s);
    if (hs === 0 && ms === 0 && ss === 0) return; // untouched / empty
    onCommit(hs * 3600 + ms * 60 + ss);
  };

  const field = (val, setVal, placeholder, max) => (
    <Input
      type="number"
      min="0"
      max={max}
      inputMode="numeric"
      value={val}
      placeholder={placeholder}
      onChange={(e) => { dirty.current = true; setVal(e.target.value); }}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      className="h-8 w-12 font-mono text-center px-1"
    />
  );

  return (
    <div
      className={`flex items-center gap-1 ${className}`}
      title="Elapsed time (hours : minutes : seconds) — correct it if the finish-button tap was wrong"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commit(); }}
    >
      {field(h, setH, "hh", undefined)}
      <span className="text-muted-foreground">:</span>
      {field(m, setM, "mm", 59)}
      <span className="text-muted-foreground">:</span>
      {field(s, setS, "ss", 59)}
    </div>
  );
}
