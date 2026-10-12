import { Loader2 } from "lucide-react";

// The single "fetch in progress" indicator for the app. It stands in for a
// list, table or page while its data is on the way, so a slow connection reads
// as "loading" rather than as the empty state underneath — a spinner must
// never look like "no results" or an error.
export default function Loading({ label = "Loading…", className = "", compact = false }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="loading"
      className={`flex items-center justify-center gap-2 text-muted-foreground ${compact ? "py-3" : "py-10"} ${className}`}
    >
      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-ocean" aria-hidden="true" />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  );
}
