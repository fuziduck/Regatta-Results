import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

/**
 * Change your own passcode. Verifies the current passcode, revokes every
 * other session, and re-issues a fresh token for the current one via
 * onChanged (which must store the returned token, e.g. AuthContext.updateSession).
 */
export default function ChangePasscodeDialog({ onChanged, buttonClassName = "" }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 4) return toast.error("New passcode must be at least 4 characters");
    if (next !== confirm) return toast.error("New passcodes do not match");
    setLoading(true);
    try {
      const data = await api.changePasscode(current, next);
      onChanged(data);
      toast.success("Passcode updated");
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Could not change passcode");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={buttonClassName || "text-white hover:bg-white/15"}
          data-testid="change-passcode-btn"
        >
          <KeyRound className="w-4 h-4 mr-1" /> Change passcode
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-heading uppercase">Change passcode</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Current passcode</Label>
            <Input
              type="password"
              data-testid="cp-current"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Your current passcode"
              autoComplete="current-password"
              autoFocus
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label>New passcode</Label>
            <Input
              type="password"
              data-testid="cp-new"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="4+ characters"
              autoComplete="new-password"
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new passcode</Label>
            <Input
              type="password"
              data-testid="cp-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat the new passcode"
              autoComplete="new-password"
              className="h-11"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Changing your passcode signs out every other device — this session stays signed in.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={loading || !current || !next || !confirm} className="bg-ocean hover:bg-ocean-dark">
              {loading ? "Updating…" : "Update passcode"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
