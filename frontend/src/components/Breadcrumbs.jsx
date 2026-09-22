import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/**
 * Breadcrumb navigation showing the page hierarchy.
 * Each item: { label, href?, onClick? }. A crumb with a destination is
 * clickable — href for another page, onClick for a step within this one; a
 * crumb with neither is the page you are on (bold, not clickable).
 */
export default function Breadcrumbs({ items, className = "" }) {
  if (!items || items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={`flex flex-wrap items-center gap-1 text-sm text-muted-foreground ${className}`}>
      {items.map((item, idx) => (
        <span key={idx} className="flex items-center gap-1">
          {idx > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-border" />}
          {item.href ? (
            <Link to={item.href} className="font-semibold text-ocean hover:underline">{item.label}</Link>
          ) : item.onClick ? (
            <button type="button" onClick={item.onClick} className="font-semibold text-ocean hover:underline">{item.label}</button>
          ) : (
            <span className="font-semibold text-foreground" aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
