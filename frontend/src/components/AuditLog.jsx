import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ScrollText, RefreshCw, Search } from "lucide-react";

const PAGE = 100;

const ACTIONS = [
  "AUTH_LOGIN_SUCCESS", "AUTH_LOGIN_FAILED", "AUTH_LOCKOUT", "AUTH_LOGOUT",
  "PASSCODE_CHANGE", "PASSWORD_RESET_REQUESTED", "PASSWORD_RESET_COMPLETED",
  "USER_CREATED", "USER_UPDATED", "USER_DEACTIVATED", "USER_REACTIVATED",
  "USER_DELETED", "USER_ROLE_CHANGED", "USER_PASSCODE_RESET",
  "CLUB_CREATED", "CLUB_UPDATED", "CLUB_DELETED", "CLUB_ICON_UPDATED", "CLUB_ICON_DELETED",
  "CLASS_CREATED", "CLASS_UPDATED", "CLASS_DELETED",
  "BOAT_CREATED", "BOAT_UPDATED", "BOAT_DELETED",
  "SERIES_CREATED", "SERIES_UPDATED", "SERIES_DELETED",
  "RACE_CREATED", "RACE_UPDATED", "RACE_DELETED",
  "RESULTS_SUBMITTED", "RESULTS_UPDATED", "RESULTS_PUBLISHED", "RESULTS_UNPUBLISHED",
  "RACE_STATUS_CHANGED",
  "ADVERT_CREATED", "ADVERT_UPDATED", "ADVERT_DELETED", "ADVERT_IMAGE_UPDATED",
  "EMAIL_SETTINGS_CHANGED", "EMAIL_TEST_SENT", "BACKUP_DOWNLOAD", "BACKUP_RESTORE",
];

function prettyAction(a) {
  return (a || "").replace(/_/g, " ");
}

export default function AuditLog({ clubId = null, webmaster = false }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [clubFilter, setClubFilter] = useState(clubId || "");
  const [clubs, setClubs] = useState([]);
  const [username, setUsername] = useState("");
  const [action, setAction] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedAll, setLoadedAll] = useState(false);

  const clubName = (id) =>
    id === null ? "System" : (clubs.find((c) => c.id === id)?.name || id || "—");

  useEffect(() => {
    api.getClubs().then((cs) => setClubs(cs || [])).catch(() => {});
  }, []);

  const load = useCallback(async (start, fromScratch) => {
    setBusy(true);
    try {
      const params = { limit: PAGE, offset: start };
      if (webmaster && clubFilter) params.club_id = clubFilter;
      if (username.trim()) params.username = username.trim().toLowerCase();
      if (action) params.action = action;
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      const d = await api.getAudit(params);
      setItems((prev) => (fromScratch ? d.items : [...prev, ...d.items]));
      setTotal(d.total || 0);
      setLoadedAll(start + d.items.length >= (d.total || 0));
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not load the audit log");
    } finally {
      setBusy(false);
    }
  }, [webmaster, clubFilter, username, action, fromDate, toDate]);

  useEffect(() => { load(0, true); }, [load]); // eslint-disable-line

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="px-5 pt-5 pb-3 border-b border-border flex flex-wrap items-center gap-2.5">
        <ScrollText className="w-5 h-5 text-ocean" />
        <h2 className="font-heading text-lg uppercase tracking-tight">Audit log</h2>
        <span className="text-xs text-muted-foreground ml-auto">{total} event{total === 1 ? "" : "s"}</span>
      </div>

      <div className="p-4 border-b border-border grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        {webmaster && (
          <div className="space-y-1.5">
            <Label className="text-xs">Club</Label>
            <select
              value={clubFilter}
              onChange={(e) => setClubFilter(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
              data-testid="audit-club-filter"
            >
              <option value="">All clubs</option>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">User</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="email address" className="h-10 text-sm" data-testid="audit-user-filter" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Action</Label>
          <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. LOGIN_SUCCESS" list="audit-actions" className="h-10 text-sm" data-testid="audit-action-filter" />
          <datalist id="audit-actions">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-10 text-sm" data-testid="audit-from-filter" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-10 text-sm" data-testid="audit-to-filter" />
        </div>
        <Button onClick={() => load(0, true)} disabled={busy} className="h-10 gap-2 bg-ocean hover:bg-ocean-dark" data-testid="audit-refresh">
          <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead>
            <tr className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Time</th>
              <th className="px-4 py-2.5 font-semibold">User</th>
              <th className="px-4 py-2.5 font-semibold">Club</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
              <th className="px-4 py-2.5 font-semibold">Action</th>
              <th className="px-4 py-2.5 font-semibold">Details</th>
              <th className="px-4 py-2.5 font-semibold">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((e) => (
              <tr key={e.id} data-testid={`audit-row-${e.id}`} className="hover:bg-muted/40">
                <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {e.timestamp ? new Date(e.timestamp).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap font-semibold">{e.username || "—"}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{clubName(e.club_id)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap capitalize">{e.role || "—"}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${e.success ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                    {prettyAction(e.action)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground max-w-md truncate" title={e.description}>{e.description || "—"}</td>
                <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs text-muted-foreground">{e.ip_address || "—"}</td>
              </tr>
            ))}
            {!items.length && !busy && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No audit events match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Showing {items.length} of {total} — most recent first
        </span>
        {!loadedAll && (
          <Button size="sm" variant="outline" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white" disabled={busy} onClick={() => load(items.length, false)} data-testid="audit-load-more">
            <Search className="w-4 h-4" /> Load more
          </Button>
        )}
      </div>
    </div>
  );
}
