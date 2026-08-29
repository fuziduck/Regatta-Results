import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import ThemeToggle from "@/components/ThemeToggle";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck, ArrowLeft, Globe, ChevronDown, Mail, Smartphone } from "lucide-react";
import Logo from "@/components/Logo";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export default function Login() {
  const { login, login2fa } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [clubs, setClubs] = useState([]);
  const [clubId, setClubId] = useState("");
  const [username, setUsername] = useState("");
  const [passcode, setPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [clubOpen, setClubOpen] = useState(false);
  // Two-step webmaster login: after the passcode verifies, the server asks for
  // a second factor (authenticator app code, or an emailed code as fallback).
  const [otpStep, setOtpStep] = useState(false);
  const [otpMethod, setOtpMethod] = useState("totp"); // "totp" | "email"
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  useEffect(() => {
    api.getClubs().then((cs) => {
      setClubs(cs || []);
      const fromUrl = (cs || []).find((c) => c.slug === searchParams.get("club"));
      setClubId((fromUrl || (cs || [])[0])?.id || "");
    }).catch(() => {});
  }, [searchParams]);

  // Arrived because a session expired mid-use (the api client redirects any
  // 401 here): explain why they're back on the sign-in page.
  useEffect(() => {
    if (searchParams.get("reason") === "session") {
      toast.info("Your session expired — please sign in again to continue.", { id: "session-expired" });
      const url = new URL(window.location.href);
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url);
    }
  }, [searchParams]);

  // Close the club dropdown on outside click / Escape
  useEffect(() => {
    if (!clubOpen) return;
    const onDown = (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest("[data-testid=club-select]") || e.target.closest("[data-testid=club-option]")) return;
      setClubOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [clubOpen]);

  const onClubKeyDown = (e) => {
    if (e.key === "Escape") {
      setClubOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!clubOpen) {
        setClubOpen(true);
        return;
      }
      const opts = [...document.querySelectorAll('[data-testid="club-option"]')];
      const idx = opts.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? Math.min(idx + 1, opts.length - 1) : Math.max(idx - 1, 0);
      opts[next]?.focus();
    }
  };

  const selectedClub = clubs.find((c) => c.id === clubId);

  // One form for everyone: typing the webmaster username switches the club
  // picker off and routes the sign-in to the webmaster account. `role` sent to
  // the server is only a routing hint — the account's own role is authoritative.
  const isWebmaster = username.trim().toLowerCase() === "webmaster" || username.trim().toLowerCase() === "webmaster@sailscore.co.uk";
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await login(isWebmaster ? "webmaster" : "officer", username.trim(), passcode, isWebmaster ? null : clubId);
      // 2FA enrolled on the webmaster: the passcode verified but there is no
      // session yet — move to the second-factor step.
      if (r.requires_2fa) {
        setOtpStep(true);
        setOtpCode("");
        setOtpMethod("totp");
        setOtpSent(false);
        return;
      }
      if (r.role === "webmaster") {
        toast.success("Signed in as Webmaster");
        navigate("/webmaster");
      } else {
        toast.success(`Signed in to ${r.club_name} as ${r.role === "admin" ? "Race Admin" : "Race Officer"}`);
        navigate(r.role === "admin" ? "/admin" : "/officer");
      }
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    if (otpCode.length < 6) return;
    setLoading(true);
    try {
      const r = await login2fa(otpMethod, otpCode.trim());
      if (r.role === "webmaster") {
        toast.success("Signed in as Webmaster");
        navigate("/webmaster");
      } else {
        toast.success(`Signed in to ${r.club_name} as ${r.role === "admin" ? "Race Admin" : "Race Officer"}`);
        navigate(r.role === "admin" ? "/admin" : "/officer");
      }
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Invalid verification code");
      setOtpCode("");
    } finally {
      setLoading(false);
    }
  };

  const sendEmailCode = async () => {
    setLoading(true);
    try {
      const r = await api.sendEmailCode();
      setOtpMethod("email");
      setOtpSent(true);
      setOtpCode("");
      if (r.dev_code) toast.info(`Dev code: ${r.dev_code}`);
      else toast.success("A sign-in code has been emailed to you");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Could not send the code — use your authenticator app instead");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-ocean-dark">
      <img
        src="https://images.unsplash.com/photo-1512602110-67198e50f815?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTV8MHwxfHNlYXJjaHwyfHx5YWNodCUyMGNsdWIlMjBtYXJpbmF8ZW58MHx8fHwxNzg2MTI3MTgxfDA&ixlib=rb-4.1.0&q=85"
        alt="marina"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 hero-overlay" />
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle light />
      </div>
      <div className="relative w-full max-w-md">
        <Link to="/" data-testid="back-to-results-link" className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-6 text-sm font-semibold transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to results
        </Link>
        <div className="bg-card rounded-2xl shadow-2xl p-8 border border-white/10">
          <div className="mb-1">
            <Logo className="h-14 w-auto" />
          </div>
          <div className="mb-1">
            <h1 className="text-2xl uppercase tracking-tight leading-none text-foreground">Club Login</h1>
            <p className="text-sm text-muted-foreground">{isWebmaster ? "Webmaster access" : (selectedClub ? selectedClub.name : "Officials access")}</p>
          </div>

          {!isWebmaster ? (
            <div className="mt-6 space-y-2">
              <Label htmlFor="club">Club</Label>
              <div className="relative">
                <button
                  type="button"
                  id="club"
                  data-testid="club-select"
                  aria-haspopup="listbox"
                  aria-expanded={clubOpen}
                  onClick={() => setClubOpen((o) => !o)}
                  onKeyDown={onClubKeyDown}
                  className="w-full h-12 pl-3 pr-3 rounded-lg border border-input bg-background text-base flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span className={selectedClub ? "font-semibold text-foreground" : "text-muted-foreground"}>
                    {selectedClub ? selectedClub.name : (clubs.length ? "Select a club" : "No clubs available")}
                  </span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
                {clubOpen && (
                  <ul
                    role="listbox"
                    aria-label="Clubs"
                    className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-background shadow-xl"
                  >
                    {clubs.map((c) => (
                      <li key={c.id} role="option" aria-selected={c.id === clubId}>
                        <button
                          type="button"
                          data-testid="club-option"
                          onClick={() => { setClubId(c.id); setClubOpen(false); }}
                          className={`w-full text-left px-4 py-3 text-sm sm:text-base transition-colors hover:bg-muted/70 ${c.id === clubId ? "font-semibold text-ocean" : "text-foreground"}`}
                        >
                          {c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <Globe className="w-4 h-4 inline-block mr-1.5 text-ocean" />
              Webmaster access covers <strong>all clubs</strong> — no club needed here.
            </div>
          )}

          {otpStep ? (
            <form onSubmit={submitOtp} className="mt-4 space-y-4">
              <div className="rounded-lg border border-ocean/30 bg-ocean/5 px-4 py-3 text-sm text-foreground">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-ocean" />
                  {otpMethod === "email" ? "Enter the emailed code" : "Enter your authenticator app code"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {otpMethod === "email"
                    ? (otpSent ? "A 6-digit sign-in code was sent to your fallback email." : "Sending a code to your fallback email…")
                    : "Open your authenticator app and enter the 6-digit code for SailScore."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="otp">Verification code</Label>
                <InputOTP
                  id="otp"
                  maxLength={6}
                  value={otpCode}
                  onChange={(v) => setOtpCode(v)}
                  data-testid="otp-input"
                  autoFocus
                >
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button type="submit" data-testid="login2fa-submit-btn" disabled={loading || otpCode.length < 6} className="w-full h-12 text-base bg-ocean hover:bg-ocean-dark transition-transform active:scale-[0.98]">
                {loading ? "Verifying…" : "Verify & sign in"}
              </Button>
              {otpMethod === "totp" ? (
                <button type="button" onClick={sendEmailCode} disabled={loading} data-testid="email-code-link" className="w-full text-sm text-ocean hover:underline font-semibold flex items-center justify-center gap-1.5">
                  <Mail className="w-4 h-4" /> Email me a code instead
                </button>
              ) : (
                <button type="button" onClick={() => { setOtpMethod("totp"); setOtpCode(""); }} data-testid="use-app-link" className="w-full text-sm text-ocean hover:underline font-semibold flex items-center justify-center gap-1.5">
                  <Smartphone className="w-4 h-4" /> Use my authenticator app instead
                </button>
              )}
              <div className="text-center">
                <button type="button" onClick={() => { setOtpStep(false); setOtpCode(""); }} data-testid="otp-back-btn" className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline font-semibold">
                  Back to passcode
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{isWebmaster ? "Username" : "Email address"}</Label>
              <Input
                id="username"
                type={isWebmaster ? "text" : "email"}
                data-testid="username-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={isWebmaster ? "webmaster" : "you@club.org"}
                autoComplete="username"
                autoFocus
                className="h-12 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passcode">Passcode</Label>
              <Input
                id="passcode"
                type="password"
                data-testid="pin-input"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder={isWebmaster ? "Enter the webmaster passcode" : "Enter your passcode"}
                autoComplete="current-password"
                className="h-12 text-lg tabular"
              />
            </div>
            <Button type="submit" data-testid="login-submit-btn" disabled={loading || !passcode} className="w-full h-12 text-base bg-ocean hover:bg-ocean-dark transition-transform active:scale-[0.98]">
              {loading ? "Signing in…" : "Sign In"}
            </Button>
            <div className="text-center">
              <Link to="/forgot-password" data-testid="forgot-passcode-link" className="text-sm text-ocean hover:underline font-semibold">
                Forgot your passcode?
              </Link>
            </div>
          </form>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-white/80">SailScore — Connecting sailing, one club at a time.</p>
      </div>
    </div>
  );
}
