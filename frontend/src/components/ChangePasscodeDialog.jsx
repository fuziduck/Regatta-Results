import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { passcodeError, PASSCODE_HINT } from "@/lib/helpers";

/**
 * Change your own passcode. Verifies the current passcode, revokes every
 * other session, and re-issues a fresh token for the current one via
 * onChanged (which must store the returned token, e.g. AuthContext.updateSession).
 *
 * Uncontrolled by default (the trigger button opens it). Pass `open` +
 * `onOpenChange` to control it from outside — e.g. the console mobile menu
 * opens it from a menu item while the trigger button stays desktop-only.
 */
export default function ChangePasscodeDialog({ onChanged, buttonClassName = "", open: controlledOpen, onOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const setOpen = (o) => {
    if (controlledOpen === undefined) setInternalOpen(o);
    if (!o) reset();
    onOpenChange?.(o);
  };

  const submit = async (e) => {
    e.preventDefault();
    const policy = passcodeError(next);
    if (policy) return toast.error(policy);
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
    <Dialog open={open} onOpenChange={setOpen}>
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
              placeholder="6+ chars with a number & special char"
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
          <p className="text-xs text-muted-foreground">{PASSCODE_HINT}</p>
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
