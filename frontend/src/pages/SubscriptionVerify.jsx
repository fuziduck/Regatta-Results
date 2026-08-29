import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export default function SubscriptionVerify() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState("loading");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!token) { setState("error"); setMessage("This confirmation link is invalid."); return; }
    api.verifyResultsSubscription(token).then(() => setState("done")).catch((e) => { setState("error"); setMessage(e?.response?.data?.detail || "This confirmation link is invalid or has expired."); });
  }, [token]);
  if (state === "loading") return <div className="min-h-screen grid place-items-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  return <div className="min-h-screen grid place-items-center bg-background px-4"><div className="max-w-md text-center rounded-xl border border-border bg-card p-8">{state === "done" ? <><Check className="mx-auto w-12 h-12 text-emerald-600" /><h1 className="text-xl font-semibold mt-3">Subscription confirmed</h1><p className="text-sm text-muted-foreground mt-2">You'll now receive published results by email.</p></> : <><h1 className="text-xl font-semibold">Confirmation unavailable</h1><p className="text-sm text-muted-foreground mt-2">{message}</p></>}</div></div>;
}
