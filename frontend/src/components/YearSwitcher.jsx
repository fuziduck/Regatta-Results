import { CURRENT_YEAR, MAX_YEAR } from "@/lib/helpers";
import { Button } from "@/components/ui/button";

function YearPill({ year, value, onChange }) {
  const active = year === value;
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={() => onChange(year)}
      data-testid={`year-btn-${year}`}
      className={
        active
          ? "bg-safety text-white border-safety hover:bg-safety/90 font-heading uppercase tracking-wide"
          : "bg-white/10 text-white border-white/40 hover:bg-white/25 font-heading uppercase tracking-wide"
      }
    >
      {year}
    </Button>
  );
}

function YearGroup({ label, years, value, onChange }) {
  if (!years.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-white/70 text-[11px] uppercase tracking-widest font-semibold">{label}</span>
      <div className="flex flex-wrap gap-2">
        {years.map((y) => <YearPill key={y} year={y} value={value} onChange={onChange} />)}
      </div>
    </div>
  );
}

/**
 * Year selector for results pages, oldest-to-newest. The selected year always
 * renders as an orange (safety) pill; all other seasons render as muted
 * translucent pills that work over the hero photo. Pass the years to show;
 * future years are typically supplied by the caller from `/seasons` so only
 * years with a series set up appear.
 *
 * `grouped` renders the pills under Past / Current / Future headings instead
 * of one flat row; pass `labels` to override the three group headings.
 */
export default function YearSwitcher({ value, onChange, years = [CURRENT_YEAR - 1], className = "", grouped = false, labels = {} }) {
  const all = [...new Set([CURRENT_YEAR, ...years])].filter((y) => y >= 2000 && y <= MAX_YEAR).sort((a, b) => a - b);
  const L = { past: "Past", current: "Current", future: "Future", ...labels };

  if (grouped) {
    return (
      <div className={`flex flex-wrap items-start gap-x-8 gap-y-4 ${className}`} data-testid="year-switcher">
        <YearGroup label={L.past} years={all.filter((y) => y < CURRENT_YEAR)} value={value} onChange={onChange} />
        <YearGroup label={L.current} years={all.filter((y) => y === CURRENT_YEAR)} value={value} onChange={onChange} />
        <YearGroup label={L.future} years={all.filter((y) => y > CURRENT_YEAR)} value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid="year-switcher">
      {all.map((y) => <YearPill key={y} year={y} value={value} onChange={onChange} />)}
    </div>
  );
}
