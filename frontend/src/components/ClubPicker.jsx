import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ClubBadge from "@/components/ClubBadge";
import { Building2 } from "lucide-react";

export default function ClubPicker({ onPick, title = "Choose a club", subtitle }) {
  const [clubs, setClubs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getClubs()
      .then((cs) => setClubs(cs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl uppercase tracking-tighter mb-1">{title}</h1>
      <p className="text-muted-foreground text-sm mb-6">{subtitle || "Pick the club whose console you want to open."}</p>
      {loading ? (
        <p className="text-muted-foreground">Loading clubs…</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {clubs.map((c) => (
            <button
              key={c.id}
              data-testid={`pick-club-${c.slug}`}
              onClick={() => onPick(c)}
              className="rounded-xl border border-border bg-card p-5 flex items-center gap-4 text-left hover:border-ocean hover:shadow-lg transition-all active:scale-[0.98]"
            >
              <ClubBadge club={c} size="w-12 h-12" textSize="text-xl" rounded="rounded-xl" />
              <span>
                <span className="block font-heading text-xl uppercase tracking-tight leading-none">{c.name}</span>
                <span className="text-xs text-muted-foreground mt-1 block">{c.slug}</span>
              </span>
            </button>
          ))}
          {!clubs.length && (
            <p className="text-muted-foreground col-span-full">
              No clubs set up yet — <Building2 className="w-4 h-4 inline-block" /> add one from the Webmaster page.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
