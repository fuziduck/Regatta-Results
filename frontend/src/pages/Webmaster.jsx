import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import ClubBadge from "@/components/ClubBadge";
import UsersManager from "@/components/UsersManager";
import AdvertsManager from "@/components/AdvertsManager";
import EmailSettingsManager from "@/components/EmailSettingsManager";
import AuditLog from "@/components/AuditLog";
import ChangePasscodeDialog from "@/components/ChangePasscodeDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Globe, LogOut, Plus, Pencil, Trash2, Radio, ShieldCheck, Building2, KeyRound, Megaphone, Mail, ScrollText, Archive, Download } from "lucide-react";

const blank = { name: "", color: "#0A369D" };

function ClubCard({ club, onEdit, onDelete, onConsole, onLogins }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 hover:shadow-lg hover:border-ocean/40 transition-all">
      <div className="flex items-center gap-4">
        <ClubBadge club={club} />
        <div className="min-w-0">
          <div className="font-heading text-2xl uppercase tracking-tight leading-tight break-words">{club.name}</div>
          <div className="text-xs text-muted-foreground mt-1 font-mono">/{club.slug}</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" title="Manage logins" data-testid={`logins-club-${club.slug}`} onClick={() => onLogins(club)}><KeyRound className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" data-testid={`edit-club-${club.slug}`} onClick={() => onEdit(club)}><Pencil className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-club-${club.slug}`} onClick={() => onDelete(club)}><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="outline" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white" data-testid={`open-officer-${club.slug}`} onClick={() => onConsole(club, "officer")}>
          <Radio className="w-4 h-4" /> Officer console
        </Button>
        <Button variant="outline" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white" data-testid={`open-admin-${club.slug}`} onClick={() => onConsole(club, "admin")}>
          <ShieldCheck className="w-4 h-4" /> Admin console
        </Button>
      </div>
    </div>
  );
}

function BackupSection({ clubs }) {
  const [clubId, setClubId] = useState("");
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl uppercase tracking-tighter mb-1">Backups</h1>
        <p className="text-muted-foreground text-sm">
          Download a zip of JSON exports — a single club's data, or everything. Backups never contain passcodes, hashes or reset tokens.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4 max-w-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-heading text-lg uppercase tracking-tight">Full system backup</div>
            <p className="text-xs text-muted-foreground mt-0.5">Every club — clubs, users, classes, boats, series, races, results, adverts and the audit log.</p>
          </div>
          <Button
            className="gap-2 bg-ocean hover:bg-ocean-dark"
            data-testid="backup-all-btn"
            onClick={() => api.downloadBackup(null, true)}
          >
            <Download className="w-4 h-4" /> Download all
          </Button>
        </div>
        <div className="border-t border-border pt-4 flex flex-wrap items-end gap-3">
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
          <Button
            variant="outline"
            className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white"
            disabled={!clubId}
            data-testid="backup-club-btn"
            onClick={() => api.downloadBackup(clubId, true)}
          >
            <Download className="w-4 h-4" /> Download club backup
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Webmaster() {
  const { logout, updateSession } = useAuth();
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/70 mr-1">{clubs.length} club{clubs.length === 1 ? "" : "s"}</span>
            <ChangePasscodeDialog onChanged={updateSession} />
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" data-testid="webmaster-logout-btn"
              onClick={() => { logout(); navigate("/"); }}>
              <LogOut className="w-4 h-4 mr-1" /> Exit
            </Button>
          </div>
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
              data-testid="nav-backup"
              onClick={() => setSection("backup")}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap transition-colors ${
                section === "backup" ? "bg-ocean text-white" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Archive className="w-4 h-4" /> Backups
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
        </main>
      </div>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        Webmaster — manages clubs and has full officer & admin access to every club.
      </footer>
    </div>
  );
}
