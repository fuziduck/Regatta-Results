import { useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/api";

export default function ResultsSubscription({ subscriptionType, targetId, targetName, className = "", buttonLabel = "Subscribe to Results", dialogTitle = "Get results by email", description }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle");
  const [message, setMessage] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    setState("busy");
    try {
      const result = await api.subscribeResults(email.trim(), subscriptionType, targetId);
      setState("sent");
      setMessage(result.message || "Check your email to confirm your subscription.");
    } catch (error) {
      setState("error");
      setMessage(error?.response?.data?.detail || "Could not start the subscription. Please try again.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setState("idle"); setMessage(""); } }}>
      <DialogTrigger asChild><Button variant="outline" size="sm" className={`gap-1.5 bg-ocean text-white border-ocean shadow-sm hover:bg-ocean-dark hover:text-white dark:bg-sky-500 dark:border-sky-400 dark:text-slate-950 dark:hover:bg-sky-400 ${className}`} data-testid={`subscribe-${subscriptionType}`}><Bell className="w-4 h-4" /> {buttonLabel}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{dialogTitle}</DialogTitle></DialogHeader>
        {state === "sent" ? <div className="py-4 text-center space-y-3" data-testid="subscription-sent"><Check className="mx-auto w-10 h-10 text-emerald-600" /><h3 className="font-semibold">Check your email</h3><p className="text-sm text-muted-foreground">{message}</p></div> : <form onSubmit={submit} className="space-y-4"><p className="text-sm text-muted-foreground">{description || <>We'll send you an email whenever new published results are available for <strong className="text-foreground">{targetName}</strong>. No Sailscore account is needed.</>}</p><div className="space-y-1.5"><Label htmlFor={`subscription-email-${subscriptionType}`}>Email address</Label><Input id={`subscription-email-${subscriptionType}`} type="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" data-testid="subscription-email" /></div>{state === "error" && <p className="text-sm text-red-600" role="alert">{message}</p>}<Button type="submit" disabled={state === "busy"} className="w-full gap-2 bg-ocean hover:bg-ocean-dark" data-testid="subscription-submit">{state === "busy" && <Loader2 className="w-4 h-4 animate-spin" />} Subscribe</Button></form>}
      </DialogContent>
    </Dialog>
  );
}
