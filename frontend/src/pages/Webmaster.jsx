import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import ClubBadge from "@/components/ClubBadge";
import ConsoleNav from "@/components/ConsoleNav";
import UsersManager from "@/components/UsersManager";
import AdvertsManager from "@/components/AdvertsManager";
import EmailSettingsManager from "@/components/EmailSettingsManager";
import SubscriptionOverview from "@/components/SubscriptionOverview";
import AuditLog from "@/components/AuditLog";
import TwoFactorAuth from "@/components/TwoFactorAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Globe, Plus, Pencil, Trash2, Radio, ShieldCheck, Building2, KeyRound, Megaphone, Mail, ScrollText, Archive, Download, Upload, Lock, Eye, EyeOff, Copy } from "lucide-react";

const blank = { name: "", color: "#0A369D" };

function ClubCard({ club, onEdit, onDelete, onConsole, onLogins }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 hover:shadow-lg hover:border-ocean/40 transition-all">
      <div className="flex items-start justify-between gap-2">
        <ClubBadge club={club} />
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" title="Manage logins" data-testid={`logins-club-${club.slug}`} onClick={() => onLogins(club)}><KeyRound className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" data-testid={`edit-club-${club.slug}`} onClick={() => onEdit(club)}><Pencil className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-club-${club.slug}`} onClick={() => onDelete(club)}><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>
      <div className="mt-3">
        <div className="font-heading text-2xl uppercase tracking-tight leading-tight break-words">{club.name}</div>
        <div className="text-xs text-muted-foreground mt-1 font-mono break-all">/{club.slug}</div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="outline" className="w-full gap-2 whitespace-normal leading-tight text-center border-ocean text-ocean hover:bg-ocean hover:text-white" data-testid={`open-officer-${club.slug}`} onClick={() => onConsole(club, "officer")}>
          <Radio className="w-4 h-4" /> Officer console
        </Button>
        <Button variant="outline" className="w-full gap-2 whitespace-normal leading-tight text-center border-ocean text-ocean hover:bg-ocean hover:text-white" data-testid={`open-admin-${club.slug}`} onClick={() => onConsole(club, "admin")}>
          <ShieldCheck className="w-4 h-4" /> Admin console
        </Button>
      </div>
    </div>
  );
}

function BackupSection({ clubs }) {
  const [clubId, setClubId] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreScope, setRestoreScope] = useState(null); // "all" or "club"
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [dlPassphrase, setDlPassphrase] = useState("");
  const [dlConfirm, setDlConfirm] = useState("");
  const [showDl, setShowDl] = useState(false);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [showRestore, setShowRestore] = useState(false);
  const fileInputAllRef = useRef(null);
  const fileInputClubRef = useRef(null);

  // A passphrase created here encrypts the backup(s) downloaded with it and is
  // never stored server-side — the same value is re-entered on restore. Empty
  // passphrase = plaintext backup (credentials stripped).
  const generatePassphrase = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = new Uint8Array(18);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    const phrase = Array.from(bytes, (b) => chars[b % chars.length]).join("");
    setDlPassphrase(phrase);
    setDlConfirm(phrase);
    setShowDl(true); // reveal it so it can be copied safely
    toast.info("Passphrase generated — copy it somewhere safe; you'll need it to restore this backup");
  };

  const copyPassphrase = async () => {
    const p = downloadPhrase();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      toast.success("Passphrase copied to clipboard — store it securely");
    } catch {
      toast.error("Could not copy automatically — select and copy it manually");
    }
  };

  const downloadPhrase = () => dlPassphrase.trim();
  const validateDlPhrase = () => {
    const p = downloadPhrase();
    if (!p) return p;
    if (p.length < 8) {
      toast.error("Backup passphrase must be at least 8 characters");
      return null;
    }
    if (p !== dlConfirm.trim()) {
      toast.error("Backup passphrases do not match");
      return null;
    }
    return p;
  };

  const doDownload = async (club_id) => {
    const p = validateDlPhrase();
    if (p === null) return;
    try {
      await api.downloadBackup(club_id, true, p);
      toast.success(p ? "Encrypted backup downloaded" : "Backup downloaded");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backup download failed");
    }
  };

  const handleFileSelected = (e, scope) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".zip")) {
      toast.error("Backup file must be a .zip archive");
      e.target.value = "";
      return;
    }
    setRestoreFile(file);
    setRestoreScope(scope);
    setRestorePassphrase(dlPassphrase.trim());
    setRestoreConfirmOpen(true);
    e.target.value = "";
  };

  const doRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    try {
      const result = await api.restoreBackup(restoreFile, restorePassphrase.trim());
      const count = result.restored?.length || 0;
      const errMsgs = result.errors?.length ? ` (${result.errors.length} skipped)` : "";
      toast.success(`Backup restored successfully — ${count} collection${count === 1 ? "" : "s"} updated${errMsgs}`);
      setRestoreConfirmOpen(false);
      setRestoreFile(null);
      setRestoreScope(null);
      setRestorePassphrase("");
    } catch (err) {
      // Keep the dialog open so the passphrase can be corrected and retried.
      // Surface the real reason (backend detail, or a true network/proxy
      // error) rather than a generic "check the file" message.
      const detail = err.response?.data?.detail || err.message || "";
      toast.error(detail ? `Restore failed: ${detail}` : "Restore failed — please check the backup file");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl uppercase tracking-tighter mb-1">Backups</h1>
        <p className="text-muted-foreground text-sm">
          Download or restore a zip of JSON exports. Encrypt a backup by entering a passphrase below — encrypted backups are AES-encrypted and carry users' passcode hashes, so a restore brings everyone's sign-in passcodes across with no manual resets. Keep that passphrase safe; you'll re-enter it to restore. Leave the passphrase empty for a plaintext backup (credentials stripped). Reset tokens and lockout state are never exported.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4 max-w-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-heading text-lg uppercase tracking-tight">Full system backup</div>
            <p className="text-xs text-muted-foreground mt-0.5">Every club — clubs, users, classes, boats, series, races, results, adverts and the audit log.</p>
          </div>
          <div className="flex gap-2">
            <Button
              className="gap-2 bg-ocean hover:bg-ocean-dark"
              data-testid="backup-all-btn"
              onClick={() => doDownload(null)}
            >
              <Download className="w-4 h-4" /> Download all
            </Button>
            <input
              ref={fileInputAllRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => handleFileSelected(e, "all")}
            />
            <Button
              variant="outline"
              className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white"
              data-testid="restore-all-btn"
              onClick={() => fileInputAllRef.current?.click()}
            >
              <Upload className="w-4 h-4" /> Restore all
            </Button>
          </div>
        </div>          <div className="rounded-xl border border-dashed border-border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Encrypt this backup (optional)</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" data-testid="backup-reveal-passphrase" onClick={() => setShowDl((s) => !s)}>
                  {showDl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {showDl ? "Hide" : "Show"}
                </Button>
                <Button variant="outline" size="sm" data-testid="backup-copy-passphrase" onClick={copyPassphrase} disabled={!dlPassphrase.trim()}>
                  <Copy className="w-4 h-4" /> Copy
                </Button>
                <Button variant="outline" size="sm" data-testid="backup-gen-passphrase" onClick={generatePassphrase}>
                  <Lock className="w-4 h-4" /> Generate
                </Button>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Passphrase</Label>
                <Input
                  type={showDl ? "text" : "password"}
                  autoComplete="new-password"
                  value={dlPassphrase}
                  onChange={(e) => setDlPassphrase(e.target.value)}
                  placeholder="Leave empty for a plaintext backup"
                  data-testid="backup-passphrase-input"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Confirm passphrase</Label>
                <Input
                  type={showDl ? "text" : "password"}
                  autoComplete="new-password"
                  value={dlConfirm}
                  onChange={(e) => setDlConfirm(e.target.value)}
                  placeholder="Re-enter the passphrase"
                  data-testid="backup-passphrase-confirm"
                  className="font-mono"
                />
              </div>
            </div>
          </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5 flex-1 min-w-52">
            <Label>Club</Label>
            <select
              value={clubId}
              onChange={(e) => setClubId(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-input bg-background text-sm"
              data-testid="backup-club-select"
            >
              <option value="">Choose a club…</option>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white"
              disabled={!clubId}
              data-testid="backup-club-btn"
              onClick={() => doDownload(clubId)}
            >
              <Download className="w-4 h-4" /> Download club backup
            </Button>
            <input
              ref={fileInputClubRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => handleFileSelected(e, "club")}
            />
            <Button
              variant="outline"
              className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white"
              disabled={!clubId}
              data-testid="restore-club-btn"
              onClick={() => fileInputClubRef.current?.click()}
            >
              <Upload className="w-4 h-4" /> Restore club
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={restoreConfirmOpen} onOpenChange={(o) => { if (!o && !restoring) { setRestoreConfirmOpen(false); setRestoreFile(null); setRestoreScope(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading uppercase">
              {restoreScope === "all" ? "Restore full system backup" : "Restore club backup"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You are about to restore from <span className="font-semibold text-foreground">{restoreFile?.name || "backup"}</span>.
            </p>
            {restoreScope === "all" ? (
              <p className="text-sm text-destructive font-semibold">
                This will replace ALL clubs, users, classes, boats, series, races, adverts and audit logs with the contents of the backup. This cannot be undone.
              </p>
            ) : (
              <p className="text-sm text-destructive font-semibold">
                This will replace data for the selected club only. Other clubs, global adverts and the webmaster account are not affected.
              </p>
            )}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <Label>Backup passphrase (if the backup was encrypted)</Label>
                <button
                  type="button"
                  onClick={() => setShowRestore((s) => !s)}
                  className="text-xs text-ocean hover:underline font-semibold inline-flex items-center gap-1"
                  data-testid="restore-reveal-passphrase"
                >
                  {showRestore ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {showRestore ? "Hide" : "Show"}
                </button>
              </div>
              <Input
                type={showRestore ? "text" : "password"}
                autoComplete="off"
                value={restorePassphrase}
                onChange={(e) => setRestorePassphrase(e.target.value)}
                placeholder="Enter the passphrase used when this backup was created"
                data-testid="restore-passphrase-input"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Encrypted backups restore each user's passcode hash, so existing sign-in passcodes keep working (plaintext backups strip them). Reset tokens and lockout state are never imported.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={restoring}
              onClick={() => { setRestoreConfirmOpen(false); setRestoreFile(null); setRestoreScope(null); }}
            >
              Cancel
            </Button>
            <Button
              className="gap-2 bg-destructive hover:bg-destructive/90 text-white"
              disabled={restoring}
              data-testid="restore-confirm-btn"
              onClick={doRestore}
            >
              {restoring ? "Restoring…" : "Restore backup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Webmaster() {
  const { updateSession } = useAuth();
  const navigate = useNavigate();
  const [clubs, setClubs] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [usersClub, setUsersClub] = useState(null);
  const [section, setSection] = useState("clubs");

  const load = useCallback(() => api.getClubsManage().then(setClubs).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name) return toast.error("Club name required");
    if (editing) await api.updateClub(editing, form); else await api.createClub(form);
    toast.success(editing ? "Club updated" : "Club added");
    setOpen(false); setEditing(null); setForm(blank); load();
  };
  const edit = (c) => {
    setEditing(c.id);
    setForm({ name: c.name, color: c.color || "#0A369D" });
    setOpen(true);
  };
  const del = async (c) => {
    if (!window.confirm(`Delete ${c.name}? Its classes must be deleted first.`)) return;
    try {
      await api.deleteClub(c.id);
      toast.success("Club deleted"); load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not delete club");
    }
  };
  const openConsole = (club, kind) => navigate(`/${kind === "officer" ? "officer" : "admin"}?club=${club.id}`);
  const openLogins = (club) => setUsersClub(club);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-ocean-dark/95 text-white">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-white/15 grid place-items-center"><Globe className="w-5 h-5" /></div>
            <div className="font-heading text-xl uppercase tracking-tight leading-none">Webmaster</div>
          </div>
          <ConsoleNav
            meta={`${clubs.length} club${clubs.length === 1 ? "" : "s"}`}
            menuLabel={`Webmaster · ${clubs.length} club${clubs.length === 1 ? "" : "s"}`}
            onChangedPasscode={updateSession}
            logoutTestId="webmaster-logout-btn"
            items={[]}
          />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row gap-8">
        <aside className="md:w-56 shrink-0">
          <nav className="flex md:flex-col gap-1 md:sticky md:top-24 overflow-x-auto" data-testid="webmaster-nav">
            <button
              data-testid="nav-clubs"
              onClick={() => setSection("clubs")}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap transition-colors ${
                section === "clubs" ? "bg-ocean text-white" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Building2 className="w-4 h-4" /> Club management
            </button>
            <button
              data-testid="nav-adverts"
              onClick={() => setSection("adverts")}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap transition-colors ${
                section === "adverts" ? "bg-ocean text-white" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Megaphone className="w-4 h-4" /> Advertising
            </button>
            <button
              data-testid="nav-email"
              onClick={() => setSection("email")}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap transition-colors ${
                section === "email" ? "bg-ocean text-white" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Mail className="w-4 h-4" /> Email settings
            </button>
            <button
              data-testid="nav-audit"
              onClick={() => setSection("audit")}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap transition-colors ${
                section === "audit" ? "bg-ocean text-white" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <ScrollText className="w-4 h-4" /> Audit log
            </button>
            <button
              data-testid="nav-subscriptions"
              onClick={() => setSection("subscriptions")}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap transition-colors ${section === "subscriptions" ? "bg-ocean text-white" : "text-muted-foreground hover:bg-muted"}`}
            >
              <Mail className="w-4 h-4" /> Results subscriptions
            </button>
            <button
              data-testid="nav-backup"
              onClick={() => setSection("backup")}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap transition-colors ${
                section === "backup" ? "bg-ocean text-white" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Archive className="w-4 h-4" /> Backups
            </button>
            <button
              data-testid="nav-security"
              onClick={() => setSection("security")}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap transition-colors ${
                section === "security" ? "bg-ocean text-white" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Lock className="w-4 h-4" /> Security
            </button>
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
        {section === "clubs" && (
        <>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl uppercase tracking-tighter mb-1">Club management</h1>
            <p className="text-muted-foreground text-sm">
              Add, change or remove clubs, manage each club's logins, and open any club's consoles.
            </p>
          </div>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(blank); } }}>
            <DialogTrigger asChild>
              <Button data-testid="add-club-btn" className="gap-2 bg-ocean hover:bg-ocean-dark h-12 px-5"><Plus className="w-5 h-5" /> Add club</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-heading uppercase">{editing ? "Edit" : "Add"} club</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Club name</Label><Input data-testid="club-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Seafarers Sailing Club" /></div>
                <div className="space-y-1.5"><Label>Colour</Label><Input type="color" data-testid="club-color-input" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-12 p-1" /></div>
                <p className="text-xs text-muted-foreground">Logins are individual accounts — manage them from the club's "Manage logins" button after creating the club.</p>
              </div>
              <DialogFooter><Button onClick={save} data-testid="save-club-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {clubs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            <Building2 className="w-8 h-8 mx-auto mb-2 opacity-60" />
            <p>No clubs yet — add the first one to get going.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="webmaster-club-grid">
            {clubs.map((c) => (
              <ClubCard key={c.id} club={c} onEdit={edit} onDelete={del} onConsole={openConsole} onLogins={openLogins} />
            ))}
          </div>
        )}

        <Dialog open={!!usersClub} onOpenChange={(o) => { if (!o) setUsersClub(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-heading uppercase">{usersClub?.name} — logins</DialogTitle></DialogHeader>
            {usersClub && <UsersManager key={usersClub.id} clubId={usersClub.id} heading={`${usersClub.name} logins`} />}
          </DialogContent>
        </Dialog>
        </>
        )}
        {section === "adverts" && <AdvertsManager />}
        {section === "email" && <EmailSettingsManager />}
        {section === "subscriptions" && <SubscriptionOverview webmaster />}
        {section === "audit" && (
          <div>
            <div className="mb-6">
              <h1 className="text-3xl uppercase tracking-tighter mb-1">Audit log</h1>
              <p className="text-muted-foreground text-sm">
                Every security-sensitive and administrative action across all clubs, newest first.
              </p>
            </div>
            <AuditLog webmaster />
          </div>
        )}
        {section === "backup" && <BackupSection clubs={clubs} />}
        {section === "security" && (
          <div>
            <div className="mb-6">
              <h1 className="text-3xl uppercase tracking-tighter mb-1">Security</h1>
              <p className="text-muted-foreground text-sm">
                Two-factor authentication for the webmaster account — the one that can download every club's backup and restore the whole system.
              </p>
            </div>
            <TwoFactorAuth />
          </div>
        )}
        </main>
      </div>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        Webmaster — manages clubs and has full officer & admin access to every club.
      </footer>
    </div>
  );
}
