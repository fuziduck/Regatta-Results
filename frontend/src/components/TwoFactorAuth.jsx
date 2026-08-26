import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, Mail, Smartphone } from "lucide-react";

// Two-factor authentication (TOTP from an authenticator app, with an emailed
// one-time code as the recovery fallback) for any signed-in account — the
// webmaster console renders this as a section, club staff get it in a dialog
// from the console top bar. Disabling requires the passcode AND a live code,
// so a stolen session alone cannot turn it off.
export default function TwoFactorAuth() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  // Enable flow
  const [enableOpen, setEnableOpen] = useState(false);
  const [setup, setSetup] = useState(null); // { secret, otpauth_uri }
  const [enableCode, setEnableCode] = useState("");
  const [enableEmail, setEnableEmail] = useState("");

  // Disable flow
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePasscode, setDisablePasscode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableMethod, setDisableMethod] = useState("totp");

  // Fallback email flow
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [emailPasscode, setEmailPasscode] = useState("");

  const load = useCallback(() => {
    api.get2faStatus().then(setStatus).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const startEnable = async () => {
    setBusy(true);
    try {
      const s = await api.setup2fa();
      setSetup(s);
      setEnableCode("");
      setEnableEmail("");
      setEnableOpen(true);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not start 2FA setup");
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    setBusy(true);
    try {
      await api.enable2fa(enableCode.trim(), enableEmail.trim() || undefined);
      toast.success("Two-factor authentication enabled");
      setEnableOpen(false);
      setSetup(null);
      setEnableCode("");
      setEnableEmail("");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not enable 2FA");
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async () => {
    setBusy(true);
    try {
      await api.disable2fa(disablePasscode, disableCode.trim(), disableMethod);
      toast.success("Two-factor authentication disabled");
      setDisableOpen(false);
      setDisablePasscode("");
      setDisableCode("");
      setDisableMethod("totp");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not disable 2FA");
    } finally {
      setBusy(false);
    }
  };

  const sendDisableEmail = async () => {
    setBusy(true);
    try {
      const r = await api.sendEmailCode();
      setDisableMethod("email");
      setDisableCode("");
      if (r.dev_code) toast.info(`Dev code: ${r.dev_code}`);
      else toast.success("A sign-in code has been emailed to you");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not send the code");
    } finally {
      setBusy(false);
    }
  };

  const saveEmail = async () => {
    setBusy(true);
    try {
      await api.update2faEmail(emailPasscode, emailValue.trim());
      toast.success("Recovery email updated");
      setEmailOpen(false);
      setEmailValue("");
      setEmailPasscode("");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not update recovery email");
    } finally {
      setBusy(false);
    }
  };

  const enabled = !!status?.enabled;

  // The 2FA status is fetched on mount; until it resolves there is nothing
  // safe to render (status fields are read directly below).
  if (!status) {
    return <p className="text-sm text-muted-foreground">Loading security settings…</p>;
  }

  return (
    <div>
      {!enabled && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 p-4 mb-5 text-sm text-amber-800 dark:text-amber-200" data-testid="2fa-warning">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldOff className="w-4 h-4" /> 2FA is off — sign-in is protected by passcode only
          </div>
          <p className="mt-1 text-xs opacity-90">
            A leaked passcode would let someone into this account. Enable two-factor authentication below.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 max-w-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl grid place-items-center ${enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="font-heading text-lg uppercase tracking-tight">{enabled ? "Two-factor authentication enabled" : "Two-factor authentication disabled"}</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {enabled
                  ? `Authenticator app${status.has_email ? " + emailed fallback code" : ""} required to sign in.`
                  : "Sign-in currently requires only your passcode."}
              </p>
            </div>
          </div>
          {!enabled ? (
            <Button className="gap-2 bg-ocean hover:bg-ocean-dark" data-testid="enable-2fa-btn" onClick={startEnable} disabled={busy}>
              <Smartphone className="w-4 h-4" /> Enable 2FA
            </Button>
          ) : (
            <Button variant="outline" className="gap-2 border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-500/10" data-testid="disable-2fa-btn" onClick={() => { setDisableOpen(true); setDisablePasscode(""); setDisableCode(""); setDisableMethod("totp"); }} disabled={busy}>
              <ShieldOff className="w-4 h-4" /> Disable
            </Button>
          )}
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold">Recovery email</span>
              <span className="text-muted-foreground">{status.email || (enabled ? "Not set — recovery via authenticator app only" : "Not set — no emailed reset links or 2FA codes")}</span>
            </div>
            <Button size="sm" variant="outline" data-testid="edit-fallback-email-btn"
              onClick={() => { setEmailOpen(true); setEmailValue(""); setEmailPasscode(""); }}>
              {status.has_email ? "Change" : "Set"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Emailed one-time codes are your recovery path if the authenticator app is lost. Keep it up to date.
          </p>
        </div>
      </div>

      {/* Enable dialog */}
      <Dialog open={enableOpen} onOpenChange={(o) => { if (!o) { setEnableOpen(false); setSetup(null); } }}>
        <DialogContent data-testid="enable-2fa-dialog">
          <DialogHeader><DialogTitle className="font-heading uppercase">Enable two-factor authentication</DialogTitle></DialogHeader>
          {setup ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-xl border border-border bg-white p-3">
                  <QRCodeSVG value={setup.otpauth_uri} size={180} />
                </div>
                <p className="text-xs text-muted-foreground text-center max-w-sm">
                  Scan this with your authenticator app (Google Authenticator, 1Password, Authy…). No scanner? Enter the secret manually:
                </p>
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all text-center max-w-xs">{setup.secret}</code>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="enable-code">Enter the 6-digit code from your app</Label>
                <InputOTP id="enable-code" maxLength={6} value={enableCode} onChange={setEnableCode} data-testid="enable-otp-input" autoFocus>
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => <InputOTPSlot key={i} index={i} />)}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="enable-email">Recovery email (optional)</Label>
                <Input id="enable-email" type="email" data-testid="enable-email-input" value={enableEmail}
                  onChange={(e) => setEnableEmail(e.target.value)} placeholder="you@example.org" />
                <p className="text-xs text-muted-foreground">Emailed to you for one-time sign-in codes if the app is lost.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setEnableOpen(false)}>Cancel</Button>
                <Button className="gap-2 bg-ocean hover:bg-ocean-dark" disabled={busy || enableCode.length < 6} data-testid="confirm-enable-2fa-btn" onClick={confirmEnable}>
                  {busy ? "Enabling…" : "Enable 2FA"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Starting setup…</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Disable dialog */}
      <Dialog open={disableOpen} onOpenChange={(o) => { if (!o) setDisableOpen(false); }}>
        <DialogContent data-testid="disable-2fa-dialog">
          <DialogHeader><DialogTitle className="font-heading uppercase">Disable two-factor authentication</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-destructive font-semibold">
              Disabling 2FA means sign-in is protected by the passcode alone. This requires your passcode AND a live code.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="disable-passcode">Current passcode</Label>
              <Input id="disable-passcode" type="password" data-testid="disable-passcode-input" value={disablePasscode}
                onChange={(e) => setDisablePasscode(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disable-code">{disableMethod === "email" ? "Emailed code" : "Authenticator app code"}</Label>
              <InputOTP id="disable-code" maxLength={6} value={disableCode} onChange={setDisableCode} data-testid="disable-otp-input">
                <InputOTPGroup>
                  {Array.from({ length: 6 }).map((_, i) => <InputOTPSlot key={i} index={i} />)}
                </InputOTPGroup>
              </InputOTP>
            </div>
            {disableMethod === "totp" ? (
              <button type="button" onClick={sendDisableEmail} disabled={busy} data-testid="disable-email-link" className="text-sm text-ocean hover:underline font-semibold flex items-center gap-1.5">
                <Mail className="w-4 h-4" /> Email me a code instead
              </button>
            ) : (
              <button type="button" onClick={() => { setDisableMethod("totp"); setDisableCode(""); }} data-testid="disable-app-link" className="text-sm text-ocean hover:underline font-semibold flex items-center gap-1.5">
                <Smartphone className="w-4 h-4" /> Use my authenticator app instead
              </button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDisableOpen(false)}>Cancel</Button>
            <Button className="gap-2 bg-destructive hover:bg-destructive/90 text-white" disabled={busy || disableCode.length < 6 || !disablePasscode} data-testid="confirm-disable-2fa-btn" onClick={confirmDisable}>
              {busy ? "Disabling…" : "Disable 2FA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fallback email dialog */}
      <Dialog open={emailOpen} onOpenChange={(o) => { if (!o) setEmailOpen(false); }}>
        <DialogContent data-testid="fallback-email-dialog">
          <DialogHeader><DialogTitle className="font-heading uppercase">Recovery email</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Emailed one-time codes are your recovery path if the authenticator app is lost. Confirm your passcode to change it.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="fb-email">Email address</Label>
              <Input id="fb-email" type="email" data-testid="fallback-email-input" value={emailValue} onChange={(e) => setEmailValue(e.target.value)} placeholder="you@example.org" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-passcode">Current passcode</Label>
              <Input id="fb-passcode" type="password" data-testid="fallback-passcode-input" value={emailPasscode} onChange={(e) => setEmailPasscode(e.target.value)} autoComplete="current-password" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setEmailOpen(false)}>Cancel</Button>
            <Button className="gap-2 bg-ocean hover:bg-ocean-dark" disabled={busy || !emailPasscode} data-testid="save-fallback-email-btn" onClick={saveEmail}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
