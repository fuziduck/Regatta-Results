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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) { setData({ token_valid: false }); return; }
    api.getSubscriptionManagement(token).then(setData).catch(() => setData({ token_valid: false }));
  }, [token]);

  const unsubscribe = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api.unsubscribeAllResults(token);
      setMessage(result.message || "You have been unsubscribed from all SailScore results emails.");
      setData({ token_valid: false });
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not remove the subscriptions.");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/90"><div className="max-w-3xl mx-auto px-4 h-16 flex items-center"><Link to="/"><Logo className="h-10 w-auto" /></Link></div></header>
      <main className="max-w-3xl mx-auto px-4 py-12">
        <div className="flex items-center gap-3 mb-2"><Bell className="w-6 h-6 text-ocean" /><h1 className="text-2xl uppercase tracking-tight">Unsubscribe from results</h1></div>
        <p className="text-sm text-muted-foreground mb-6">Permanently remove this email address from all SailScore results email subscriptions.</p>
        {message && <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status"><Check className="w-4 h-4" />{message}</div>}
        {error && <p className="mb-4 text-sm text-red-600" role="alert">{error}</p>}
        {!data ? <div className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto w-5 h-5 animate-spin" /></div> : (
          <div className="rounded-xl border border-border bg-card p-6 text-center" data-testid="subscription-unsubscribe">
            <p className="text-sm text-muted-foreground">This action removes every active and pending results subscription linked to this email address.</p>
            <Button className="mt-6 gap-2 bg-red-600 text-white hover:bg-red-700" disabled={busy || !data.token_valid} onClick={unsubscribe} data-testid="unsubscribe-all">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Unsubscribe permanently
            </Button>
            {!data.token_valid && <p className="mt-3 text-xs text-muted-foreground">This unsubscribe link has already been used.</p>}
          </div>
        )}
      </main>
    </div>
  );
}
