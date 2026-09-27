import { useEffect, useState } from "react";
import { Clock3, Eye, ShieldCheck, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function ClubApplicationStatus() {
  const { clubApplication: sessionApplication } = useAuth();
  const [clubApplication, setClubApplication] = useState(sessionApplication);

  useEffect(() => {
    setClubApplication(sessionApplication);
  }, [sessionApplication]);

  useEffect(() => {
    if (!sessionApplication?.id) return undefined;
    let active = true;
    const refresh = () => api.getMyClubApplication()
      .then((result) => { if (active) setClubApplication(result.application || null); })
      .catch(() => {});
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [sessionApplication?.id]);

  if (!clubApplication?.club_slug) return null;

  const approved = clubApplication.status === "approved";
  const rejected = clubApplication.status === "rejected";
  const title = approved
    ? "Your club is approved"
    : rejected
      ? "Your application was rejected"
      : "Your application is awaiting review";
  const description = approved
    ? "Your club page is now public. You can continue managing your club workspace here."
    : rejected
      ? "Your account and workspace are still available and private. A Webmaster can approve the application later."
      : "Your private workspace is ready. It will stay hidden from public search and directories until a Webmaster approves the application.";
  const Icon = approved ? ShieldCheck : rejected ? XCircle : Clock3;

  return (
    <section
      className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4"
      data-testid="club-application-status"
      aria-label="Club application status"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${approved ? "text-emerald-600" : rejected ? "text-amber-600" : "text-ocean"}`} />
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0 gap-2">
        <Link to={`/club/${encodeURIComponent(clubApplication.club_slug)}`} data-testid="club-application-preview">
          <Eye className="h-4 w-4" /> {approved ? "View public page" : "Preview private page"}
        </Link>
      </Button>
    </section>
  );
}
