import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw, Bell } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function SubscriptionOverview({ clubId = null }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    api.getAdminSubscriptions(clubId).then(setRows).catch((e) => {
      setError(e?.response?.data?.detail || "Could not load notification subscriptions.");
      setRows([]);
    });
  }, [clubId]);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4" data-testid="subscription-overview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl uppercase tracking-tight"><Bell className="w-5 h-5 text-ocean" /> Results email subscriptions</h2>
          <p className="text-sm text-muted-foreground mt-1">Active, verified email subscriptions for this club and what each address follows.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4" /> Refresh</Button>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {rows === null ? <p className="text-sm text-muted-foreground">Loading subscriptions…</p> : rows.length === 0 ? <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No active email subscriptions.</p> : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted"><tr><th className="px-3 py-2 text-left">Email address</th><th className="px-3 py-2 text-left">Notification target</th><th className="px-3 py-2 text-left">Confirmed</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="px-3 py-3 font-medium"><span className="inline-flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" />{row.email}</span></td><td className="px-3 py-3"><span className="capitalize text-xs font-semibold text-ocean">{row.subscription_type}</span><div>{row.target_name || row.target_id}</div></td><td className="px-3 py-3 text-xs text-muted-foreground">{row.verified_at ? new Date(row.verified_at).toLocaleString("en-GB") : "—"}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
