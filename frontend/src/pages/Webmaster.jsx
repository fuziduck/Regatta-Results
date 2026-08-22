import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import ClubBadge from "@/components/ClubBadge";
import UsersManager from "@/components/UsersManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Globe, LogOut, Plus, Pencil, Trash2, Radio, ShieldCheck, Building2, KeyRound } from "lucide-react";

const blank = { name: "", color: "#0A369D", officer_pin: "", admin_pin: "" };

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

export default function Webmaster() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [clubs, setClubs] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [usersClub, setUsersClub] = useState(null);

  const load = useCallback(() => api.getClubsManage().then(setClubs).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name || !form.officer_pin || !form.admin_pin) return toast.error("Name and both passcodes required");
    if (editing) await api.updateClub(editing, form); else await api.createClub(form);
    toast.success(editing ? "Club updated" : "Club added");
    setOpen(false); setEditing(null); setForm(blank); load();
  };
  const edit = (c) => {
    setEditing(c.id);
    setForm({ name: c.name, color: c.color || "#0A369D", officer_pin: c.officer_pin || "", admin_pin: c.admin_pin || "" });
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
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" data-testid="webmaster-logout-btn"
              onClick={() => { logout(); navigate("/"); }}>
              <LogOut className="w-4 h-4 mr-1" /> Exit
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl uppercase tracking-tighter mb-1">Club management</h1>
            <p className="text-muted-foreground text-sm">
              Add, change or remove clubs, set each club's passcodes, and open any club's consoles.
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Officer passcode</Label><Input data-testid="club-officer-pin" value={form.officer_pin} onChange={(e) => setForm({ ...form, officer_pin: e.target.value })} placeholder="e.g. 1234" /></div>
                  <div className="space-y-1.5"><Label>Admin passcode</Label><Input data-testid="club-admin-pin" value={form.admin_pin} onChange={(e) => setForm({ ...form, admin_pin: e.target.value })} placeholder="e.g. 5678" /></div>
                </div>
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
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        Webmaster — manages clubs and has full officer & admin access to every club.
      </footer>
    </div>
  );
}
