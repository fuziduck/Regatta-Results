import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, formatApiError } from "@/lib/api";
import { passcodeError, PASSCODE_HINT } from "@/lib/helpers";
import { useAuth } from "@/context/AuthContext";

export default function ClubRegistration() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { updateSession } = useAuth();
  const token = searchParams.get("token") || "";
  const [form, setForm] = useState({ club_name: "", applicant_name: "", email: "" });
  const [verifyInfo, setVerifyInfo] = useState(null);
  const [sent, setSent] = useState(false);
  const [devVerificationUrl, setDevVerificationUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api.inspectClubApplication(token).then((result) => {
      if (active) setVerifyInfo(result);
    }).catch((err) => {
      if (!active) return;
      setExpired(err.response?.status === 410);
      toast.error(formatApiError(err.response?.data?.detail) || "This verification link is not valid");
    });
    return () => { active = false; };
  }, [token]);

  const submitApplication = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await api.applyForClub({
        club_name: form.club_name.trim(),
        applicant_name: form.applicant_name.trim(),
        email: form.email.trim().toLowerCase(),
      });
      setDevVerificationUrl(result.dev_verification_token
        ? `/club-registration?token=${encodeURIComponent(result.dev_verification_token)}`
        : "");
      setSent(true);
      toast.success("Check your email for the verification link");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Could not submit registration");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setLoading(true);
    try {
      const result = await api.resendClubVerification({
        club_name: form.club_name.trim(),
        email: form.email.trim().toLowerCase(),
      });
      setDevVerificationUrl(result.dev_verification_token
        ? `/club-registration?token=${encodeURIComponent(result.dev_verification_token)}`
        : "");
      toast.success(result.dev_verification_token
        ? "Use the local verification link to continue"
        : "If a matching request is awaiting verification, a new email has been sent");
      setExpired(false);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Could not resend verification email");
    } finally {
      setLoading(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    const error = passcodeError(passcode);
    if (error) return toast.error(error);
    if (passcode !== confirmPasscode) return toast.error("Passcodes do not match");
    setLoading(true);
    try {
      const session = await api.verifyClubApplication(token, passcode);
      updateSession(session);
      toast.success("Email verified — your private club workspace is ready");
      navigate("/admin", { replace: true });
    } catch (err) {
      setExpired(err.response?.status === 410 || err.response?.status === 404);
      toast.error(formatApiError(err.response?.data?.detail) || "Could not verify your email");
    } finally {
      setLoading(false);
    }
  };

  const verifying = !!token;
  const backLink = <Link to="/login" className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-6 text-sm font-semibold"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>;

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-ocean-dark">
      <div className="absolute inset-0 hero-overlay" />
      <div className="absolute top-4 right-4 z-10"><ThemeToggle light /></div>
      <div className="relative w-full max-w-lg">
        {backLink}
        <div className="bg-card rounded-2xl shadow-2xl p-7 sm:p-8 border border-white/10">
          <div className="mb-3"><Logo className="h-14 w-auto" /></div>
          <h1 className="text-2xl uppercase tracking-tight text-foreground">
            {verifying ? "Verify your email" : sent ? "Check your email" : "Register a new club"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {verifying
              ? "Confirm your email and choose a secure passcode to open your private workspace."
              : sent
                ? "We sent a single-use verification link. Your club and owner account are created only after you verify."
                : "Tell us about your club. We'll email a verification link before creating any account or club data."}
          </p>

          {verifying && verifyInfo && !expired && (
            <form onSubmit={verify} className="mt-6 space-y-4" data-testid="registration-verify-form">
              <div className="rounded-lg border border-ocean/20 bg-ocean/5 p-3 text-sm">
                <div className="font-semibold">{verifyInfo.club_name}</div>
                <div className="text-muted-foreground">{verifyInfo.email}</div>
              </div>
              <div className="space-y-2"><Label htmlFor="registration-passcode">Choose a passcode</Label>
                <Input id="registration-passcode" type="password" autoComplete="new-password" value={passcode} onChange={(event) => setPasscode(event.target.value)} data-testid="registration-passcode" />
                <p className="text-xs text-muted-foreground">{PASSCODE_HINT}</p>
              </div>
              <div className="space-y-2"><Label htmlFor="registration-confirm-passcode">Confirm passcode</Label>
                <Input id="registration-confirm-passcode" type="password" autoComplete="new-password" value={confirmPasscode} onChange={(event) => setConfirmPasscode(event.target.value)} data-testid="registration-confirm-passcode" />
              </div>
              <Button type="submit" disabled={loading || !passcode || !confirmPasscode} className="w-full h-12 bg-ocean hover:bg-ocean-dark" data-testid="registration-verify-submit">
                {loading ? "Verifying…" : "Verify email & create workspace"}
              </Button>
            </form>
          )}

          {verifying && (!verifyInfo || expired) && (
            <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <p className="text-foreground">This link is expired, invalid, or has already been used.</p>
              <p className="mt-1 text-muted-foreground">Request a fresh link using the club name and email from your application.</p>
              <form onSubmit={(event) => { event.preventDefault(); resend(); }} className="mt-4 space-y-3">
                <div className="space-y-1.5"><Label htmlFor="resend-club-name">Club name</Label><Input id="resend-club-name" required value={form.club_name} onChange={(event) => setForm({ ...form, club_name: event.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="resend-email">Email</Label><Input id="resend-email" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
                <Button type="submit" variant="outline" disabled={loading || !form.club_name || !form.email} data-testid="registration-resend">{loading ? "Sending…" : "Resend verification"}</Button>
              </form>
            </div>
          )}

          {!verifying && sent && (
            <div className="mt-6 rounded-lg border border-ocean/20 bg-ocean/5 p-4 text-sm" data-testid="registration-sent-state">
              <div className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-ocean" /> Verification email sent</div>
              {devVerificationUrl
                ? <p className="mt-2 text-muted-foreground">Email is not configured in this development environment. Continue with the local verification link below.</p>
                : <p className="mt-2 text-muted-foreground">Open the single-use link in your email to verify your address. If it expires, you can request a fresh link below.</p>}
              {devVerificationUrl && <Link to={devVerificationUrl} data-testid="registration-dev-verification-link" className="mt-3 inline-flex font-semibold text-ocean hover:underline">Open local verification link</Link>}
              <form onSubmit={(event) => { event.preventDefault(); resend(); }} className="mt-4 space-y-3">
                <p className="text-xs text-muted-foreground">Didn't receive it? You can request a fresh link.</p>
                <Button type="submit" variant="outline" disabled={loading} data-testid="registration-resend">{loading ? "Sending…" : "Resend verification"}</Button>
              </form>
            </div>
          )}

          {!verifying && !sent && (
            <form onSubmit={submitApplication} className="mt-6 space-y-4" data-testid="registration-form">
              <div className="space-y-2"><Label htmlFor="registration-club-name">Club name</Label><Input id="registration-club-name" required minLength={2} maxLength={120} value={form.club_name} onChange={(event) => setForm({ ...form, club_name: event.target.value })} placeholder="e.g. Harbour Sailing Club" data-testid="registration-club-name" /></div>
              <div className="space-y-2"><Label htmlFor="registration-applicant-name">Your name</Label><Input id="registration-applicant-name" required minLength={2} maxLength={120} autoComplete="name" value={form.applicant_name} onChange={(event) => setForm({ ...form, applicant_name: event.target.value })} data-testid="registration-applicant-name" /></div>
              <div className="space-y-2"><Label htmlFor="registration-email">Email address</Label><Input id="registration-email" required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@club.org" data-testid="registration-email" /></div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground"><ShieldCheck className="mr-1 inline h-4 w-4 text-ocean" /> Your workspace stays private until a Webmaster approves the verified application.</div>
              <Button type="submit" disabled={loading} className="w-full h-12 bg-ocean hover:bg-ocean-dark" data-testid="registration-submit">{loading ? "Sending…" : "Email me a verification link"}</Button>
            </form>
          )}
        </div>
        <p className="mt-5 text-center text-sm text-white/80">SailScore — Connecting sailing, one club at a time.</p>
      </div>
    </div>
  );
}
