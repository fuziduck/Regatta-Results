import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import ClubPicker from "@/components/ClubPicker";
import SeriesBoatsDialog from "@/components/SeriesBoatsDialog";
import ClubBadge from "@/components/ClubBadge";
import ConsoleNav from "@/components/ConsoleNav";
import UsersManager from "@/components/UsersManager";
import AuditLog from "@/components/AuditLog";
import TwoFactorAuth from "@/components/TwoFactorAuth";
import { CURRENT_YEAR, CODE_COLORS, fmtDate } from "@/lib/helpers";
import NoticeBoard from "@/components/NoticeBoard";
import SubscriptionOverview from "@/components/SubscriptionOverview";
import { ElapsedInput } from "@/components/ElapsedInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { ShieldCheck, Plus, Pencil, Trash2, Anchor, RotateCcw, Send, Globe, Building2, Upload, ImageOff, ImagePlus, Archive, Link2, Layers, Sailboat, Trophy, Users, ScrollText, Search, Check, ChevronsUpDown, Flag, LifeBuoy, FileText, Mail, X, CalendarDays } from "lucide-react";

function ClubIconField({ clubId }) {
  const [icon, setIcon] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    if (!clubId) return;
    api.getClubs().then((cs) => setIcon((cs || []).find((c) => c.id === clubId)?.icon || null)).catch(() => {});
  }, [clubId]);
  useEffect(() => { load(); }, [load]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error("Icon must be 512 KB or smaller");
      e.target.value = "";
      return;
    }
    setBusy(true);
    try {
      await api.uploadClubIcon(clubId, file);
      toast.success("Club icon updated");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not upload icon");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteClubIcon(clubId);
      toast.success("Club icon removed — back to the letter");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not remove icon");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6 flex flex-wrap items-center gap-4">
      <ClubBadge club={{ icon, name: "Club" }} size="w-16 h-16" textSize="text-3xl" />
      <div className="min-w-0 flex-1">
        <div className="font-heading text-lg uppercase tracking-tight">Club icon</div>
      </div>
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" data-testid="club-icon-file" onChange={pick} />
        <Button variant="outline" className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white" disabled={busy}
          onClick={() => fileRef.current?.click()} data-testid="club-icon-upload">
          <Upload className="w-4 h-4" /> {icon ? "Change" : "Upload"} icon
        </Button>
        {icon && (
          <Button variant="ghost" className="text-destructive" disabled={busy} onClick={remove} data-testid="club-icon-remove">
            <ImageOff className="w-4 h-4" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}

// Whether race-day notices (course, special rules, life jackets) are required
// in the race officer console for this club. When off, the notice section is
// hidden entirely — clubs that don't use them (e.g. casual one-race days)
// skip the extra form. Race admins may change their own club; the webmaster
// may change any club's.
function ClubNoticeToggle({ clubId }) {
  const [enabled, setEnabled] = useState(true);
  const [onbEnabled, setOnbEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!clubId) return;
    api.getClubs().then((cs) => {
      const c = (cs || []).find((x) => x.id === clubId);
      setEnabled(c ? c.race_day_notices !== false : true);
      setOnbEnabled(c ? c.official_notice_board !== false : true);
    }).catch(() => {});
  }, [clubId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (v) => {
    const prev = enabled;
    setBusy(true);
    setEnabled(v);
    try {
      await api.updateClubSettings(clubId, {
        race_day_notices: v,
        official_notice_board: onbEnabled,
      });
      toast.success(v ? "Race-day notices enabled" : "Race-day notices disabled");
    } catch (e) {
      setEnabled(prev);
      toast.error(e.response?.data?.detail || "Could not update this setting");
    } finally {
      setBusy(false);
    }
  };

  const toggleOnb = async (v) => {
    const previous = onbEnabled;
    setOnbEnabled(v);
    setBusy(true);
    try {
      await api.updateClubSettings(clubId, {
        race_day_notices: enabled,
        official_notice_board: v,
      });
      toast.success(v ? "Official Notice Board enabled" : "Official Notice Board disabled");
    } catch (e) {
      setOnbEnabled(previous);
      toast.error(e.response?.data?.detail || "Could not update this setting");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div className="rounded-2xl border border-border bg-card p-5 mb-4 flex flex-wrap items-center gap-4" data-testid="official-notice-board-toggle-card">
      <div className="w-12 h-12 rounded-lg bg-ocean/10 grid place-items-center text-ocean"><FileText className="w-6 h-6" /></div>
      <div className="min-w-0 flex-1">
        <div className="font-heading text-lg uppercase tracking-tight">Official Notice Board</div>
        <p className="text-xs text-muted-foreground mt-0.5">Show the club’s separate Official Notice Board to competitors.</p>
      </div>
      <div className="flex items-center gap-2.5"><span className="text-xs text-muted-foreground hidden sm:inline">{onbEnabled ? "Enabled" : "Disabled"}</span><Switch checked={onbEnabled} disabled={busy} onCheckedChange={toggleOnb} data-testid="official-notice-board-enabled" /></div>
    </div>
    <div className="rounded-2xl border border-border bg-card p-5 mb-6 flex flex-wrap items-center gap-4" data-testid="race-notice-toggle-card">
      <div className="w-12 h-12 rounded-lg bg-ocean/10 grid place-items-center text-ocean"><Flag className="w-6 h-6" /></div>
      <div className="min-w-0 flex-1">
        <div className="font-heading text-lg uppercase tracking-tight">Race-day notices</div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Race officers set a notice (course, special rules, life jackets) for each race day before racing.
          Turn this off to hide the notice section from the race officer console entirely.
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        {enabled
          ? <span className="text-xs text-muted-foreground hidden sm:inline">Required</span>
          : <span className="text-xs text-muted-foreground hidden sm:inline">Not required</span>}
        <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} data-testid="race-notice-enabled" />
      </div>
    </div>
    </>
  );
}

function TopBar({ clubName, onSwitchClub, clubSlug }) {
  const { role, updateSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const clubQuery = searchParams.get("club");
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-ocean-dark/95 text-white">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/15 grid place-items-center"><ShieldCheck className="w-5 h-5" /></div>
          <div className="font-heading text-xl uppercase tracking-tight leading-none">Race Admin</div>
          {clubName && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs bg-white/15 rounded-full px-3 py-1 font-semibold">
              <Building2 className="w-3.5 h-3.5" /> {clubName}
            </span>
          )}
        </div>
        <ConsoleNav
          menuLabel={clubName ? `${clubName} · Race Admin` : "Race Admin"}
          onChangedPasscode={updateSession}
          logoutTestId="admin-logout-btn"
          items={[
            {
              key: "officer",
              label: "Officer",
              icon: null,
              onClick: () => navigate(clubQuery ? `/officer?club=${clubQuery}` : "/officer"),
            },
            {
              key: "site",
              label: "View site",
              icon: <Globe className="w-4 h-4 mr-1" />,
              onClick: () => navigate(clubSlug ? `/club/${clubSlug}` : "/"),
            },
            ...(role === "webmaster" && onSwitchClub ? [{
              key: "switch",
              label: "Switch club",
              icon: <Building2 className="w-4 h-4 mr-1" />,
              onClick: onSwitchClub,
            }] : []),
            ...(role === "webmaster" ? [{
              key: "webmaster",
              label: "Webmaster",
              icon: <Globe className="w-4 h-4 mr-1" />,
              onClick: () => navigate("/webmaster"),
            }] : []),
          ]}
        />
      </div>
    </header>
  );
}

/* ---------------- Classes ---------------- */
function ClassesTab({ classes, reload, clubId }) {
  const [form, setForm] = useState({ name: "", default_start_time: "10:30" });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const save = async () => {
    if (!form.name) return toast.error("Name required");
    if (editing) await api.updateClass(editing, form); else await api.createClass({ ...form, club_id: clubId });
    toast.success("Saved"); setOpen(false); setEditing(null); setForm({ name: "", default_start_time: "10:30" }); reload();
  };
  const del = async (id) => { await api.deleteClass(id); toast.success("Deleted"); reload(); };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Fleets racing this season. Each has an auto start time.</p>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm({ name: "", default_start_time: "10:30" }); } }}>
          <DialogTrigger asChild><Button data-testid="add-class-btn" className="gap-2 bg-ocean hover:bg-ocean-dark"><Plus className="w-4 h-4" /> Add class</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-heading uppercase">{editing ? "Edit" : "Add"} class</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Class name</Label><Input data-testid="class-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dragon" /></div>
              <div className="space-y-1.5"><Label>Default start time</Label><Input type="time" data-testid="class-time-input" value={form.default_start_time} onChange={(e) => setForm({ ...form, default_start_time: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={save} data-testid="save-class-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-xl border overflow-hidden">
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Class</TableHead><TableHead>Start</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{classes.map((c) => (
            <TableRow key={c.id} data-testid={`class-row-${c.name}`}>
              <TableCell className="font-heading text-lg uppercase tracking-tight">{c.name}</TableCell>
              <TableCell className="font-mono">{c.default_start_time}</TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(c.id); setForm({ name: c.name, default_start_time: c.default_start_time }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-class-${c.name}`} onClick={() => del(c.id)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>))}
          </TableBody></Table>
      </div>
    </div>
  );
}

/* ---------------- Boats ---------------- */
function BoatsTab({ classes, clubs, clubId, clubName = "" }) {
  const [classFilter, setClassFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState(CURRENT_YEAR);
  const { seasonYears } = useSeasonYears(clubId);
  const yearChoices = withSeasonYears(YEAR_OPTIONS, seasonYears);
  const [boats, setBoats] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const blank = { name: "", sail_no: "", class_id: "", home_club: clubName || "", helm: "", year: CURRENT_YEAR, active: true, tcc: "", py: "", boat_type: "" };
  const [form, setForm] = useState(blank);
  // Shared boat identity: matches found for the typed name+sail, and the
  // admin's choice — link to an existing fleet identity, or keep separate
  // (a different boat with identical details).
  const [fleetMatches, setFleetMatches] = useState([]);
  const [fleetChoice, setFleetChoice] = useState("auto"); // auto | link | separate
  const [fleetTarget, setFleetTarget] = useState("");
  const [fleetBusy, setFleetBusy] = useState(false);
  // Searchable "same boat elsewhere" dropdown: the match picker, not a wall
  // of radios (an existing boat's name+sail can match dozens of records).
  const [fleetSearchOpen, setFleetSearchOpen] = useState(false);
  const [fleetQuery, setFleetQuery] = useState("");

  const load = useCallback(() => {
    const p = classFilter === "all" ? { year: yearFilter } : { class_id: classFilter, year: yearFilter };
    api.getBoats({ ...p, ...(clubId ? { club_id: clubId } : {}) }).then(setBoats);
  }, [classFilter, yearFilter, clubId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setClassFilter("all"); setYearFilter(CURRENT_YEAR); }, [clubId]);

  // Debounced fleet lookup while the dialog is open: show whether the typed
  // boat already exists elsewhere so the admin can link (or keep separate).
  useEffect(() => {
    if (!open || !form.name.trim() || !form.sail_no.trim()) {
      setFleetMatches([]);
      return;
    }
    setFleetBusy(true);
    const t = setTimeout(() => {
      api.fleetSearch(`${form.name} ${form.sail_no}`)
        .then((res) => {
          const editingBoat = editing ? boats.find((b) => b.id === editing) : null;
          const ownFid = editingBoat?.fleet_id;
          const matches = (res || []).filter((m) => m.fleet_id !== ownFid);
          setFleetMatches(matches);
          if (matches.length > 0) {
            // Default to linking unless the match is in the same club+class
            // (which usually means a duplicate entry, not the shared boat).
            const curClass = classes.find((c) => c.id === form.class_id);
            const curClub = clubs.find((c) => c.id === curClass?.club_id)?.name;
            const sameSpot = matches.some(
              (m) => m.clubs.includes(curClub) && m.classes.includes(curClass?.name));
            setFleetChoice(sameSpot ? "separate" : "link");
            setFleetTarget(sameSpot ? "" : matches[0].fleet_id);
          } else {
            setFleetChoice("auto");
            setFleetTarget("");
          }
        })
        .catch(() => {})
        .finally(() => setFleetBusy(false));
    }, 350);
    return () => clearTimeout(t);
  }, [open, form.name, form.sail_no, form.class_id, editing, boats, classes, clubs]);

  const save = async () => {
    if (!form.name || !form.sail_no || !form.class_id || !form.helm) return toast.error("All fields required");
    const payload = {
      name: form.name, sail_no: form.sail_no, class_id: form.class_id, helm: form.helm,
      year: Number(form.year), active: form.active,
      tcc: form.tcc === "" ? null : Number(form.tcc),
      py: form.py === "" ? null : Number(form.py), boat_type: form.boat_type,
      home_club: (form.home_club || "").trim(),
    };
    if (fleetChoice === "link" && fleetTarget) payload.fleet_id = fleetTarget;
    else if (fleetChoice === "separate" && fleetMatches.length > 0) payload.separate_fleet = true;
    try {
      if (editing) await api.updateBoat(editing, payload, boats.find((b) => b.id === editing)?.version);
      else await api.createBoat(payload);
    } catch (e) {
      if (e.response?.status === 409) {
        const detail = e.response.data?.detail;
        if (detail && Array.isArray(detail.fleet_candidates)) {
          setFleetMatches(detail.fleet_candidates.map((c) => ({
            fleet_id: c.fleet_id, name: c.name, sail_no: c.sail_no,
            clubs: [c.club_name], classes: [c.class_name], records: 1,
          })));
          setFleetChoice("separate");
          setFleetTarget("");
          toast.error(detail.message || "This boat matches an existing boat — choose how to handle it.");
          return;
        }
        toast.error("This boat has been changed by another user. Reload the latest details before editing again.");
        load();
        return;
      }
      throw e;
    }
    toast.success("Saved"); setOpen(false); setEditing(null); setForm(blank); setFleetMatches([]); setFleetChoice("auto"); setFleetTarget(""); load();
  };
  const del = async (id) => { await api.deleteBoat(id, boats.find((b) => b.id === id)?.version); toast.success("Deleted"); load(); };
  const cname = (id) => classes.find((c) => c.id === id)?.name || "—";
  // Fallback for boats created before home_club existed: derive from the class's club.
  const clubOf = (b) => {
    const cl = classes.find((c) => c.id === b.class_id);
    return clubs.find((c) => c.id === cl?.club_id)?.name || "—";
  };
  const showClub = (b) => b.home_club || clubOf(b);

  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Class</Label>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-40" data-testid="boat-class-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All classes</SelectItem>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Year</Label>
          <Select value={String(yearFilter)} onValueChange={(v) => setYearFilter(Number(v))}>
            <SelectTrigger className="w-28" data-testid="boat-year-filter"><SelectValue /></SelectTrigger>
            <SelectContent>{yearChoices.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(blank); } }}>
          <DialogTrigger asChild><Button data-testid="add-boat-btn" className="gap-2 bg-ocean hover:bg-ocean-dark"><Plus className="w-4 h-4" /> Add boat</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-heading uppercase">{editing ? "Edit" : "Add"} boat</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2"><Label>Boat name</Label><Input data-testid="boat-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Sail No.</Label><Input data-testid="boat-sail-input" value={form.sail_no} onChange={(e) => setForm({ ...form, sail_no: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Class</Label>
                <Select value={form.class_id} onValueChange={(v) => setForm({ ...form, class_id: v })}>
                  <SelectTrigger data-testid="boat-class-input"><SelectValue placeholder="Class" /></SelectTrigger>
                  <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1.5 col-span-2"><Label>Home club</Label>
                <Input data-testid="boat-home-club-input" value={form.home_club} onChange={(e) => setForm({ ...form, home_club: e.target.value })} placeholder={clubName || "Club this boat sails for"} list="home-club-options" />
                <datalist id="home-club-options">{clubs.map((c) => <option key={c.id} value={c.name} />)}</datalist>
                <p className="text-xs text-muted-foreground">Defaults to {clubName || "your club"} — shown on published results. Type any name, e.g. a visiting boat's home club.</p></div>
              <div className="space-y-1.5"><Label>Helm</Label><Input data-testid="boat-helm-input" value={form.helm} onChange={(e) => setForm({ ...form, helm: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Year</Label><Input type="number" data-testid="boat-year-input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Boat type</Label><Input data-testid="boat-type-input" value={form.boat_type} onChange={(e) => setForm({ ...form, boat_type: e.target.value })} placeholder="e.g. Bavaria 34" /></div>
              <div className="space-y-1.5"><Label>TCC (IRC rating)</Label><Input type="number" step="0.001" min="0" data-testid="boat-tcc-input" value={form.tcc} onChange={(e) => setForm({ ...form, tcc: e.target.value })} placeholder="e.g. 1.015 — blank if not IRC-rated" /></div>
              <div className="space-y-1.5"><Label>PY (Portsmouth)</Label><Input type="number" step="1" min="0" data-testid="boat-py-input" value={form.py} onChange={(e) => setForm({ ...form, py: e.target.value })} placeholder="e.g. 1013 — blank if not PY-rated" /></div>
              <div className="flex items-center gap-2 col-span-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="boat-active-switch" /><Label>Active (racing this year)</Label></div>
              {fleetMatches.length > 0 && (
                <div className="col-span-2 rounded-lg border border-ocean/30 bg-ocean/5 p-3 space-y-2" data-testid="fleet-link-panel">
                  <p className="text-xs font-semibold text-ocean dark:text-ocean-light uppercase tracking-wide flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5" /> Same boat elsewhere?
                  </p>
                  {fleetBusy && fleetMatches.length === 0 && <p className="text-xs text-muted-foreground">Checking…</p>}
                  {/* Searchable dropdown over the matches — the admin types to
                      narrow, then picks one; no long radio list to scroll. */}
                  <Popover open={fleetSearchOpen} onOpenChange={setFleetSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" role="combobox" aria-expanded={fleetSearchOpen}
                        className="w-full justify-between font-normal" data-testid="fleet-match-trigger">
                        {fleetChoice === "link" && fleetTarget
                          ? (() => { const sel = fleetMatches.find((m) => m.fleet_id === fleetTarget); return sel
                              ? <span className="truncate"><span className="font-semibold">{sel.name}</span> <span className="font-mono text-xs text-muted-foreground">#{sel.sail_no}</span> <span className="text-xs text-muted-foreground">— {[...sel.clubs, ...sel.classes].join(", ")}</span></span>
                              : <span className="text-muted-foreground">Choose a boat…</span>; })()
                          : <span className="text-muted-foreground">Choose a boat…</span>}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 p-0">
                      <Command>
                        <CommandInput placeholder="Search by name, sail no., club or class…" value={fleetQuery} onValueChange={setFleetQuery} data-testid="fleet-match-search" />
                        <CommandList>
                          <CommandEmpty>No matching boats.</CommandEmpty>
                          <CommandGroup>
                            {fleetMatches.filter((m) => {
                              const q = fleetQuery.trim().toLowerCase();
                              if (!q) return true;
                              return [m.name, m.sail_no, ...(m.clubs || []), ...(m.classes || [])]
                                .join(" ").toLowerCase().includes(q);
                            }).map((m) => (
                              <CommandItem key={m.fleet_id} value={`${m.name} ${m.sail_no} ${(m.clubs || []).join(" ")} ${(m.classes || []).join(" ")}`}
                                onSelect={() => { setFleetChoice("link"); setFleetTarget(m.fleet_id); setFleetSearchOpen(false); }}
                                data-testid={`fleet-match-${m.sail_no}`}>
                                <Check className={`mr-2 h-4 w-4 ${fleetChoice === "link" && fleetTarget === m.fleet_id ? "opacity-100" : "opacity-0"}`} />
                                <span className="min-w-0">
                                  <span className="block font-semibold truncate">{m.name} <span className="font-mono text-xs text-muted-foreground">#{m.sail_no}</span></span>
                                  <span className="block text-xs text-muted-foreground truncate">{m.clubs.join(", ")} · {m.classes.join(", ")}</span>
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="radio" name="fleet-choice" className="mt-1 accent-ocean"
                      checked={fleetChoice === "separate"}
                      onChange={() => { setFleetChoice("separate"); setFleetTarget(""); }} />
                    <span>
                      <span className="font-semibold">Keep as a separate boat</span>
                      <span className="block text-xs text-muted-foreground">A different boat that happens to share the same name and sail number.</span>
                    </span>
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    {fleetChoice === "link"
                      ? "Linked boats share one identity — their results across clubs and classes appear together on the boat's public page."
                      : "This boat will keep its own identity — its results stay separate from any same-named boat."}
                  </p>
                </div>
              )}
            </div>
            <DialogFooter><Button onClick={save} data-testid="save-boat-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-xl border overflow-hidden overflow-x-auto">
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Sail No.</TableHead><TableHead>Boat</TableHead><TableHead>Class</TableHead><TableHead>Club</TableHead><TableHead>Helm</TableHead><TableHead>Type</TableHead><TableHead>TCC</TableHead><TableHead>PY</TableHead><TableHead>Active</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{boats.map((b) => (
            <TableRow key={b.id} data-testid={`boat-row-${b.sail_no}`}>
              <TableCell className="font-mono font-bold">{b.sail_no}</TableCell>
              <TableCell className="font-semibold">
                {b.name}
                {b.fleet_id && b.fleet_id !== b.id && (
                  <Link2 title="Shares one boat identity with records at other clubs/classes" className="w-3.5 h-3.5 inline ml-1.5 text-ocean dark:text-ocean-light" data-testid={`linked-${b.sail_no}`} />
                )}
              </TableCell>
              <TableCell>{cname(b.class_id)}</TableCell>
              <TableCell className="text-muted-foreground">{showClub(b)}</TableCell>
              <TableCell>{b.helm}</TableCell>
              <TableCell className="text-muted-foreground">{b.boat_type || "—"}</TableCell>
              <TableCell className="font-mono">{b.tcc ? b.tcc.toFixed(3) : "—"}</TableCell>
              <TableCell className="font-mono">{b.py ? Math.round(b.py) : "—"}</TableCell>
              <TableCell>{b.active ? <Badge className="bg-emerald-100 text-emerald-800">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(b.id); setForm({ name: b.name, sail_no: b.sail_no, class_id: b.class_id, home_club: b.home_club || clubName || "", helm: b.helm, year: b.year, active: b.active, tcc: b.tcc ?? "", py: b.py ?? "", boat_type: b.boat_type ?? "" }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-boat-${b.sail_no}`} onClick={() => del(b.id)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>))}
            {!boats.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">No boats yet.</TableCell></TableRow>}
          </TableBody></Table>
      </div>
    </div>
  );
}

/* ---------------- Series ---------------- */
// Newest first: two seasons ahead (so future series can be set up and
// managed before racing starts) through the historic range.
const YEAR_OPTIONS = [CURRENT_YEAR + 2, CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

// Season years that actually exist in the DB for the club, so the year
// dropdowns always include any year a series has been set up in — even
// beyond the fixed YEAR_OPTIONS window. `reload` re-fetches after a save.
function useSeasonYears(clubId) {
  const [seasonYears, setSeasonYears] = useState([]);
  const reload = useCallback(() => {
    api.getSeasons(clubId ? { club_id: clubId } : {}).then((d) => setSeasonYears(d?.years || [])).catch(() => {});
  }, [clubId]);
  useEffect(() => { reload(); }, [reload]);
  return { seasonYears, reload };
}

const withSeasonYears = (base, seasonYears) =>
  [...new Set([...base, ...seasonYears])].sort((a, b) => b - a);

// Regattas: racing occasions that group series across classes. A regatta
// holds no races or results itself — series opt in via their regatta_id,
// and the regatta card/page derives classes and race counts from them.
function RegattasTab({ clubId }) {
  const [yearFilter, setYearFilter] = useState(CURRENT_YEAR);
  const { seasonYears, reload: reloadYears } = useSeasonYears(clubId);
  const yearChoices = withSeasonYears(YEAR_OPTIONS, seasonYears);
  const [regattas, setRegattas] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", year: CURRENT_YEAR, competition_type: "regatta", championship_scope: "", start_date: "", end_date: "", host_club: "", status: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [thumbFor, setThumbFor] = useState(null);
  // Keep one file input per competition. A single shared ref points at the
  // last table row, which can silently upload the wrong competition's photo.
  const thumbRefs = useRef({});

  const load = useCallback(() => {
    api.getRegattas({ year: yearFilter, ...(clubId ? { club_id: clubId } : {}) }).then(setRegattas).catch(() => {});
  }, [clubId, yearFilter]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name) return toast.error("Regatta name required");
    setBusy(true);
    try {
      const payload = {
        ...form,
        year: Number(form.year),
        status: form.status || undefined,
        competition_type: form.competition_type || "regatta",
        championship_scope: form.competition_type === "championship" ? (form.championship_scope || undefined) : undefined,
        ...(clubId ? { club_id: clubId } : {}),
      };
      if (editing) await api.updateRegatta(editing, payload);
      else await api.createRegatta(payload);
      toast.success("Saved"); setOpen(false); setEditing(null); setForm({ name: "", year: yearFilter, competition_type: "regatta", championship_scope: "", start_date: "", end_date: "", host_club: "", status: "", description: "" });
      reloadYears(); load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save regatta");
    } finally {
      setBusy(false);
    }
  };

  const del = async (r) => {
    if (!window.confirm(`Delete the regatta “${r.name}”? Its series stay intact and simply become standalone series again.`)) return;
    try {
      await api.deleteRegatta(r.id);
      toast.success("Regatta deleted — series unlinked");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not delete regatta");
    }
  };

  const pickThumb = async (e, regatta) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Photo must be 2 MB or smaller");
      e.target.value = "";
      return;
    }
    setThumbFor(regatta.id);
    try {
      await api.uploadRegattaThumbnail(regatta.id, file);
      toast.success("Regatta photo updated");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not upload photo");
    } finally {
      setThumbFor(null);
      e.target.value = "";
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Year</Label>
          <Select value={String(yearFilter)} onValueChange={(v) => setYearFilter(Number(v))}>
            <SelectTrigger className="w-28" data-testid="regatta-year-filter"><SelectValue /></SelectTrigger>
            <SelectContent>{yearChoices.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm({ name: "", year: yearFilter, competition_type: "regatta", championship_scope: "", start_date: "", end_date: "", host_club: "", status: "", description: "" }); } }}>
          <DialogTrigger asChild><Button data-testid="add-regatta-btn" className="gap-2 bg-ocean hover:bg-ocean-dark"><Plus className="w-4 h-4" /> Add competition</Button></DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-heading uppercase">{editing ? "Edit" : "Add"} competition</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Competition name</Label><Input data-testid="regatta-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 2026 Regatta" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Type</Label>
                  <Select value={form.competition_type || "regatta"} onValueChange={(v) => setForm({ ...form, competition_type: v, championship_scope: v === "regatta" ? "" : form.championship_scope })}>
                    <SelectTrigger data-testid="regatta-type-input"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regatta">Regatta</SelectItem>
                      <SelectItem value="championship">Championship</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Regatta = a specific racing occasion · Championship = a competition over a period</p>
                </div>
                {form.competition_type === "championship" ? (
                  <div className="space-y-1.5"><Label>Championship scope</Label>
                    <Select value={form.championship_scope || ""} onValueChange={(v) => setForm({ ...form, championship_scope: v === "__none__" ? "" : v })}>
                      <SelectTrigger data-testid="regatta-scope-input"><SelectValue placeholder="Select scope" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="club">Club</SelectItem>
                        <SelectItem value="class">Class</SelectItem>
                        <SelectItem value="open">Open / Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : <div className="space-y-1.5"><Label className="text-muted-foreground">Championship scope</Label><div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">Only for championships</div></div>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Year</Label><Input type="number" min="2000" max="2100" data-testid="regatta-year-input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Host club</Label><Input value={form.host_club} onChange={(e) => setForm({ ...form, host_club: e.target.value })} placeholder="e.g. Medway Yacht Club" /></div>
                <div className="space-y-1.5"><Label>Start date</Label><Input type="date" value={form.start_date || ""} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>End date</Label><Input type="date" value={form.end_date || ""} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Status <span className="text-muted-foreground normal-case text-xs">(optional — derived from dates/races if blank)</span></Label>
                <Select value={form.status || ""} onValueChange={(v) => setForm({ ...form, status: v === "__none__" ? "" : v })}>
                  <SelectTrigger data-testid="regatta-status-input"><SelectValue placeholder="Auto (from dates & races)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Auto (from dates & races)</SelectItem>
                    <SelectItem value="Upcoming">Upcoming</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Complete">Complete</SelectItem>
                  </SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label>Description / notices <span className="text-muted-foreground normal-case text-xs">(optional)</span></Label>
                <textarea data-testid="regatta-description-input" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="e.g. Three days of racing across all fleets…" /></div>
            </div>
            <DialogFooter><Button onClick={save} disabled={busy} data-testid="save-regatta-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <p className="text-sm text-muted-foreground mb-4">A competition groups series across classes — either a regatta (a specific racing occasion) or a championship (a competition over a period). Add the club's series to it from the Series tab; standalone series remain visible there and in Historic Results.</p>
      <div className="rounded-xl border overflow-hidden overflow-x-auto">
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Photo</TableHead><TableHead>Competition</TableHead><TableHead>Type</TableHead><TableHead>Year</TableHead><TableHead>Dates</TableHead><TableHead>Host</TableHead><TableHead>Status</TableHead><TableHead>Series</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{regattas.map((r) => (
            <TableRow key={r.id} data-testid={`regatta-row-${r.name}`}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-10 shrink-0 overflow-hidden rounded-md border border-border bg-ocean/10 grid place-items-center">
                    {r.thumbnail ? <img src={r.thumbnail} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="w-4 h-4 text-ocean/50" />}
                  </div>
                  <input ref={(el) => { if (el) thumbRefs.current[r.id] = el; }} type="file" accept="image/*" className="hidden" data-testid={`regatta-thumb-file-${r.name}`} onChange={(e) => pickThumb(e, r)} />
                  <Button size="sm" variant="outline" className="h-8" disabled={thumbFor === r.id}
                    onClick={() => thumbRefs.current[r.id]?.click()} data-testid={`regatta-thumb-${r.name}`}>
                    <Upload className="w-3.5 h-3.5" /> {thumbFor === r.id ? "…" : r.thumbnail ? "Change" : "Photo"}
                  </Button>
                </div>
              </TableCell>
              <TableCell className="font-heading text-lg uppercase tracking-tight">{r.name}</TableCell>
              <TableCell>{r.competition_type === "championship"
                ? <Badge className="gap-1 bg-amber-100 text-amber-700 border border-amber-300"><Trophy className="w-3 h-3" />Championship{r.championship_scope ? ` · ${r.championship_scope[0].toUpperCase()}${r.championship_scope.slice(1)}` : ""}</Badge>
                : <Badge variant="outline" className="gap-1"><CalendarDays className="w-3 h-3" />Regatta</Badge>}</TableCell>
              <TableCell className="font-mono">{r.year || "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.date_label || "—"}</TableCell>
              <TableCell className="text-xs">{r.host_club || "—"}</TableCell>
              <TableCell>{r.status ? <Badge variant={r.status === "Complete" ? "default" : r.status === "Upcoming" ? "outline" : "secondary"}>{r.status}</Badge> : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.series?.length || 0} series · {r.class_count || 0} classes · {r.race_count || 0} races</TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(r.id); setForm({ name: r.name, year: r.year, competition_type: r.competition_type || "regatta", championship_scope: r.championship_scope || "", start_date: r.start_date || "", end_date: r.end_date || "", host_club: r.host_club || "", status: r.status || "", description: r.description || "" }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => del(r)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>
          ))}
            {!regattas.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No competitions for this year yet.</TableCell></TableRow>}
          </TableBody></Table>
      </div>
    </div>
  );
}

function SeriesTab({ classes, clubId }) {
  const [classFilter, setClassFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const { seasonYears, reload: reloadYears } = useSeasonYears(clubId);
  const yearChoices = ["all", ...withSeasonYears(YEAR_OPTIONS, seasonYears)];
  const [series, setSeries] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [lockDialog, setLockDialog] = useState(null); // {mode: "lock"|"unlock", series}
  const [lockReason, setLockReason] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [snapSeries, setSnapSeries] = useState(null); // series whose snapshot history is shown
  const [snapshots, setSnapshots] = useState([]);
  // Series membership editor: which of the class's boats form part of this
  // series (drives the DNC scoring engine).
  const [boatsSeries, setBoatsSeries] = useState(null);
  // Canonical default scoring-rule configuration (RRS 2025-2028 Appendix A
  // Low Point): A5.2 default, no TLE, 20% SCP/ZFP capped at DNF, fixed
  // discards, duty = average of the boat's results across the series (DNC included).
  const defaultScoringConfig = () => ({
    rrs_edition: "RRS 2025-2028",
    a5_convention: "a5_2",
    discard_policy: "fixed",
    discard_schedule: [],
    tle: { enabled: false, time_limit_minutes: null, method: "finishers_plus_1" },
    scp: { method: "percent", value: 20, cap_dnf: true },
    zfp: { method: "percent", value: 20, cap_dnf: true },
    duty: { enabled: true, method: "average_own_sailed", round: 2 },
  });
  // Rebuild a form scoring_config from a stored series (legacy flat flags are
  // normalised into the versioned config so old seasons keep their rules).
  const scoringConfigFromSeries = (s) => {
    const cfg = { ...defaultScoringConfig(), ...((s.scoring_config && typeof s.scoring_config === "object") ? s.scoring_config : {}) };
    if (!s.scoring_config) {
      cfg.a5_convention = s.use_finishers ? "finishers" : s.use_a5_3 ? "a5_3" : "a5_2";
    }
    cfg.tle = { ...cfg.tle, ...((s.scoring_config?.tle) || {}) };
    cfg.scp = { ...defaultScoringConfig().scp, ...cfg.scp };
    cfg.zfp = { ...defaultScoringConfig().zfp, ...cfg.zfp };
    cfg.duty = { ...defaultScoringConfig().duty, ...cfg.duty };
    return cfg;
  };
  const [regattas, setRegattas] = useState([]);
  useEffect(() => { api.getRegattas({ ...(clubId ? { club_id: clubId } : {}) }).then(setRegattas).catch(() => {}); }, [clubId]);
  const blank = () => ({ name: "", class_id: "", year: CURRENT_YEAR, scoring_mode: "one_design", discards: 0, included_in_overall: true, order: 0, planned_races: 0, schedule: [], use_a5_3: false, use_finishers: false, mini_series: false, mini_series_groups: [], scoring_config: defaultScoringConfig(), regatta_id: "" });
  const miniGroupScoring = (g) => (g && (g.scoring === "combined" ? "combined" : "additional"));
  const [form, setForm] = useState(blank());
  const [schedStart, setSchedStart] = useState("2026-08-08");
  const [autoSize, setAutoSize] = useState(5);
  const patchCfg = (patch) => setForm((f) => ({ ...f, scoring_config: { ...f.scoring_config, ...patch } }));
  const patchCfgNested = (key, patch) => setForm((f) => ({ ...f, scoring_config: { ...f.scoring_config, [key]: { ...f.scoring_config[key], ...patch } } }));
  // How many races the admin can assign into mini series (planned count, or
  // the schedule length if that is set instead).
  const miniRaceTotal = Math.max(Number(form.planned_races) || 0, (form.schedule || []).length);

  const toggleMiniRace = (gi, raceNo) => setForm((f) => {
    const groups = (f.mini_series_groups || []).map((g, idx) => {
      const has = (g.race_numbers || []).includes(raceNo);
      if (idx === gi) return { ...g, race_numbers: has ? (g.race_numbers || []).filter((n) => n !== raceNo) : [...(g.race_numbers || []), raceNo].sort((a, b) => a - b) };
      // a race may only belong to one mini series — take it out of the others
      return has ? { ...g, race_numbers: (g.race_numbers || []).filter((n) => n !== raceNo) } : g;
    });
    return { ...f, mini_series_groups: groups };
  });
  const patchMiniGroup = (gi, patch) => setForm((f) => {
    const groups = (f.mini_series_groups || []).map((g, idx) => (idx === gi ? { ...g, ...patch } : g));
    return { ...f, mini_series_groups: groups };
  });
  const addMiniGroup = () => setForm((f) => ({
    ...f, mini_series_groups: [...(f.mini_series_groups || []), { name: `Mini ${(f.mini_series_groups || []).length + 1}`, race_numbers: [], discards: 0, scoring: "additional" }],
  }));
  const removeMiniGroup = (gi) => setForm((f) => ({
    ...f, mini_series_groups: (f.mini_series_groups || []).filter((_, idx) => idx !== gi),
  }));
  const autoSplitMini = () => {
    const size = Math.max(1, Number(autoSize) || 1);
    if (miniRaceTotal <= 0) return toast.error("Set planned races first so the mini series can be split");
    const groups = [];
    for (let start = 1; start <= miniRaceTotal; start += size) {
      const race_numbers = Array.from({ length: Math.min(size, miniRaceTotal - start + 1) }, (_, k) => start + k);
      groups.push({ name: `Mini ${groups.length + 1}`, race_numbers, discards: 0, scoring: "additional" });
    }
    setForm((f) => ({ ...f, mini_series_groups: groups }));
  };

  // Start with all classes visible so a series cannot disappear simply because
  // it belongs to a different fleet. The class filter remains available for
  // focused editing and scoring work.
  useEffect(() => { if (!classFilter && classes.length) setClassFilter("all"); }, [classes]); // eslint-disable-line
  // Reset filters only when the club actually changes — not on first mount,
  // or the reset would clobber the auto-selected first class above.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setClassFilter(""); setYearFilter("all"); setSeries([]);
  }, [clubId]);
  const load = useCallback(() => {
    if (!classFilter) return;
    const params = { ...(yearFilter !== "all" ? { year: yearFilter } : {}), ...(clubId ? { club_id: clubId } : {}) };
    if (classFilter !== "all") params.class_id = classFilter;
    api.getSeries(params).then(setSeries);
  }, [classFilter, yearFilter, clubId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name || !form.class_id) return toast.error("Name and class required");
    const cfg = form.scoring_config || defaultScoringConfig();
    // Keep the legacy flat flags in sync so older UI (and the API contract)
    // still sees the A5 convention; the versioned scoring_config is the
    // source of truth the engine actually reads.
    const convention = cfg.a5_convention;
    const payload = {
      ...form, regatta_id: form.regatta_id || null,
      discards: Number(form.discards), order: Number(form.order),
      year: Number(form.year), planned_races: Number(form.planned_races),
      schedule: form.schedule || [],
      use_a5_3: convention === "a5_3", use_finishers: convention === "finishers",
      scoring_config: {
        ...cfg,
        tle: { ...cfg.tle, time_limit_minutes: cfg.tle.time_limit_minutes ? Number(cfg.tle.time_limit_minutes) : null },
        scp: { ...cfg.scp, value: Number(cfg.scp.value) || 0 },
        zfp: { ...cfg.zfp, value: Number(cfg.zfp.value) || 0 },
        discard_schedule: (cfg.discard_schedule || []).map((s) => ({ after_races: Number(s.after_races) || 0, discards: Number(s.discards) || 0 })),
      },
    };
    try {
      if (editing) await api.updateSeries(editing, payload, series.find((s) => s.id === editing)?.version);
      else await api.createSeries(payload);
    } catch (e) {
      if (e.response?.status === 409) {
        const detail = e.response?.data?.detail || "";
        if (/locked|archived/i.test(detail)) {
          toast.error("This season is locked — scoring rules cannot be changed. Unlock it first, or use the administrator correction process.");
        } else {
          toast.error("This series has been changed by another user. Reload the latest settings before editing again.");
        }
      } else {
        toast.error(e.response?.data?.detail || "Could not save series");
      }
      load();
      return;
    }
    toast.success("Saved"); setOpen(false); setEditing(null); setForm({ ...blank(), class_id: classFilter !== "all" ? classFilter : (classes[0]?.id || "") });
    reloadYears(); load();
  };
  const genSchedule = async () => {
    if (!editing) return toast.error("Save the series first, then re-open to auto-fill dates");
    try {
      const s = await api.generateSchedule(editing, { start_date: schedStart, count: Number(form.planned_races) || undefined });
      setForm((f) => ({ ...f, schedule: s.schedule || [], planned_races: s.planned_races }));
      toast.success("Weekly schedule generated"); load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not generate schedule");
    }
  };
  const setSchedDate = (idx, val) => setForm((f) => { const sc = [...(f.schedule || [])]; sc[idx] = val; return { ...f, schedule: sc }; });
  const del = async (id) => { await api.deleteSeries(id, series.find((x) => x.id === id)?.version); toast.success("Deleted"); load(); };
  const quickSet = async (s, patch) => {
    try { await api.updateSeries(s.id, { ...s, ...patch }, s.version); }
    catch (e) {
      if (e.response?.status === 409) {
        const detail = e.response?.data?.detail || "";
        if (/locked|archived/i.test(detail)) toast.error("This season is locked — unlock it before editing.");
        else toast.error("This series has been changed by another user. Reload the latest settings before editing again.");
      }
      else toast.error(e.response?.data?.detail || "Could not update series");
    }
    load();
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Class</Label>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-40" data-testid="series-class-filter"><SelectValue placeholder="Class" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Year</Label>
          <Select value={String(yearFilter)} onValueChange={(v) => setYearFilter(v === "all" ? "all" : Number(v))}>
            <SelectTrigger className="w-32" data-testid="series-year-filter"><SelectValue /></SelectTrigger>
            <SelectContent>{yearChoices.map((y) => <SelectItem key={y} value={String(y)}>{y === "all" ? "All years" : y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm({ ...blank(), class_id: classFilter !== "all" ? classFilter : (classes[0]?.id || "") }); } }}>
          <DialogTrigger asChild><Button data-testid="add-series-btn" onClick={() => setForm({ ...blank(), class_id: classFilter !== "all" ? classFilter : (classes[0]?.id || ""), order: series.length + 1, scoring_mode: classes.find((c) => c.id === classFilter)?.scoring_mode || "one_design" })} className="gap-2 bg-ocean hover:bg-ocean-dark"><Plus className="w-4 h-4" /> Add series</Button></DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-heading uppercase">{editing ? "Edit" : "Add"} series</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Series name</Label><Input data-testid="series-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Early Spring" /></div>
              <div className="space-y-1.5"><Label>Class</Label>
                <Select value={form.class_id} onValueChange={(v) => setForm({ ...form, class_id: v })}>
                  <SelectTrigger data-testid="series-class-input"><SelectValue placeholder="Class" /></SelectTrigger>
                  <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label>Competition <span className="text-muted-foreground normal-case text-xs">(optional — regatta or championship)</span></Label>
                <Select value={form.regatta_id || "__none__"} onValueChange={(v) => setForm({ ...form, regatta_id: v === "__none__" ? "" : v })}>
                  <SelectTrigger data-testid="series-regatta-input"><SelectValue placeholder="Not part of a competition" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not part of a competition</SelectItem>
                    {regattas.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {r.year}{r.competition_type === "championship" ? " (Championship)" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Series belonging to a competition appear on its page (per class) instead of the club's championship list.</p>
              </div>
              <div className="space-y-1.5"><Label>Scoring system</Label>
                <Select value={form.scoring_mode || "one_design"} onValueChange={(v) => setForm({ ...form, scoring_mode: v })}>
                  <SelectTrigger data-testid="series-scoring-input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_design">One-design (finish order)</SelectItem>
                    <SelectItem value="irc">IRC (corrected time)</SelectItem>
                    <SelectItem value="py">PY (Portsmouth Yardstick)</SelectItem>
                  </SelectContent>
                </Select>
                {form.scoring_mode === "irc" && <p className="text-xs text-muted-foreground">Finishes ordered by corrected time (elapsed × TCC); boats need a TCC.</p>}
                {form.scoring_mode === "py" && <p className="text-xs text-muted-foreground">Finishes ordered by corrected time (elapsed × 1000 ÷ PY); boats need a PY number.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Year</Label><Input type="number" min="2000" max="2100" data-testid="series-year-input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Discards</Label><Input type="number" min="0" data-testid="series-discards-input" value={form.discards} onChange={(e) => setForm({ ...form, discards: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Planned races</Label><Input type="number" min="0" data-testid="series-planned-input" value={form.planned_races} onChange={(e) => setForm({ ...form, planned_races: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Order</Label><Input type="number" data-testid="series-order-input" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} /></div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 w-fit cursor-help"><Switch checked={form.included_in_overall} onCheckedChange={(v) => setForm({ ...form, included_in_overall: v })} data-testid="series-overall-switch" /><Label>Counts toward overall championship</Label></div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">This series' net scores are included in the class's overall championship table.</TooltipContent>
              </Tooltip>
              <div className="rounded-lg border border-border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="font-heading uppercase text-sm">Scoring rules <span className="text-muted-foreground font-body font-normal normal-case text-xs">({(form.scoring_config || defaultScoringConfig()).rrs_edition})</span></Label>
                </div>
                <p className="text-xs text-muted-foreground">Baseline is RRS 2025–2028 Appendix A Low Point. Alternatives are stored per season, so a change in future years never rewrites historical results.</p>
                <div className="space-y-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-fit cursor-help"><Label className="text-xs">A5 non-finishers scoring</Label></div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">How boats that do not finish are scored. A5.2 (default): every non-finish code scores series entries + 1. A5.3: boats that came to the start area score starters + 1. Finishers + 1: the RYA/Sailwave convention.</TooltipContent>
                  </Tooltip>
                  <Select value={form.scoring_config?.a5_convention || "a5_2"} onValueChange={(v) => patchCfg({ a5_convention: v })}>
                    <SelectTrigger className="h-9" data-testid="series-a5-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="a5_2">A5.2 default — DNC/DNS/… score series entries + 1</SelectItem>
                      <SelectItem value="a5_3">A5.3 — start-area boats score starters + 1 (DNC keeps series + 1)</SelectItem>
                      <SelectItem value="finishers">Finishers + 1 (RYA/Sailwave convention; DNC keeps series + 1)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-md border border-border/70 p-2.5 space-y-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 w-fit cursor-help"><Switch checked={!!form.scoring_config?.tle?.enabled} onCheckedChange={(v) => patchCfgNested("tle", { enabled: v })} data-testid="series-tle-switch" /><Label className="text-xs font-semibold">TLE — Time Limit Expired rule</Label></div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">When on, the race committee can record a boat as TLE when it fails to finish within the time limit. It scores per the method below — default: one more than the number of boats that finished the race.</TooltipContent>
                  </Tooltip>
                  {form.scoring_config?.tle?.enabled && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1"><Label className="text-xs">Time limit (minutes)</Label><Input type="number" min="1" className="h-8" value={form.scoring_config.tle.time_limit_minutes || ""} onChange={(e) => patchCfgNested("tle", { time_limit_minutes: e.target.value })} data-testid="series-tle-minutes" placeholder="e.g. 120" /></div>
                      <div className="space-y-1"><Label className="text-xs">TLE scoring method</Label>
                        <Select value={form.scoring_config?.tle?.method || "dnf"} onValueChange={(v) => patchCfgNested("tle", { method: v })}>
                          <SelectTrigger className="h-8" data-testid="series-tle-method"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dnf">Score as DNF (active A5 base)</SelectItem>
                            <SelectItem value="finishers_plus_1">Finishers + 1</SelectItem>
                            <SelectItem value="dnc">Series entries + 1</SelectItem>
                          </SelectContent>
                        </Select></div>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {["scp", "zfp"].map((key) => {
                    const p = form.scoring_config?.[key] || defaultScoringConfig()[key];
                    return (
                      <div key={key} className="rounded-md border border-border/70 p-2.5 space-y-2">
                        <Label className="text-xs font-semibold uppercase">{key} penalty</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1"><Label className="text-[10px] text-muted-foreground">Rule</Label>
                            <Select value={p.method} onValueChange={(v) => patchCfgNested(key, { method: v })}>
                              <SelectTrigger className="h-8" data-testid={`series-${key}-method`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="percent">% of DNF</SelectItem>
                                <SelectItem value="points">+ points</SelectItem>
                                <SelectItem value="places">+ places</SelectItem>
                              </SelectContent>
                            </Select></div>
                          <div className="space-y-1"><Label className="text-[10px] text-muted-foreground">{p.method === "percent" ? "% of DNF" : "Amount"}</Label><Input type="number" min="0" step="0.5" className="h-8" value={p.value} onChange={(e) => patchCfgNested(key, { value: e.target.value })} data-testid={`series-${key}-value`} /></div>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 w-fit cursor-help"><Switch checked={!!p.cap_dnf} onCheckedChange={(v) => patchCfgNested(key, { cap_dnf: v })} data-testid={`series-${key}-cap`} /><Label className="text-[11px]">Never worse than DNF</Label></div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">RRS 44.3(c)/30.2: the penalty can never give a boat a worse score than its DNF score would be.</TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-md border border-border/70 p-2.5 space-y-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 w-fit cursor-help"><Switch checked={!!form.scoring_config?.duty?.enabled} onCheckedChange={(v) => patchCfgNested("duty", { enabled: v })} data-testid="series-duty-switch" /><Label className="text-xs font-semibold">Duty / Average Points (OOD)</Label></div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">A boat on duty (OOD) scores the average of her results across every race in the series — DNC included, at its normal score — recalculated after every race before discards apply.</TooltipContent>
                  </Tooltip>
                  {form.scoring_config?.duty?.enabled && <p className="text-[11px] text-muted-foreground">A duty boat scores the average of her results across the series (DNC included), recalculated after every scored race before discards apply.</p>}
                </div>
                <div className="rounded-md border border-border/70 p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="w-fit cursor-help"><Label className="text-xs font-semibold">Discards</Label></div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">How many worst results are dropped from each boat's series total. Fixed uses the Discards field; increasing adds discards as more races are sailed (per the schedule below). A DNE can never be discarded.</TooltipContent>
                    </Tooltip>
                    <Select value={form.scoring_config?.discard_policy || "fixed"} onValueChange={(v) => patchCfg({ discard_policy: v })}>
                      <SelectTrigger className="h-8 w-44" data-testid="series-discard-policy"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed (use the Discards field)</SelectItem>
                        <SelectItem value="increasing">Increasing with races scored</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.scoring_config?.discard_policy === "increasing" ? (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-muted-foreground">Discard N after M races scored (e.g. 1 discard from the 6th race, 2 from the 9th).</p>
                      {(form.scoring_config.discard_schedule || []).map((step, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground shrink-0">after</span>
                          <Input type="number" min="1" className="h-8 w-20" value={step.after_races} onChange={(e) => {
                            const steps = (form.scoring_config.discard_schedule || []).map((s, j) => j === i ? { ...s, after_races: e.target.value } : s);
                            patchCfg({ discard_schedule: steps });
                          }} data-testid={`series-discard-after-${i}`} />
                          <span className="text-[11px] text-muted-foreground shrink-0">races, discard</span>
                          <Input type="number" min="0" className="h-8 w-16" value={step.discards} onChange={(e) => {
                            const steps = (form.scoring_config.discard_schedule || []).map((s, j) => j === i ? { ...s, discards: e.target.value } : s);
                            patchCfg({ discard_schedule: steps });
                          }} data-testid={`series-discard-step-${i}`} />
                          <Button type="button" size="sm" variant="ghost" className="text-destructive h-7" onClick={() => patchCfg({ discard_schedule: (form.scoring_config.discard_schedule || []).filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      ))}
                      <Button type="button" size="sm" variant="outline" data-testid="series-discard-step-add"
                        onClick={() => {
                          const steps = form.scoring_config.discard_schedule || [];
                          const last = steps[steps.length - 1];
                          patchCfg({ discard_schedule: [...steps, {
                            after_races: (Number(last?.after_races) || 0) + 3,
                            discards: last ? (Number(last.discards) || 0) + 1 : 1,
                          }] });
                        }}>
                        <Plus className="w-3.5 h-3.5" /> Add discard step
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Set the discard count in the Discards field above.</p>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3 space-y-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 w-fit cursor-help"><Switch checked={form.mini_series} onCheckedChange={(v) => setForm({ ...form, mini_series: v })} data-testid="series-mini-switch" /><Label className="font-heading uppercase text-sm">Split into mini series</Label></div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">Championships within a long series: each mini series has its own discards and standings, while the full series keeps its own discards and still counts toward the overall championship.</TooltipContent>
                </Tooltip>
                {form.mini_series && (
                  <>
                    <p className="text-xs text-muted-foreground">Give each mini series a name, pick which races it contains and set its own discards. A mini series can hold any number of races — scored either as <strong>one combined daily result</strong> or as separate races in the main series. The full series keeps its own discards and still counts toward the overall championship. On race day the race officer can also split a planned race into a mini series from their console.</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Races per mini</Label>
                        <Input type="number" min="1" className="h-8 w-16" value={autoSize} onChange={(e) => setAutoSize(e.target.value)} data-testid="series-mini-size-input" />
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={autoSplitMini} data-testid="series-auto-split-btn">Auto-split evenly</Button>
                      <Button type="button" size="sm" variant="outline" onClick={addMiniGroup} data-testid="add-mini-group-btn"><Plus className="w-3.5 h-3.5" /> Add mini series</Button>
                    </div>
                    {miniRaceTotal === 0 && <p className="text-xs text-muted-foreground">Set planned races (above) so you can pick which races belong to each mini series.</p>}
                    <div className="space-y-2">
                      {(form.mini_series_groups || []).map((g, gi) => (
                        <div key={gi} className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2" data-testid={`mini-group-${gi}`}>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1"><Label className="text-xs">Name</Label><Input className="h-8" value={g.name} onChange={(e) => patchMiniGroup(gi, { name: e.target.value })} placeholder={`Mini ${gi + 1}`} data-testid={`mini-name-${gi}`} /></div>
                            <div className="space-y-1"><Label className="text-xs">Discards</Label><Input type="number" min="0" className="h-8" value={g.discards} onChange={(e) => patchMiniGroup(gi, { discards: e.target.value })} data-testid={`mini-discards-${gi}`} /></div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Scoring treatment</Label>
                            <Select value={miniGroupScoring(g)} onValueChange={(v) => patchMiniGroup(gi, { scoring: v })}>
                              <SelectTrigger className="h-8" data-testid={`mini-scoring-${gi}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="additional">Count as extra races in the main series</SelectItem>
                                <SelectItem value="combined">Combine into one daily result</SelectItem>
                              </SelectContent>
                            </Select>
                            {miniGroupScoring(g) === "combined" && (
                              <p className="text-[11px] text-muted-foreground">The mini races combine into ONE main-series result: the group's discards apply first, then the average of the counting races becomes each sailor's score for the day. The series table shows a single combined column.</p>
                            )}
                          </div>
                          <div>
                            <Label className="text-xs">Races</Label>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {miniRaceTotal > 0 && Array.from({ length: miniRaceTotal }, (_, k) => k + 1).map((rn) => {
                                const on = (g.race_numbers || []).includes(rn);
                                return (
                                  <button key={rn} type="button"
                                    onClick={() => toggleMiniRace(gi, rn)}
                                    data-testid={`mini-race-${gi}-${rn}`}
                                    className={`px-2 py-1 rounded-md text-xs font-mono border transition-colors ${on ? "bg-ocean text-white border-ocean" : "bg-white dark:bg-card border-border text-muted-foreground hover:border-ocean/50"}`}>
                                    R{rn}
                                  </button>
                                );
                              })}
                              {miniRaceTotal === 0 && <span className="text-xs text-muted-foreground italic">No races defined yet.</span>}
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-muted-foreground">{g.race_numbers?.length || 0} race{(g.race_numbers?.length || 0) !== 1 ? "s" : ""} selected</span>
                            <Button type="button" size="sm" variant="ghost" className="text-destructive h-7" onClick={() => removeMiniGroup(gi)} data-testid={`remove-mini-group-${gi}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </div>
                      ))}
                      {!(form.mini_series_groups || []).length && <p className="text-xs text-muted-foreground italic">No mini series yet — auto-split or add one.</p>}
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="font-heading uppercase text-sm">Race schedule</Label>
                  <div className="flex items-center gap-2">
                    <Input type="date" value={schedStart} onChange={(e) => setSchedStart(e.target.value)} className="h-8 w-36" data-testid="sched-start-input" />
                    <Button type="button" size="sm" variant="outline" onClick={genSchedule} data-testid="gen-schedule-btn">Auto-fill Sat.</Button>
                  </div>
                </div>
                {!editing && <p className="text-xs text-muted-foreground">Save the series first, then re-open to set dates.</p>}
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {(form.schedule || []).map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="font-mono text-xs w-7 text-muted-foreground">R{i + 1}</span>
                      <Input type="date" value={d || ""} onChange={(e) => setSchedDate(i, e.target.value)} className="h-8" data-testid={`sched-date-${i + 1}`} />
                    </div>
                  ))}
                  {!(form.schedule || []).length && <p className="col-span-2 text-xs text-muted-foreground">No dates yet — set planned races then auto-fill.</p>}
                </div>
              </div>
            </div>
            <DialogFooter><Button onClick={save} data-testid="save-series-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-xl border overflow-hidden overflow-x-auto">
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Order</TableHead><TableHead>Series</TableHead><TableHead>Class</TableHead><TableHead>Regatta</TableHead><TableHead>Year</TableHead><TableHead>Scoring</TableHead>              <TableHead>Discards</TableHead><TableHead>Planned</TableHead><TableHead>In overall</TableHead><TableHead>Scoring rules</TableHead><TableHead>Mini</TableHead><TableHead>Season</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{series.map((s) => {
            const cfg = scoringConfigFromSeries(s);
            const locked = s.lock_status === "locked" || s.lock_status === "archived";
            return (
            <TableRow key={s.id} data-testid={`series-row-${s.name}`}>
              <TableCell className="font-mono">{s.order}</TableCell>
              <TableCell className="font-heading text-lg uppercase tracking-tight">{s.name}</TableCell>
              <TableCell className="text-sm">{classes.find((c) => c.id === s.class_id)?.name || "Unknown class"}</TableCell>
              <TableCell>{s.regatta_id ? <Badge className="gap-1 bg-ocean/10 text-ocean border border-ocean/30"><CalendarDays className="w-3 h-3" />{(regattas.find((r) => r.id === s.regatta_id) || {}).name || "Competition"}</Badge> : <Badge variant="outline" className="text-muted-foreground">Standalone series</Badge>}</TableCell>
              <TableCell className="font-mono">{s.year || "—"}</TableCell>
              <TableCell>{s.scoring_mode === "irc" ? <Badge className="bg-indigo-100 text-indigo-800">IRC</Badge> : s.scoring_mode === "py" ? <Badge className="bg-emerald-100 text-emerald-800">PY</Badge> : <Badge variant="outline">One-design</Badge>}</TableCell>
              <TableCell className="font-mono">{s.discards}</TableCell>
              <TableCell className="font-mono">{s.planned_races || "—"}</TableCell>
              <TableCell><Switch checked={s.included_in_overall} onCheckedChange={(v) => quickSet(s, { included_in_overall: v })} data-testid={`overall-toggle-${s.name}`} /></TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-44">
                <span className="font-mono">{cfg.a5_convention.toUpperCase()}</span>
                {cfg.tle?.enabled && <span className="text-amber-700 font-semibold"> · TLE</span>}
                <span className="text-[10px] block">SCP {cfg.scp.value}{cfg.scp.method === "percent" ? "%" : ""} · ZFP {cfg.zfp.value}{cfg.zfp.method === "percent" ? "%" : ""} · {cfg.discard_policy === "increasing" ? "incr. discards" : `${s.discards} discard${s.discards === 1 ? "" : "s"}`}</span>
              </TableCell>
              <TableCell>{s.mini_series ? <Badge className="bg-purple-100 text-purple-800">{s.mini_series_groups?.length || 0} mini series</Badge> : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
              <TableCell>
                {s.lock_status === "archived" ? <Badge className="bg-slate-700 text-white gap-1"><Archive className="w-3 h-3" /> Archived v{s.lock_version || 1}</Badge>
                  : locked ? <Badge className="bg-emerald-600 text-white gap-1"><ShieldCheck className="w-3 h-3" /> Locked v{s.lock_version || 1}</Badge>
                  : <Badge variant="outline" className="text-muted-foreground">Open</Badge>}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button size="icon" variant="ghost" disabled={locked} title="Boats in this series" data-testid={`series-boats-${s.name}`} onClick={() => setBoatsSeries(s)}><Users className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" disabled={locked} onClick={() => { setEditing(s.id); setForm({ name: s.name, class_id: s.class_id, year: s.year, scoring_mode: s.scoring_mode || "one_design", discards: s.discards, included_in_overall: s.included_in_overall, use_a5_3: !!s.use_a5_3, use_finishers: !!s.use_finishers, mini_series: !!s.mini_series, mini_series_groups: (s.mini_series_groups || []).map((g) => ({ name: g.name || "", race_numbers: g.race_numbers || [], discards: g.discards || 0, scoring: (g && (g.scoring === "combined" ? "combined" : "additional")) })), order: s.order, planned_races: s.planned_races || 0, schedule: s.schedule || [], scoring_config: scoringConfigFromSeries(s), regatta_id: s.regatta_id || "" }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" title="Snapshot history" data-testid={`snapshots-${s.name}`} onClick={() => { setSnapSeries(s); api.getSeriesSnapshots(s.id, clubId).then(setSnapshots).catch(() => setSnapshots([])); }}><Archive className="w-4 h-4" /></Button>
                {locked ? (
                  <>
                    {s.lock_status === "locked" && (
                      <Button size="sm" variant="outline" className="text-slate-700 border-slate-400/60 h-8 dark:text-slate-300 dark:border-slate-500/60" data-testid={`archive-${s.name}`} onClick={() => { setLockDialog({ mode: "archive", series: s }); setLockReason(""); }}>Archive</Button>
                    )}
                    <Button size="sm" variant="outline" className="text-amber-700 border-amber-400/60 h-8" data-testid={`unlock-${s.name}`} onClick={() => { setLockDialog({ mode: "unlock", series: s }); setLockReason(""); }}>Unlock</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-500/60 h-8" data-testid={`lock-${s.name}`} onClick={() => { setLockDialog({ mode: "lock", series: s }); setLockReason(""); }}>Lock season</Button>
                )}
                <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-series-${s.name}`} onClick={() => del(s.id)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>
          );})}
            {!series.length && <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-6">No series for this year. Try another year or class.</TableCell></TableRow>}
          </TableBody></Table>
      </div>

      {/* Lock / unlock confirmation (admin-only, reason recorded in audit) */}
      <Dialog open={!!lockDialog} onOpenChange={(o) => { if (!o) setLockDialog(null); }}>
        <DialogContent data-testid="lock-dialog">
          <DialogHeader><DialogTitle className="font-heading uppercase">{
            lockDialog?.mode === "lock" ? "Lock season — results become final" :
            lockDialog?.mode === "archive" ? "Archive season — results become permanent" :
            "Open season for correction"
          }</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {lockDialog?.mode === "lock"
                ? <>This captures the season's results, scoring rules, TLE rule, discards, penalties and rankings into an immutable snapshot. Future rule or engine changes will never alter them. Re-locking after a correction creates a new version (the previous one is preserved).</>
                : lockDialog?.mode === "archive"
                ? <>This moves the locked season to the terminal ARCHIVED state. Archived results are served from their frozen snapshot forever; only the audited administrator unlock-for-correction flow can open them again.</>
                : <>This opens the season for an administrator-only correction. The last locked snapshot is preserved; re-locking records exactly what changed in a new version.</>}
            </p>
            <div className="space-y-1.5"><Label>Reason (recorded in the audit trail)</Label><Input data-testid="lock-reason-input" value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder="e.g. Season finalised — 2026 results" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockDialog(null)}>Cancel</Button>
            <Button className={lockDialog?.mode === "lock" ? "bg-emerald-600 hover:bg-emerald-700" : lockDialog?.mode === "archive" ? "bg-slate-700 hover:bg-slate-800" : "bg-amber-600 hover:bg-amber-700"} disabled={lockBusy || !lockReason.trim()} data-testid="lock-confirm-btn"
              onClick={async () => {
                setLockBusy(true);
                try {
                  const { mode, series: s2 } = lockDialog;
                  const body = mode === "lock" ? await api.lockSeries(s2.id, lockReason.trim(), s2.version)
                    : mode === "archive" ? await api.archiveSeries(s2.id, lockReason.trim(), s2.version)
                    : await api.unlockSeries(s2.id, lockReason.trim(), s2.version);
                  toast.success(mode === "lock" ? `Season locked (version ${body.version || 1}) — results are final`
                    : mode === "archive" ? "Season archived — results are now permanent"
                    : "Season opened for correction");
                  setLockDialog(null); load();
                } catch (e) {
                  if (e.response?.status === 409) toast.error("This season was changed by another user. Reload the series list before locking or unlocking again.");
                  else toast.error(e.response?.data?.detail || "Could not update season lock");
                } finally { setLockBusy(false); }
              }}>
              {lockDialog?.mode === "lock" ? "Lock season" : lockDialog?.mode === "archive" ? "Archive season" : "Open for correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Snapshot history */}
      <Dialog open={!!snapSeries} onOpenChange={(o) => { if (!o) setSnapSeries(null); }}>
        <DialogContent data-testid="snapshots-dialog">
          <DialogHeader><DialogTitle className="font-heading uppercase">Snapshot history — {snapSeries?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {!snapshots.length && <p className="text-sm text-muted-foreground">This season has not been locked yet.</p>}
            {snapshots.map((s) => (
              <div key={s.version} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading uppercase text-sm">Version {s.version} <Badge className={s.status === "locked" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300"}>{s.status}</Badge></span>
                  <span className="font-mono text-xs text-muted-foreground">{new Date(s.locked_at).toLocaleString()}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Locked by <span className="font-semibold">{s.locked_by}</span> · engine {s.engine_version} · {s.scoring_config?.rrs_edition}</div>
                {s.amendment && s.amendment.changes?.length > 0 && (
                  <div className="mt-2 text-xs">
                    <div className="font-semibold text-amber-700">Amended — {s.amendment.changes.length} standings change{s.amendment.changes.length === 1 ? "" : "s"}:</div>
                    <ul className="list-disc pl-4 text-muted-foreground mt-1">
                      {s.amendment.changes.slice(0, 8).map((c, i) => (
                        <li key={i} className="font-mono">{c.boat_id}: rank {c.rank_before ?? "—"} → {c.rank_after ?? "—"} (net {c.net_before ?? "—"} → {c.net_after ?? "—"})</li>
                      ))}
                      {s.amendment.changes.length > 8 && <li>…and {s.amendment.changes.length - 8} more</li>}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Series membership: which of the class's boats form part of this
          series (drives the DNC scoring engine). */}
      <SeriesBoatsDialog series={boatsSeries} open={!!boatsSeries} clubId={clubId}
        onOpenChange={(o) => { if (!o) setBoatsSeries(null); }} onSaved={load} />
    </div>
  );
}

/* ---------------- Historic Results ---------------- */
function NoticeManagementTab({ clubId }) {
  const navigate = useNavigate();
  const [notices, setNotices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [areaName, setAreaName] = useState("");
  const [areas, setAreas] = useState(["Club Notices", "Open Event Notices"]);
  const load = useCallback(() => {
    if (!clubId) return;
    api.getNotices({ club_id: clubId }).then(setNotices).catch(() => setNotices([]));
  }, [clubId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (clubId) api.getNoticeAreas(clubId).then((items) => setAreas((items || []).map((item) => item.title))).catch(() => {}); }, [clubId]);
  const addArea = async () => {
    const value = areaName.trim();
    if (!value) return toast.error("Enter a name for the notice area");
    if (areas.some((area) => area.toLowerCase() === value.toLowerCase())) return toast.error("That notice area already exists");
    const nextAreas = [...areas, value];
    setAreas(nextAreas);
    setAreaName("");
    try {
      const current = await api.getClubs();
      const club = (current || []).find((item) => item.id === clubId);
      await api.updateClubSettings(clubId, {
        race_day_notices: club?.race_day_notices !== false,
        official_notice_board: club?.official_notice_board !== false,
        notice_areas: nextAreas.filter((area) => !["Club Notices", "Open Event Notices"].includes(area)),
      });
      toast.success("Notice area added");
    } catch (e) {
      setAreas(areas);
      toast.error(e.response?.data?.detail || "Could not save notice area");
    }
  };
  const removeArea = async (area) => {
    if (!window.confirm(`Remove the notice area “${area}” from this club? Existing notices in it remain on the board.`)) return;
    try {
      await api.deleteNoticeArea(clubId, area);
      setAreas(areas.filter((a) => a !== area));
      toast.success("Notice area removed");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not remove notice area");
    }
  };
  const edit = async (notice) => {
    const title = window.prompt("Correct notice title", notice.title || "");
    if (title === null) return;
    try {
      await api.updateNotice(notice.id, { title }, notice.version);
      toast.success("Notice corrected and versioned");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not edit notice");
    }
  };
  const remove = async (notice) => {
    if (!window.confirm(`Remove “${notice.title}” from the Official Notice Board? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteNotice(notice.id, notice.version);
      toast.success("Notice removed from the Official Notice Board");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not remove notice");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3" data-testid="notice-management">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-2xl uppercase tracking-tighter">Official Notice Board</h2><p className="text-sm text-muted-foreground">Create, view and remove notices from this club’s public ONB.</p></div>
        <Button className="gap-1.5" onClick={() => navigate(`/notice/new?club=${clubId}`)} data-testid="create-notice-btn"><FileText className="w-4 h-4" /> New Notice</Button>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="notice-area-manager">
        <div><h3 className="font-heading uppercase">Notice areas</h3><p className="text-xs text-muted-foreground">Create additional areas for this club’s ONB. Race Admins and Race Officers can choose them when posting.</p></div>
        <div className="flex flex-wrap gap-2">{areas.map((area) =>
          <Badge key={area} variant="outline" className="gap-1.5 pr-1">
            {area}
            {!["Club Notices", "Open Event Notices"].includes(area) && (
              <button type="button" title={`Remove “${area}”`} aria-label={`Remove notice area ${area}`} data-testid={`remove-notice-area-${area}`} className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive" onClick={() => removeArea(area)}><X className="w-3.5 h-3.5" /></button>
            )}
          </Badge>
        )}</div>
        <div className="flex gap-2"><Input value={areaName} onChange={(e) => setAreaName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addArea(); }} placeholder="e.g. Regatta Notices" data-testid="new-notice-area-input" /><Button type="button" onClick={addArea} data-testid="add-notice-area-btn"><Plus className="w-4 h-4" /> Add area</Button></div>
      </div>
      {!notices.length && <p className="text-sm text-muted-foreground rounded-xl border border-dashed p-6 text-center">No notices are currently listed.</p>}
      {notices.length > 0 && (() => {
        const grouped = notices.reduce((map, notice) => { const key = notice.heading || notice.publication_area || "Club Notices"; (map[key] ||= []).push(notice); return map; }, {});
        const ordered = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
        return <Accordion type="multiple" defaultValue={ordered} data-testid="notice-area-management-groups">
          {ordered.map((area) => <AccordionItem key={area} value={area} className="rounded-xl border border-border bg-card px-4 mb-3">
            <AccordionTrigger className="font-heading uppercase tracking-tight hover:no-underline" data-testid={`notice-area-group-${area}`}>{area} <span className="ml-2 text-xs font-normal text-muted-foreground">({grouped[area].length})</span></AccordionTrigger>
            <AccordionContent><div className="space-y-2">{grouped[area].map((notice) => <div key={notice.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"><div className="flex-1 min-w-0"><div className="font-heading uppercase tracking-tight">{notice.notice_type_label || notice.notice_type}</div><div className="font-semibold truncate">{notice.title}</div><div className="text-xs text-muted-foreground">No. {notice.notice_number} · {notice.status}</div></div><Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => edit(notice)} data-testid={`edit-notice-${notice.id}`}><Pencil className="w-4 h-4" /> Edit</Button><Button size="sm" variant="outline" className="gap-1.5 text-destructive border-destructive/40" disabled={busy} onClick={() => remove(notice)} data-testid={`remove-notice-${notice.id}`}><Trash2 className="w-4 h-4" /> Remove</Button></div>)}</div></AccordionContent>
          </AccordionItem>)}
        </Accordion>;
      })()}
    </section>
  );
}

function HistoricTab({ classes, rrsCodes, clubId }) {
  const [classId, setClassId] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const { seasonYears } = useSeasonYears(clubId);
  const yearChoices = ["all", ...withSeasonYears(YEAR_OPTIONS, seasonYears)];
  const [seriesList, setSeriesList] = useState([]);
  const [seriesId, setSeriesId] = useState("");
  const [races, setRaces] = useState([]);
  const [race, setRace] = useState(null);
  const [boats, setBoats] = useState({});
  const [lockDialog, setLockDialog] = useState(null);
  const [lockReason, setLockReason] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  // RDG / DPI committee decision: the engine never infers these scores, so
  // the resulting points (and optional decision details) are collected here
  // before the code change is sent. null = panel closed.
  const [decision, setDecision] = useState(null);
  const openDecision = (r, code) => {
    const prefix = code.toLowerCase();
    // Only pre-fill points when re-editing an existing RDG/DPI decision — a
    // fresh one starts empty so the committee's score can never default to 0.
    const existing = r.code === code;
    setDecision({
      boatId: r.boat_id,
      code,
      penalty_points: existing ? (r.penalty_points ?? "") : "",
      reason: r[`${prefix}_reason`] || "",
      decision_maker: r[`${prefix}_decision_maker`] || "",
      date: r[`${prefix}_date`] || "",
      notes: r[`${prefix}_notes`] || "",
    });
  };
  const saveDecision = async () => {
    if (!decision) return;
    const pts = Number(decision.penalty_points);
    if (Number.isNaN(pts) || decision.penalty_points === "") {
      return toast.error(`${decision.code} requires the committee-entered points — the system will not guess a score`);
    }
    const prefix = decision.code.toLowerCase();
    const payload = { code: decision.code, penalty_points: pts };
    ["reason", "decision_maker", "date", "notes"].forEach((k) => {
      const v = (decision[k] || "").trim();
      if (v) payload[`${prefix}_${k}`] = v;
    });
    const boatId = decision.boatId;
    setDecision(null);
    await change(boatId, payload);
  };

  useEffect(() => { if (!classId && classes.length) setClassId("all"); }, [classes]); // eslint-disable-line
  // Reset filters only when the club actually changes — not on first mount,
  // or the reset would clobber the auto-selected first class above.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setClassId(""); setSeriesId(""); setRace(null); setYearFilter("all");
  }, [clubId]);
  useEffect(() => {
    if (classId) {
      const cparams = clubId ? { club_id: clubId } : {};
      const seriesParams = { ...(yearFilter !== "all" ? { year: yearFilter } : {}), ...cparams };
      if (classId !== "all") seriesParams.class_id = classId;
      api.getSeries(seriesParams).then(setSeriesList);
      const boatParams = { ...cparams };
      if (classId !== "all") boatParams.class_id = classId;
      api.getBoats(boatParams).then((bs) => { const m = {}; bs.forEach((b) => (m[b.id] = b)); setBoats(m); });
    }
  }, [classId, yearFilter, clubId]);
  useEffect(() => { if (seriesId) api.getRaces({ series_id: seriesId, ...(clubId ? { club_id: clubId } : {}) }).then(setRaces); }, [seriesId, clubId]);

  const openRace = async (id) => setRace(await api.getRace(id));
  const change = async (boatId, patch) => {
    try {
      const r = await api.adjustResult(race.id, boatId, patch, race.version);
      setRace(r); toast.success("Result updated");
    } catch (e) {
      if (e.response?.status === 409) {
        toast.error("This result has been changed by another user. Reload the latest results before making further changes.");
        setRace(await api.getRace(race.id));
      } else toast.error(e.response?.data?.detail || "Could not update result");
    }
  };
  const setStatus = async (s) => {
    try {
      await api.setStatus(race.id, s, race.version);
    } catch (e) {
      if (e.response?.status === 409) {
        toast.error("This result has been changed by another user. Reload the latest results before making further changes.");
        setRace(await api.getRace(race.id));
        return;
      }
      return toast.error(e.response?.data?.detail || "Could not change status");
    }
    const r = await api.getRace(race.id);
    setRace(r);
    api.getRaces({ series_id: seriesId }).then(setRaces);
    toast.success(s === "setup" ? "Result recalled — race rolled back to setup" : s === "published" ? "Results re-published" : `Marked ${s}`);
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">Correct any historic result. Changes recompute standings immediately.</p>
      <div className="flex flex-wrap gap-3 mb-4">
        <Select value={classId} onValueChange={(v) => { setClassId(v); setSeriesId(""); setRace(null); }}>
          <SelectTrigger className="w-40" data-testid="hist-class"><SelectValue placeholder="Class" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(yearFilter)} onValueChange={(v) => { setYearFilter(v === "all" ? "all" : Number(v)); setSeriesId(""); setRace(null); }}>
          <SelectTrigger className="w-32" data-testid="hist-year"><SelectValue /></SelectTrigger>
          <SelectContent>{yearChoices.map((y) => <SelectItem key={y} value={String(y)}>{y === "all" ? "All years" : y}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={seriesId} onValueChange={(v) => { setSeriesId(v); setRace(null); }}>
          <SelectTrigger className="w-48" data-testid="hist-series"><SelectValue placeholder="Series" /></SelectTrigger>
          <SelectContent>{seriesList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {seriesId && (() => {
        const sel = seriesList.find((s) => s.id === seriesId);
        const locked = sel && (sel.lock_status === "locked" || sel.lock_status === "archived");
        const archived = sel?.lock_status === "archived";
        return (
          <>
            {sel && (
              <div className={`rounded-xl border p-3 mb-4 flex flex-wrap items-center justify-between gap-3 ${archived ? "border-slate-600 bg-slate-100 dark:bg-slate-800/40 dark:border-slate-500" : locked ? "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/50" : "border-border bg-muted/40"}`} data-testid="hist-lock-banner">
                <div className="flex items-center gap-2 text-sm">
                  {archived ? <Archive className="w-4 h-4 text-slate-700 dark:text-slate-300" /> : locked ? <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" /> : <Anchor className="w-4 h-4 text-muted-foreground" />}
                  <span className="font-semibold">{archived ? "Season archived — results are permanent" : locked ? "Season locked — results are final" : "Season open"}</span>
                  {locked && <span className="text-xs text-muted-foreground">v{sel.lock_version || 1} · locked by {sel.locked_by || "—"} · results are served from the saved snapshot and cannot be changed through normal editing.</span>}
                </div>
                <div className="flex items-center gap-2">
                  {locked && (
                    <>
                      {!archived && (
                        <Button size="sm" variant="outline" className="border-slate-600 text-slate-700 h-8 dark:border-slate-500 dark:text-slate-300" data-testid="hist-archive-btn"
                          onClick={() => { setLockDialog("archive"); setLockReason(""); }}>Archive</Button>
                      )}
                      <Button size="sm" variant="outline" className="border-amber-500 text-amber-700 h-8" data-testid="hist-unlock-btn"
                        onClick={() => { setLockDialog("unlock"); setLockReason(""); }}>Open for correction</Button>
                    </>
                  )}
                  {!locked && (
                    <Button size="sm" variant="outline" className="border-emerald-500 text-emerald-700 h-8" data-testid="hist-lock-btn"
                      onClick={() => { setLockDialog("lock"); setLockReason(""); }}>Lock season (finalise)</Button>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-4">
              {races.map((r) => (
                <Button key={r.id} variant={race?.id === r.id ? "default" : "outline"} size="sm" data-testid={`hist-race-${r.id}`}
                  className={race?.id === r.id ? "bg-ocean" : ""} onClick={() => openRace(r.id)}>
                  R{r.race_number} · {fmtDate(r.date)} · {r.status}
                </Button>
              ))}
              {!races.length && <p className="text-sm text-muted-foreground">No races in this series.</p>}
            </div>
          </>
        );
      })()}

      {/* Lock / unlock / archive confirmation (historic results tab) */}
      <Dialog open={!!lockDialog} onOpenChange={(o) => { if (!o) setLockDialog(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-heading uppercase">{
            lockDialog === "lock" ? "Lock season — results become final" :
            lockDialog === "archive" ? "Archive season — results become permanent" :
            "Open season for correction"
          }</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {lockDialog === "lock"
                ? "The current results, scoring rules, discards, penalties and rankings are captured into an immutable snapshot. Re-locking after a correction creates a new version — the previous one is always preserved."
                : lockDialog === "archive"
                ? "The locked season moves to the terminal ARCHIVED state. Its results are served from the frozen snapshot forever; only the audited administrator unlock-for-correction flow can open them again."
                : "Only continue to fix a genuine scoring error. The last locked snapshot is preserved; re-locking records exactly what changed."}
            </p>
            <div className="space-y-1.5"><Label>Reason (recorded in the audit trail)</Label><Input value={lockReason} onChange={(e) => setLockReason(e.target.value)} data-testid="hist-lock-reason" placeholder={lockDialog === "lock" ? "e.g. 2026 season finalised" : "e.g. Position error in race 4"} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockDialog(null)}>Cancel</Button>
            <Button className={lockDialog === "lock" ? "bg-emerald-600 hover:bg-emerald-700" : lockDialog === "archive" ? "bg-slate-700 hover:bg-slate-800" : "bg-amber-600 hover:bg-amber-700"} disabled={lockBusy || !lockReason.trim()} data-testid="hist-lock-confirm"
              onClick={async () => {
                setLockBusy(true);
                try {
                  const sel = seriesList.find((s) => s.id === seriesId);
                  const body = lockDialog === "lock" ? await api.lockSeries(seriesId, lockReason.trim(), sel?.version)
                    : lockDialog === "archive" ? await api.archiveSeries(seriesId, lockReason.trim(), sel?.version)
                    : await api.unlockSeries(seriesId, lockReason.trim(), sel?.version);
                  toast.success(lockDialog === "lock" ? `Season locked (version ${body.version || 1})`
                    : lockDialog === "archive" ? "Season archived — results are now permanent"
                    : "Season opened for correction — fix the results, then re-lock");
                  setLockDialog(null);
                  const refreshParams = { ...(yearFilter !== "all" ? { year: yearFilter } : {}), ...(clubId ? { club_id: clubId } : {}) };
                  if (classId !== "all") refreshParams.class_id = classId;
                  api.getSeries(refreshParams).then(setSeriesList);
                } catch (e) {
                  if (e.response?.status === 409) toast.error("This season was changed by another user. Reload the series list before locking or unlocking again.");
                  else toast.error(e.response?.data?.detail || "Could not update season lock");
                } finally { setLockBusy(false); }
              }}>
              {lockDialog === "lock" ? "Lock season" : lockDialog === "archive" ? "Archive season" : "Open for correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {race && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Race {race.race_number} · {fmtDate(race.date)}</span>
              <Badge className={race.status === "published" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : race.status === "provisional" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300"}>{race.status}</Badge>
              {race.abandoned && <Badge className="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">Abandoned</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {race.status === "published" ? (
                <Button size="sm" variant="outline" className="border-amber-500 text-amber-700 gap-1.5" data-testid="hist-recall-btn"
                  onClick={() => { if (window.confirm("Recall this published result and roll the race back to setup? It will be removed from the public results page until re-published.")) setStatus("setup"); }}>
                  <RotateCcw className="w-4 h-4" /> Recall to setup
                </Button>
              ) : (
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" data-testid="hist-publish-btn" onClick={() => setStatus("published")}>
                  <Send className="w-4 h-4" /> Publish
                </Button>
              )}
            </div>
          </div>
          <div className="rounded-xl border overflow-hidden overflow-x-auto">
          <Table data-testid="hist-results-table"><TableHeader><TableRow className="bg-muted"><TableHead>Boat</TableHead><TableHead>Position</TableHead><TableHead>Elapsed</TableHead><TableHead>Code</TableHead></TableRow></TableHeader>
            <TableBody>{[...race.results].sort((a, b) => (a.code === "FINISHED" && b.code === "FINISHED") ? a.position - b.position : a.code === "FINISHED" ? -1 : 1).map((r) => {
              const b = boats[r.boat_id] || {};
              return (
                <TableRow key={r.boat_id} data-testid={`hist-row-${b.sail_no}`}>
                  <TableCell className="font-semibold">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span></TableCell>
                  <TableCell>{r.code === "FINISHED"
                    ? <Input type="number" min="1" defaultValue={r.position || ""} className="h-8 w-20 font-mono" data-testid={`hist-pos-${b.sail_no}`} onBlur={(e) => change(r.boat_id, { position: Number(e.target.value) })} />
                    : <Badge variant="outline" className={CODE_COLORS[r.code]}>{r.code}{"RDG" === r.code || "DPI" === r.code ? (r.penalty_points != null && r.penalty_points !== "" ? ` · ${r.penalty_points} pts` : " · points?") : ""}</Badge>}</TableCell>
                  <TableCell>{r.code === "FINISHED"
                    ? <ElapsedInput finishTime={r.finish_time} race={race} onCommit={(secs) => change(r.boat_id, { elapsed_seconds: secs })} data-testid={`hist-elapsed-${b.sail_no}`} className="[&_input]:w-12" />
                    : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <Select value={r.code} onValueChange={(v) => (v === "RDG" || v === "DPI") ? openDecision(r, v) : change(r.boat_id, { code: v })}>
                      <SelectTrigger className="h-8 w-28" data-testid={`hist-code-${b.sail_no}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{rrsCodes.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}</TableBody></Table>
          </div>
        </div>
      )}

      {/* RDG / DPI committee decision dialog (historic results tab) */}
      <Dialog open={!!decision} onOpenChange={(o) => { if (!o) setDecision(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-heading uppercase">{decision?.code === "RDG" ? "Redress (RDG) — committee score" : "Discretionary penalty (DPI) — committee score"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">The scoring engine will not infer this score. Enter the resulting points the committee awards — every other boat's result is left exactly as it is.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Resulting points *</Label><Input type="number" min="0" step="0.5" value={decision?.penalty_points ?? ""} onChange={(e) => setDecision({ ...decision, penalty_points: e.target.value })} placeholder="e.g. 4.5" data-testid="hist-decision-points" autoFocus /></div>
              <div className="space-y-1.5"><Label>Decision date</Label><Input type="date" value={decision?.date || ""} onChange={(e) => setDecision({ ...decision, date: e.target.value })} data-testid="hist-decision-date" /></div>
            </div>
            <div className="space-y-1.5"><Label>Reason (basis of the decision)</Label><Input value={decision?.reason || ""} onChange={(e) => setDecision({ ...decision, reason: e.target.value })} placeholder="e.g. Interference from a boat not racing (RRS 62.1(a))" data-testid="hist-decision-reason" /></div>
            <div className="space-y-1.5"><Label>Decision maker</Label><Input value={decision?.decision_maker || ""} onChange={(e) => setDecision({ ...decision, decision_maker: e.target.value })} placeholder="e.g. Protest Committee" data-testid="hist-decision-maker" /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Input value={decision?.notes || ""} onChange={(e) => setDecision({ ...decision, notes: e.target.value })} data-testid="hist-decision-notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button disabled={decision?.penalty_points === "" || Number.isNaN(Number(decision?.penalty_points))} onClick={saveDecision} data-testid="hist-decision-save">Record decision</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Admin() {
  const { role, clubId: authClubId, clubName: authClubName } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isWebmaster = role === "webmaster";
  const initialTab = isWebmaster ? (searchParams.get("tab") || "boats") : "boats";
  const clubParam = searchParams.get("club");
  const [clubs, setClubs] = useState([]);

  // Every role loads the club list so the console can link back to the
  // public results page (the auth session only carries the club id/name).
  useEffect(() => {
    api.getClubs().then((cs) => setClubs(cs || [])).catch(() => {});
  }, []);

  // Club staff already have a scoped club in their session. Webmasters must
  // choose a club before the console can load club-scoped data — the ClubPicker
  // branch below handles that, so the console is "ready" once the role is known
  // (a webmaster without ?club= should see the picker, not a loading spinner).
  const clubId = isWebmaster ? (clubParam || null) : authClubId;
  const readyForClub = role !== undefined && role !== null && (isWebmaster || !!authClubId);
  const clubName = isWebmaster
    ? (clubs.find((c) => c.id === clubParam)?.name || null)
    : (authClubName || null);
  const clubSlug = isWebmaster
    ? (clubs.find((c) => c.id === clubParam)?.slug || null)
    : (clubs.find((c) => c.id === authClubId)?.slug || null);

  const [classes, setClasses] = useState([]);
  const [rrsCodes, setRrsCodes] = useState([]);
  const reloadClasses = useCallback(() => api.getClasses(clubId ? { club_id: clubId } : {}).then(setClasses), [clubId]);
  useEffect(() => { reloadClasses(); api.rrsCodes().then(setRrsCodes); }, [reloadClasses]);

  const switchClub = isWebmaster ? () => setSearchParams({}) : null;

  // Club options for the boat form: the webmaster sees every club (override
  // allowed); club staff only ever see their own club.
  const boatClubs = isWebmaster ? clubs : (clubId && clubName ? [{ id: clubId, name: clubName }] : []);

  if (role === undefined || (role && !readyForClub)) {
    return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading club console…</div>;
  }

  if (role === null) return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Redirecting to login…</div>;

  if (isWebmaster && !clubParam) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar />
        <ClubPicker
          title="Race Admin console"
          subtitle="Pick the club whose fleet and season you're managing."
          onPick={(c) => setSearchParams({ club: c.id })}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar clubName={clubName} onSwitchClub={switchClub} clubSlug={clubSlug} />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
          <div>
            <h1 className="text-3xl uppercase tracking-tighter">Admin console</h1>
            <p className="text-muted-foreground text-sm">Manage the fleet, season structure and historic scoring.</p>
          </div>
          <Button
            variant="outline"
            className="gap-2 border-ocean text-ocean hover:bg-ocean hover:text-white"
            data-testid="admin-backup-btn"
            onClick={() => api.downloadBackup(clubId, false).catch(
              (e) => toast.error(e.response?.data?.detail || "Backup download failed")
            )}
          >
            <Archive className="w-4 h-4" /> Download backup
          </Button>
        </div>
        <div className="mb-6" />
        {clubId && <ClubIconField clubId={clubId} />}
        {clubId && <ClubNoticeToggle clubId={clubId} />}
        <Tabs defaultValue={initialTab}>
          {/* The tab bar stays a single row: on narrow screens it scrolls
              horizontally instead of wrapping into a tall stack of tabs. */}
          <div className="overflow-x-auto -mb-1 pb-1" data-testid="admin-tabs-wrap">
            <TabsList className="h-auto w-max min-w-full gap-1" data-testid="admin-tabs">
              <TabsTrigger value="classes" data-testid="tab-classes" className="gap-1.5 py-1.5"><Layers className="w-4 h-4" /> Classes</TabsTrigger>
              <TabsTrigger value="boats" data-testid="tab-boats" className="gap-1.5 py-1.5"><Sailboat className="w-4 h-4" /> Boats</TabsTrigger>
              <TabsTrigger value="series" data-testid="tab-series" className="gap-1.5 py-1.5"><Trophy className="w-4 h-4" /> Series</TabsTrigger>
              <TabsTrigger value="regattas" data-testid="tab-regattas" className="gap-1.5 py-1.5"><CalendarDays className="w-4 h-4" /> Regattas</TabsTrigger>
              <TabsTrigger value="notices" data-testid="tab-notices" className="gap-1.5 py-1.5"><FileText className="w-4 h-4" /> Notice Board</TabsTrigger>
              <div className="w-px h-5 bg-border mx-1 shrink-0" aria-hidden />
              <TabsTrigger value="historic" data-testid="tab-historic" className="gap-1.5 py-1.5"><Archive className="w-4 h-4" /> Historic Results</TabsTrigger>
              <div className="w-px h-5 bg-border mx-1 shrink-0" aria-hidden />
              <TabsTrigger value="users" data-testid="tab-users" className="gap-1.5 py-1.5"><Users className="w-4 h-4" /> Logins</TabsTrigger>
              <TabsTrigger value="subscriptions" data-testid="tab-subscriptions" className="gap-1.5 py-1.5"><Mail className="w-4 h-4" /> Subscriptions</TabsTrigger>
              {isWebmaster && <TabsTrigger value="activity" data-testid="tab-activity" className="gap-1.5 py-1.5"><ScrollText className="w-4 h-4" /> Activity</TabsTrigger>}
              {!isWebmaster && (
                <>
                  <div className="w-px h-5 bg-border mx-1 shrink-0" aria-hidden />
                  <TabsTrigger value="security" data-testid="tab-security" className="gap-1.5 py-1.5"><ShieldCheck className="w-4 h-4" /> Security</TabsTrigger>
                </>
              )}
            </TabsList>
          </div>
          <TabsContent value="boats" className="pt-6"><BoatsTab classes={classes} clubs={boatClubs} clubId={clubId} clubName={clubName || ""} /></TabsContent>
          <TabsContent value="classes" className="pt-6"><ClassesTab classes={classes} reload={reloadClasses} clubId={clubId} /></TabsContent>
          <TabsContent value="series" className="pt-6"><SeriesTab classes={classes} clubId={clubId} /></TabsContent>
          <TabsContent value="regattas" className="pt-6"><RegattasTab clubId={clubId} /></TabsContent>
          <TabsContent value="notices" className="pt-6"><NoticeManagementTab clubId={clubId} /></TabsContent>
          <TabsContent value="subscriptions" className="pt-6"><SubscriptionOverview clubId={clubId} /></TabsContent>
          <TabsContent value="historic" className="pt-6"><HistoricTab classes={classes} rrsCodes={rrsCodes} clubId={clubId} /></TabsContent>
          <TabsContent value="users" className="pt-6"><UsersManager clubId={clubId} heading={clubName ? `${clubName} logins` : "Club logins"} /></TabsContent>
          {isWebmaster && <TabsContent value="activity" className="pt-6"><AuditLog webmaster /></TabsContent>}
          {!isWebmaster && (
            <TabsContent value="security" className="pt-6" data-testid="tab-security-content">
              <div className="mb-4">
                <h2 className="text-2xl uppercase tracking-tighter">Security</h2>
                <p className="text-muted-foreground text-sm">
                  Two-factor authentication for this account — protect it against a leaked passcode.
                </p>
              </div>
              <TwoFactorAuth />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}
