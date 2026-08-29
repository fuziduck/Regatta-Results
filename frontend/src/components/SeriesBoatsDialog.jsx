import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Users } from "lucide-react";

// Let a race officer or club admin choose exactly which boats form part of a
// series. The DNC scoring engine scores these boats: a member that misses a
// race auto-scores DNC, while an unticked boat is excluded from the series
// standings even if it appeared in a race (e.g. a boat signed onto a
// different series). Clearing the whole list returns to auto-detection.
export default function SeriesBoatsDialog({ series, open, onOpenChange, clubId, onSaved }) {
  const [boats, setBoats] = useState([]);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !series) return;
    setSelected(Object.fromEntries((series.member_boat_ids || []).map((id) => [id, true])));
    api.getBoats({
      class_id: series.class_id,
      year: series.year,
      ...(clubId ? { club_id: clubId } : {}),
    }).then(setBoats).catch(() => setBoats([]));
  }, [open, series, clubId]);

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const count = Object.values(selected).filter(Boolean).length;

  const save = async () => {
    setBusy(true);
    try {
      const ids = boats.filter((b) => selected[b.id]).map((b) => b.id);
      const updated = await api.updateSeriesBoats(series.id, ids, series.version);
      toast.success(`Series fleet set to ${ids.length} boat${ids.length === 1 ? "" : "s"}`);
      onSaved?.(updated);
      onOpenChange(false);
    } catch (e) {
      if (e.response?.status === 409) {
        toast.error("This series has been changed by another user. Reload the latest settings before editing again.");
      } else {
        toast.error(e.response?.data?.detail || "Could not update series boats");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="series-boats-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase flex items-center gap-2">
            <Users className="w-4 h-4 text-ocean" /> Boats in {series?.name || "series"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Tick the boats that form part of this series. Only these boats are scored — a member that misses a race scores{" "}
          <strong>DNC</strong>, while an unticked boat is excluded from the standings even if it sailed (e.g. a boat signed
          onto a different series).
        </p>
        <p className="text-xs text-muted-foreground">{count} of {boats.length} class boat{boats.length === 1 ? "" : "s"} selected</p>
        <div className="space-y-1.5" data-testid="series-boats-list">
          {boats.length === 0 && <p className="text-sm text-muted-foreground">No boats in this class yet.</p>}
          {boats.map((b) => (
            <label
              key={b.id}
              className={`flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors ${selected[b.id] ? "border-ocean/50 bg-ocean/5" : "border-border"}`}
            >
              <Checkbox checked={!!selected[b.id]} onCheckedChange={() => toggle(b.id)} data-testid={`member-boat-${b.sail_no}`} />
              <span className="font-semibold text-sm">{b.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span>
              {b.helm && <span className="text-xs text-muted-foreground ml-auto">{b.helm}</span>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid="save-series-boats" className="bg-ocean hover:bg-ocean-dark">
            {busy ? "Saving…" : "Save fleet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
