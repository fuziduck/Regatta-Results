import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, Pencil, Trash2, Radio, ShieldCheck, UserPlus, Power, X, Check, Users } from "lucide-react";
import { passcodeError, PASSCODE_HINT } from "@/lib/helpers";

const ROLE_LABEL = { officer: "Race Officer", admin: "Race Admin" };
const ROLE_ICON = { officer: Radio, admin: ShieldCheck };

function UsersManager({ clubId = null, heading = "Club logins" }) {
  const { role: myRole } = useAuth();
  const isWebmaster = myRole === "webmaster";
  const [users, setUsers] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [formClub, setFormClub] = useState(clubId || "");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [newRole, setNewRole] = useState("officer");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editUsername, setEditUsername] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [resetId, setResetId] = useState(null);
  const [resetPass, setResetPass] = useState("");

  const load = useCallback(async () => {
    try {
      setUsers(await api.getUsers(clubId || undefined));
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isWebmaster) api.getClubs().then((cs) => setClubs(cs || [])).catch(() => {});
  }, [isWebmaster]);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim()) return toast.error("Email address is required");
    if (!EMAIL_RE.test(username.trim())) return toast.error("Username must be a valid email address");
    const policy = passcodeError(passcode);
    if (policy) return toast.error(policy);
    setBusy(true);
    try {
      await api.createUser({
        club_id: formClub || clubId || undefined,
        role: newRole,
        username: username.trim(),
        name: name.trim(),
        passcode,
      });
      toast.success(`Created login '${username.trim()}'`);
      setUsername(""); setName(""); setPasscode("");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.updateUser(u.id, { active: !u.active });
      toast.success(u.active ? `${u.username} deactivated` : `${u.username} reactivated`);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const saveEdit = async (u) => {
    if (editUsername.trim() && !EMAIL_RE.test(editUsername.trim())) {
      return toast.error("Username must be a valid email address");
    }
    try {
      await api.updateUser(u.id, { username: editUsername.trim() || undefined, name: editName, role: editRole });
      setEditId(null);
      toast.success("Login updated");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const saveReset = async (u) => {
    const policy = passcodeError(resetPass);
    if (policy) return toast.error(policy);
    try {
      await api.updateUser(u.id, { passcode: resetPass });
      setResetId(null); setResetPass("");
      toast.success(`Passcode updated for ${u.username}`);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete login '${u.username}'? They will no longer be able to sign in.`)) return;
    try {
      await api.deleteUser(u.id);
      toast.success("Login deleted");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="px-5 pt-5 pb-3 border-b border-border flex items-center gap-2.5">
        <Users className="w-5 h-5 text-ocean" />
        <h2 className="font-heading text-lg uppercase tracking-tight">{heading}</h2>
        <span className="text-xs text-muted-foreground ml-auto">{users.length} login{users.length === 1 ? "" : "s"}</span>
      </div>

      <form onSubmit={submit} className="p-5 border-b border-border grid sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        {isWebmaster && !clubId && (
          <div className="space-y-1.5 lg:col-span-2">
            <Label>Club</Label>
            <select
              value={formClub}
              onChange={(e) => setFormClub(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">Choose a club…</option>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Email address</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. tom@club.org" type="email" className="h-11" data-testid="user-username" />
        </div>
        <div className="space-y-1.5">
          <Label>Display name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tom Smith" className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="w-full h-11 px-3 rounded-lg border border-input bg-background text-sm"
          >
            <option value="officer">Race Officer</option>
            <option value="admin">Race Admin</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Passcode</Label>
          <Input value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="6+ chars, number & special char" className="h-11" type="password" />
        </div>
        <Button type="submit" disabled={busy} className="h-11 gap-2 bg-ocean hover:bg-ocean-dark" data-testid="add-user-btn">
          <UserPlus className="w-4 h-4" /> Add login
        </Button>
      </form>
      <p className="px-5 pb-3 -mt-1 text-xs text-muted-foreground">{PASSCODE_HINT}</p>

      <div className="divide-y divide-border">
        {users.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground text-center">No logins yet — create the first one above.</p>
        )}
        {users.map((u) => {
          const RoleIcon = ROLE_ICON[u.role] || Radio;
          const isEditing = editId === u.id;
          const isResetting = resetId === u.id;
          return (
            <div key={u.id} className={`px-5 py-4 flex flex-wrap items-center gap-3 ${u.active ? "" : "opacity-50"}`}>
              <div className="w-10 h-10 rounded-full bg-ocean/10 text-ocean grid place-items-center font-heading uppercase">
                {(u.name || u.username).slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} className="h-9 w-48" placeholder="Email address" type="email" data-testid="edit-username-input" />
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 w-40" placeholder="Display name" />
                    <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="h-9 px-2 rounded-lg border border-input bg-background text-sm">
                      <option value="officer">Race Officer</option>
                      <option value="admin">Race Admin</option>
                    </select>
                    <Button size="sm" className="h-9 gap-1" onClick={() => saveEdit(u)}><Check className="w-4 h-4" /> Save</Button>
                    <Button size="sm" variant="ghost" className="h-9" onClick={() => setEditId(null)}><X className="w-4 h-4" /></Button>
                  </div>
                ) : (
                  <>
                    <div className="font-semibold truncate">
                      {u.username}
                      {u.name && <span className="text-muted-foreground font-normal"> — {u.name}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${u.role === "admin" ? "bg-ocean/10 text-ocean" : "bg-muted text-muted-foreground"}`}>
                        <RoleIcon className="w-3 h-3" /> {ROLE_LABEL[u.role] || u.role}
                      </span>
                      {!u.active && (
                        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                          <Power className="w-3 h-3 mr-1" /> Deactivated
                        </span>
                      )}
                      {u.created_by === "system" && u.club_id && (
                        <span className="text-[11px] text-muted-foreground/70">(migrated from legacy passcode)</span>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                {isResetting ? (
                  <div className="flex items-center gap-2">
                    <Input value={resetPass} onChange={(e) => setResetPass(e.target.value)} placeholder="New passcode" type="password" className="h-9 w-36" autoFocus />
                    <Button size="sm" className="h-9 gap-1" onClick={() => saveReset(u)}><Check className="w-4 h-4" /> Save</Button>
                    <Button size="sm" variant="ghost" className="h-9" onClick={() => { setResetId(null); setResetPass(""); }}><X className="w-4 h-4" /></Button>
                  </div>
                ) : (
                  <>
                    <Button size="icon" variant="ghost" title="Reset passcode" data-testid={`reset-${u.username}`} onClick={() => { setResetId(u.id); setResetPass(""); setEditId(null); }}>
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Edit email / name / role" data-testid={`edit-${u.username}`} onClick={() => { setEditId(u.id); setEditUsername(u.username || ""); setEditName(u.name || ""); setEditRole(u.role); setResetId(null); }}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title={u.active ? "Deactivate" : "Reactivate"} onClick={() => toggleActive(u)}>
                      <Power className={`w-4 h-4 ${u.active ? "" : "text-destructive"}`} />
                    </Button>
                    <Button size="icon" variant="ghost" className="text-destructive" title="Delete" data-testid={`delete-${u.username}`} onClick={() => remove(u)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default UsersManager;
