import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, KeyRound } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 4) return toast.error("New passcode must be at least 4 characters");
    if (next !== confirm) return toast.error("New passcodes do not match");
    setLoading(true);
    try {
      await api.resetPassword(token, next);
      toast.success("Passcode reset — sign in with your new passcode");
      navigate("/login");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Could not reset passcode");
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
              <h1 className="text-2xl uppercase tracking-tight leading-none text-foreground">Reset passcode</h1>
              <p className="text-sm text-muted-foreground">Choose a new passcode</p>
            </div>
          </div>
          {!token ? (
            <p className="mt-6 text-sm text-muted-foreground">
              This reset link is missing its token — it may be broken. Use the
              “Forgot passcode” link on the login page to request a new one.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-passcode">New passcode</Label>
                <Input
                  id="new-passcode"
                  type="password"
                  required
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="4+ characters"
                  autoComplete="new-password"
                  autoFocus
                  className="h-12 text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-passcode">Confirm new passcode</Label>
                <Input
                  id="confirm-passcode"
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat the new passcode"
                  autoComplete="new-password"
                  className="h-12 text-base"
                />
              </div>
              <Button type="submit" disabled={loading || !next || !confirm} className="w-full h-12 text-base bg-ocean hover:bg-ocean-dark">
                {loading ? "Resetting…" : "Reset passcode"}
              </Button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-white/80">SailScore — Connecting sailing, one club at a time.</p>
      </div>
    </div>
  );
}
