import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { elapsedSecondsOf } from "@/lib/helpers";

/**
 * Editable elapsed time as hours : minutes : seconds. Prefills from the
 * recorded finish minus the race start, and commits the whole H:M:S value as
 * whole seconds via onCommit (used to correct a wrong finish-button duration).
 * Phone-friendly: three compact numeric fields, native numeric keypad.
 */
export function ElapsedInput({ finishTime, race, onCommit, className = "" }) {
  const initial = elapsedSecondsOf(finishTime, race);
  const [h, setH] = useState(initial != null ? Math.floor(initial / 3600) : "");
  const [m, setM] = useState(initial != null ? Math.floor((initial % 3600) / 60) : "");
  const [s, setS] = useState(initial != null ? Math.round(initial % 60) : "");
  const dirty = useRef(false);

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
      onBlur={commit}
      className="h-8 w-12 font-mono text-center px-1"
    />
  );

  return (
    <div className={`flex items-center gap-1 ${className}`} title="Elapsed time (hours : minutes : seconds) — correct it if the finish-button tap was wrong">
      {field(h, setH, "hh", undefined)}
      <span className="text-muted-foreground">:</span>
      {field(m, setM, "mm", 59)}
      <span className="text-muted-foreground">:</span>
      {field(s, setS, "ss", 59)}
    </div>
  );
}
