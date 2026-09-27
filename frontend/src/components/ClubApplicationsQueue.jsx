import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Clock3, Eye, Mail, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const statusLabel = (status) => ({
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  verification_pending: "Awaiting email verification",
  expired: "Verification expired",
  creating: "Creating workspace",
}[status] || status || "Unknown");

const submittedAt = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-GB");
};

export default function ClubApplicationsQueue({ onOpenEmailSettings }) {
  const [items, setItems] = useState(null);
  const [notificationConfigured, setNotificationConfigured] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await api.getClubApplicationsManage();
      setItems(result.items || []);
      setNotificationConfigured(!!result.notification_configured);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not load club applications.");
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const review = async (application, status) => {
    setBusy(application.id);
    try {
      await api.reviewClubApplication(application.id, status);
      toast.success(status === "approved" ? "Club application approved" : "Club application rejected");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not update club application");
    } finally {
      setBusy(null);
    }
  };

  const retryNotification = async (application) => {
    setBusy(`notify:${application.id}`);
    try {
      await api.retryClubApplicationNotification(application.id);
      toast.success("Webmaster notification sent");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not send Webmaster notification");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section data-testid="club-applications-queue">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-3xl uppercase tracking-tighter">Club applications</h1>
          <p className="text-sm text-muted-foreground">Review verified club registrations. Rejected workspaces remain private and can be approved later.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={load} data-testid="applications-refresh">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {!notificationConfigured && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4" role="alert" data-testid="applications-email-warning">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>Application notifications need working email settings and a Webmaster contact email. The queue remains available here.</span>
          </div>
          {onOpenEmailSettings && <Button variant="outline" size="sm" onClick={onOpenEmailSettings}>Email settings</Button>}
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600" role="alert">{error}</p>}
      {items === null ? (
        <p className="text-sm text-muted-foreground">Loading club applications…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground" data-testid="applications-empty">
          <Mail className="mx-auto mb-2 h-8 w-8 opacity-60" />
          <p>No club applications yet.</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="applications-list">
          {items.map((application) => {
            const canReview = Boolean(application.club_id)
              && ["pending", "rejected", "approved"].includes(application.status);
            const canApprove = canReview && application.status !== "approved";
            const canReject = canReview && application.status !== "rejected";
            const notifyBusy = busy === `notify:${application.id}`;
            const reviewBusy = busy === application.id;
            return (
              <article key={application.id} className="rounded-2xl border border-border bg-card p-5" data-testid={`application-${application.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-heading text-xl uppercase tracking-tight">{application.club_name}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${application.status === "approved" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : application.status === "rejected" ? "bg-red-500/10 text-red-700 dark:text-red-300" : application.status === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                        {statusLabel(application.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm"><span className="font-medium">{application.applicant_name}</span> <span className="text-muted-foreground">·</span> <a className="text-ocean hover:underline" href={`mailto:${application.email}`}>{application.email}</a></p>
                    <p className="mt-1 text-xs text-muted-foreground">Submitted {submittedAt(application.submitted_at)}{application.reviewed_at ? ` · Reviewed ${submittedAt(application.reviewed_at)}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {application.club_slug && application.club_id && (
                      <Button asChild variant="outline" size="sm" className="gap-1.5" data-testid={`application-preview-${application.id}`}>
                        <Link to={`/club/${encodeURIComponent(application.club_slug)}`}><Eye className="h-4 w-4" /> Preview</Link>
                      </Button>
                    )}
                    {canApprove && <Button size="sm" disabled={busy !== null} className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => review(application, "approved")} data-testid={`application-approve-${application.id}`}><Check className="h-4 w-4" /> {application.status === "rejected" ? "Approve again" : "Approve"}</Button>}
                    {canReject && <Button size="sm" variant="outline" disabled={busy !== null} className="gap-1.5 text-destructive" onClick={() => review(application, "rejected")} data-testid={`application-reject-${application.id}`}><X className="h-4 w-4" /> Reject</Button>}
                    {application.club_id && application.status === "pending" && application.webmaster_notification_sent !== true && (
                      <Button size="sm" variant="outline" disabled={busy !== null} className="gap-1.5" onClick={() => retryNotification(application)} data-testid={`application-notify-${application.id}`}>
                        <Mail className="h-4 w-4" /> {notifyBusy ? "Sending…" : "Retry notification"}
                      </Button>
                    )}
                  </div>
                </div>
                {application.status === "rejected" && <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground"><Clock3 className="mr-1 inline h-4 w-4" /> The owner can still sign in and manage this private workspace. Approve again whenever the application is ready.</p>}
                {application.status === "approved" && <p className="mt-4 border-t border-border pt-3 text-sm text-emerald-700 dark:text-emerald-300">This club is publicly visible. You can reject it here if its approval needs to be withdrawn.</p>}
                {!application.club_id && <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">No account or club workspace has been created until the applicant verifies their email.</p>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
