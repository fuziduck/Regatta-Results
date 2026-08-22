import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, KeyRound, ChevronDown } from "lucide-react";

export default function ForgotPassword() {
  const [clubs, setClubs] = useState([]);
  const [clubId, setClubId] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clubOpen, setClubOpen] = useState(false);

  useEffect(() => {
    api.getClubs().then((cs) => {
      setClubs(cs || []);
      setClubId((cs || [])[0]?.id || "");
    }).catch(() => {});
  }, []);

  const selectedClub = clubs.find((c) => c.id === clubId);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Enter your email address");
    setLoading(true);
    try {
      await api.forgotPassword(clubId || null, email.trim());
      // Always the same message — the endpoint never reveals whether the
      // account exists.
      setSent(true);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-ocean-dark">
      <div className="relative w-full max-w-md">
        <Link to="/login" className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-6 text-sm font-semibold transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to login
        </Link>
        <div className="bg-card rounded-2xl shadow-2xl p-8 border border-white/10">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-xl bg-ocean grid place-items-center">
              <KeyRound className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl uppercase tracking-tight leading-none text-foreground">Forgot passcode</h1>
              <p className="text-sm text-muted-foreground">We'll email you a reset link</p>
            </div>
          </div>

          {sent ? (
            <div className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-4 text-sm text-foreground">
              If an account exists for that email address, a passcode reset link
              has been sent. The link expires in 30 minutes.
              <div className="mt-4">
                <Link to="/login" className="text-ocean font-semibold hover:underline">Back to login</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              {clubs.length > 1 && (
                <div className="space-y-2">
                  <Label htmlFor="club">Club</Label>
                  <div className="relative">
                    <button
                      type="button"
                      id="club"
                      aria-haspopup="listbox"
                      aria-expanded={clubOpen}
                      onClick={() => setClubOpen((o) => !o)}
                      className="w-full h-12 pl-3 pr-3 rounded-lg border border-input bg-background text-base flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={selectedClub ? "font-semibold text-foreground" : "text-muted-foreground"}>
                        {selectedClub ? selectedClub.name : "Select a club"}
                      </span>
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                    {clubOpen && (
                      <ul role="listbox" aria-label="Clubs" className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-background shadow-xl">
                        {clubs.map((c) => (
                          <li key={c.id} role="option" aria-selected={c.id === clubId}>
                            <button
                              type="button"
                              onClick={() => { setClubId(c.id); setClubOpen(false); }}
                              className={`w-full text-left px-4 py-3 text-sm transition-colors hover:bg-muted/70 ${c.id === clubId ? "font-semibold text-ocean" : "text-foreground"}`}
                            >
                              {c.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@club.org"
                  autoComplete="email"
                  autoFocus
                  className="h-12 text-base"
                />
              </div>
              <Button type="submit" disabled={loading || !email.trim()} className="w-full h-12 text-base bg-ocean hover:bg-ocean-dark">
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-white/80">SailScore — Connecting sailing, one club at a time.</p>
      </div>
    </div>
  );
}
