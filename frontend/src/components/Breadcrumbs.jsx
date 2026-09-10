import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/**
 * Breadcrumb navigation showing the page hierarchy.
 * Each item: { label: string, href?: string } — the last item has no href (current page).
 */
export default function Breadcrumbs({ items, className = "" }) {
  if (!items || items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={`flex flex-wrap items-center gap-1 text-sm text-muted-foreground ${className}`}>
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <span key={idx} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-border" />}
            {isLast || !item.href ? (
              <span className="font-semibold text-foreground">{item.label}</span>
            ) : (
              <Link to={item.href} className="font-semibold text-ocean hover:underline">{item.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
