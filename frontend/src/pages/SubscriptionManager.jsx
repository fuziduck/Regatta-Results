import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bell, Check, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";

export default function SubscriptionManager() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [data, setData] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [busyAll, setBusyAll] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () => {
    if (!token) { setData({ token_valid: false, subscriptions: [] }); return; }
    api.getSubscriptionManagement(token).then(setData).catch(() => setData({ token_valid: false, subscriptions: [] }));
  };
  useEffect(load, [token]);
  const removeOne = async (id) => { setBusyId(id); setError(""); setMessage(""); try { await api.removeResultSubscription(id, token); setMessage("Subscription removed."); load(); } catch (e) { setError(e?.response?.data?.detail || "Could not remove this subscription."); } finally { setBusyId(null); } };
  const removeAll = async () => { setBusyAll(true); setError(""); setMessage(""); try { const result = await api.unsubscribeAllResults(token); setMessage(result.message || "You have been unsubscribed from all Sailscore results emails."); setData({ token_valid: false, subscriptions: [] }); } catch (e) { setError(e?.response?.data?.detail || "Could not remove the subscriptions."); } finally { setBusyAll(false); } };
  return <div className="min-h-screen bg-background"><header className="border-b border-border bg-background/90"><div className="max-w-3xl mx-auto px-4 h-16 flex items-center"><Link to="/"><Logo className="h-10 w-auto" /></Link></div></header><main className="max-w-3xl mx-auto px-4 py-12"><div className="flex items-center gap-3 mb-2"><Bell className="w-6 h-6 text-ocean" /><h1 className="text-2xl uppercase tracking-tight">Manage my subscriptions</h1></div><p className="text-sm text-muted-foreground mb-6">Use this secure link to manage the published results you receive by email.</p>{message && <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status"><Check className="w-4 h-4" />{message}</div>}{error && <p className="mb-4 text-sm text-red-600" role="alert">{error}</p>}{!data ? <div className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto w-5 h-5 animate-spin" /></div> : !data.token_valid ? <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center" data-testid="subscription-token-invalid"><p className="font-semibold">This subscription link is no longer active.</p><p className="text-sm text-muted-foreground mt-1">It may have expired or all subscriptions may already have been removed.</p></div> : <><div className="space-y-3" data-testid="subscription-list">{data.subscriptions.map((subscription) => <div key={subscription.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"><div><div className="text-xs uppercase tracking-widest text-muted-foreground">{subscription.subscription_type} results</div><div className="font-semibold mt-1">{subscription.target_name}</div></div><Button variant="ghost" size="icon" aria-label={`Remove ${subscription.target_name}`} disabled={busyId === subscription.id} onClick={() => removeOne(subscription.id)} data-testid={`remove-subscription-${subscription.id}`}><Trash2 className="w-4 h-4 text-red-600" /></Button></div>)}</div><Button variant="outline" className="mt-6 gap-2 border-red-300 text-red-700 hover:bg-red-50" disabled={busyAll} onClick={removeAll} data-testid="unsubscribe-all">{busyAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Unsubscribe from all</Button></>}</main></div>;
}
