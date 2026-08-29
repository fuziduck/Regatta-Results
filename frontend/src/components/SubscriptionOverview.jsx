import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw, Bell, Trash2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

function SubscriptionTable({ rows, deleting, remove }) {
  return <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="px-3 py-2 text-left">Email address</th><th className="px-3 py-2 text-left">Notification target</th><th className="px-3 py-2 text-left">Confirmed</th><th className="px-3 py-2 text-right">Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="px-3 py-3 font-medium"><span className="inline-flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" />{row.email}</span></td><td className="px-3 py-3"><span className="capitalize text-xs font-semibold text-ocean">{row.subscription_type}</span><div>{row.target_name || row.target_id}</div></td><td className="px-3 py-3 text-xs text-muted-foreground">{row.verified_at ? new Date(row.verified_at).toLocaleString("en-GB") : "—"}</td><td className="px-3 py-3 text-right"><Button variant="ghost" size="icon" aria-label={`Delete ${row.email}`} disabled={deleting === row.id} onClick={() => remove(row)} data-testid={`delete-subscription-${row.id}`}><Trash2 className="w-4 h-4 text-red-600" /></Button></td></tr>)}</tbody></table></div>;
}

export default function SubscriptionOverview({ clubId = null, webmaster = false }) {
  const [rows, setRows] = useState(null);
  const [clubs, setClubs] = useState([]);
  // Webmaster club filter: "" = every club (grouped accordion), otherwise a
  // single club's subscriptions are shown as a plain table.
  const [selectedClub, setSelectedClub] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);

  // The webmaster's dropdown needs the club list regardless of selection.
  useEffect(() => {
    if (webmaster) api.getClubsManage().then((cs) => setClubs(cs || [])).catch(() => {});
  }, [webmaster]);

  const load = useCallback(() => {
    setError("");
    const request = webmaster
      ? (selectedClub
          ? api.getAdminSubscriptions(selectedClub)
          : Promise.all([api.getClubsManage(), api.getAdminSubscriptions(null)])
              .then(([clubList, allRows]) => { setClubs(clubList || []); return allRows; }))
      : api.getAdminSubscriptions(clubId);
    request.then(setRows).catch((e) => { setError(e?.response?.data?.detail || "Could not load notification subscriptions."); setRows([]); });
  }, [clubId, webmaster, selectedClub]);
  useEffect(() => { load(); }, [load]);

  const remove = async (row) => {
    if (!window.confirm(`Remove all subscriptions for ${row.email}?`)) return;
    setDeleting(row.id);
    try {
      // The webmaster deletes within the club scope shown (dropdown choice,
      // or the row's own club when viewing the all-clubs view).
      const scope = webmaster ? (selectedClub || row.club_id) : clubId;
      await api.deleteAdminSubscription(row.id, scope);
      toast.success("Subscription removed");
      load();
    }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not remove subscription"); }
    finally { setDeleting(null); }
  };

  return <section className="rounded-2xl border border-border bg-card p-5 space-y-4" data-testid="subscription-overview">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-xl uppercase tracking-tight"><Bell className="w-5 h-5 text-ocean" /> Results email subscriptions</h2>
        <p className="text-sm text-muted-foreground mt-1">Active, verified email subscriptions and what each address follows.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {webmaster && (
          <div className="flex items-center gap-2">
            <Label className="text-sm shrink-0">Club</Label>
            <Select value={selectedClub || "__all__"} onValueChange={(v) => setSelectedClub(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-56" data-testid="subscription-club-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All clubs</SelectItem>
                {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4" /> Refresh</Button>
      </div>
    </div>
    {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    {rows === null
      ? <p className="text-sm text-muted-foreground">Loading subscriptions…</p>
      : webmaster && !selectedClub
        ? <Accordion type="multiple" className="space-y-2">{clubs.map((club) => { const clubRows = rows.filter((row) => row.club_id === club.id); return <AccordionItem key={club.id} value={club.id} className="rounded-xl border border-border px-4"><AccordionTrigger className="font-heading uppercase hover:no-underline">{club.name}<span className="ml-2 text-xs font-normal text-muted-foreground">({clubRows.length})</span></AccordionTrigger><AccordionContent>{clubRows.length ? <SubscriptionTable rows={clubRows} deleting={deleting} remove={remove} /> : <p className="text-sm text-muted-foreground py-3">No active subscriptions.</p>}</AccordionContent></AccordionItem>; })}</Accordion>
        : rows.length === 0
          ? <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No active email subscriptions.</p>
          : <SubscriptionTable rows={rows} deleting={deleting} remove={remove} />}
  </section>;
}
