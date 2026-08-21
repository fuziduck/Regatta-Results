import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import ClubPicker from "@/components/ClubPicker";
import { CURRENT_YEAR, CODE_COLORS, fmtDate } from "@/lib/helpers";
import { ElapsedInput } from "@/components/ElapsedInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ShieldCheck, LogOut, Plus, Pencil, Trash2, Anchor, RotateCcw, Send, Globe, Building2 } from "lucide-react";

function TopBar({ clubName, onSwitchClub }) {
  const { role, logout } = useAuth();
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" onClick={() => navigate(clubQuery ? `/officer?club=${clubQuery}` : "/officer")}>Officer</Button>
          {role === "webmaster" && (
            <>
              {onSwitchClub && <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" onClick={onSwitchClub}><Building2 className="w-4 h-4 mr-1" /> Switch club</Button>}
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" onClick={() => navigate("/webmaster")}><Globe className="w-4 h-4 mr-1" /> Webmaster</Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" data-testid="admin-logout-btn" onClick={() => { logout(); navigate("/"); }}>
            <LogOut className="w-4 h-4 mr-1" /> Exit
          </Button>
        </div>
      </div>
    </header>
  );
}

/* ---------------- Classes ---------------- */
function ClassesTab({ classes, reload, clubId }) {
  const [form, setForm] = useState({ name: "", default_start_time: "10:30", scoring_mode: "one_design" });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const save = async () => {
    if (!form.name) return toast.error("Name required");
    if (editing) await api.updateClass(editing, form); else await api.createClass({ ...form, club_id: clubId });
    toast.success("Saved"); setOpen(false); setEditing(null); setForm({ name: "", default_start_time: "10:30", scoring_mode: "one_design" }); reload();
  };
  const del = async (id) => { await api.deleteClass(id); toast.success("Deleted"); reload(); };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Fleets racing this season. Each has an auto start time.</p>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm({ name: "", default_start_time: "10:30", scoring_mode: "one_design" }); } }}>
          <DialogTrigger asChild><Button data-testid="add-class-btn" className="gap-2 bg-ocean hover:bg-ocean-dark"><Plus className="w-4 h-4" /> Add class</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-heading uppercase">{editing ? "Edit" : "Add"} class</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Class name</Label><Input data-testid="class-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dragon" /></div>
              <div className="space-y-1.5"><Label>Default start time</Label><Input type="time" data-testid="class-time-input" value={form.default_start_time} onChange={(e) => setForm({ ...form, default_start_time: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Scoring system</Label>
                <Select value={form.scoring_mode || "one_design"} onValueChange={(v) => setForm({ ...form, scoring_mode: v })}>
                  <SelectTrigger data-testid="class-scoring-input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_design">One-design (finish order)</SelectItem>
                    <SelectItem value="irc">IRC (corrected time)</SelectItem>
                  </SelectContent>
                </Select>
                {form.scoring_mode === "irc" && <p className="text-xs text-muted-foreground">Finishes ordered by corrected time (elapsed × TCC, rounded to nearest second); boats need a TCC.</p>}
              </div>
            </div>
            <DialogFooter><Button onClick={save} data-testid="save-class-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-xl border overflow-hidden">
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Class</TableHead><TableHead>Start</TableHead><TableHead>Scoring</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{classes.map((c) => (
            <TableRow key={c.id} data-testid={`class-row-${c.name}`}>
              <TableCell className="font-heading text-lg uppercase tracking-tight">{c.name}</TableCell>
              <TableCell className="font-mono">{c.default_start_time}</TableCell>
              <TableCell>{c.scoring_mode === "irc" ? <Badge className="bg-indigo-100 text-indigo-800">IRC</Badge> : <Badge variant="outline">One-design</Badge>}</TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(c.id); setForm({ name: c.name, default_start_time: c.default_start_time, scoring_mode: c.scoring_mode || "one_design" }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-class-${c.name}`} onClick={() => del(c.id)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>))}
          </TableBody></Table>
      </div>
    </div>
  );
}

/* ---------------- Boats ---------------- */
function BoatsTab({ classes, clubId }) {
  const [classFilter, setClassFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState(CURRENT_YEAR);
  const [boats, setBoats] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const blank = { name: "", sail_no: "", class_id: "", helm: "", year: CURRENT_YEAR, active: true, tcc: "", boat_type: "" };
  const [form, setForm] = useState(blank);

  const load = useCallback(() => {
    const p = classFilter === "all" ? { year: yearFilter } : { class_id: classFilter, year: yearFilter };
    api.getBoats({ ...p, ...(clubId ? { club_id: clubId } : {}) }).then(setBoats);
  }, [classFilter, yearFilter, clubId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setClassFilter("all"); setYearFilter(CURRENT_YEAR); }, [clubId]);

  const save = async () => {
    if (!form.name || !form.sail_no || !form.class_id || !form.helm) return toast.error("All fields required");
    const payload = { ...form, year: Number(form.year), tcc: form.tcc === "" ? null : Number(form.tcc) };
    if (editing) await api.updateBoat(editing, payload); else await api.createBoat(payload);
    toast.success("Saved"); setOpen(false); setEditing(null); setForm(blank); load();
  };
  const del = async (id) => { await api.deleteBoat(id); toast.success("Deleted"); load(); };
  const cname = (id) => classes.find((c) => c.id === id)?.name || "—";

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
          <Select value={yearFilter} onValueChange={(v) => setYearFilter(Number(v))}>
            <SelectTrigger className="w-28" data-testid="boat-year-filter"><SelectValue /></SelectTrigger>
            <SelectContent>{YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
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
              <div className="space-y-1.5"><Label>Helm</Label><Input data-testid="boat-helm-input" value={form.helm} onChange={(e) => setForm({ ...form, helm: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Year</Label><Input type="number" data-testid="boat-year-input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Boat type</Label><Input data-testid="boat-type-input" value={form.boat_type} onChange={(e) => setForm({ ...form, boat_type: e.target.value })} placeholder="e.g. Bavaria 34 — cruisers only" /></div>
              <div className="space-y-1.5"><Label>TCC (IRC rating)</Label><Input type="number" step="0.001" min="0" data-testid="boat-tcc-input" value={form.tcc} onChange={(e) => setForm({ ...form, tcc: e.target.value })} placeholder="e.g. 1.015 — blank for one-design" /></div>
              <div className="flex items-center gap-2 col-span-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="boat-active-switch" /><Label>Active (racing this year)</Label></div>
            </div>
            <DialogFooter><Button onClick={save} data-testid="save-boat-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-xl border overflow-hidden overflow-x-auto">
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Sail No.</TableHead><TableHead>Boat</TableHead><TableHead>Class</TableHead><TableHead>Helm</TableHead><TableHead>Type</TableHead><TableHead>TCC</TableHead><TableHead>Active</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{boats.map((b) => (
            <TableRow key={b.id} data-testid={`boat-row-${b.sail_no}`}>
              <TableCell className="font-mono font-bold">{b.sail_no}</TableCell>
              <TableCell className="font-semibold">{b.name}</TableCell>
              <TableCell>{cname(b.class_id)}</TableCell>
              <TableCell>{b.helm}</TableCell>
              <TableCell className="text-muted-foreground">{b.boat_type || "—"}</TableCell>
              <TableCell className="font-mono">{b.tcc ? b.tcc.toFixed(3) : "—"}</TableCell>
              <TableCell>{b.active ? <Badge className="bg-emerald-100 text-emerald-800">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(b.id); setForm({ name: b.name, sail_no: b.sail_no, class_id: b.class_id, helm: b.helm, year: b.year, active: b.active, tcc: b.tcc ?? "", boat_type: b.boat_type ?? "" }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-boat-${b.sail_no}`} onClick={() => del(b.id)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>))}
            {!boats.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No boats yet.</TableCell></TableRow>}
          </TableBody></Table>
      </div>
    </div>
  );
}

/* ---------------- Series ---------------- */
// Newest first: two seasons ahead (so future series can be set up and
// managed before racing starts) through the historic range.
const YEAR_OPTIONS = [CURRENT_YEAR + 2, CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

function SeriesTab({ classes, clubId }) {
  const [classFilter, setClassFilter] = useState("");
  const [yearFilter, setYearFilter] = useState(CURRENT_YEAR);
  const [series, setSeries] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const blank = { name: "", class_id: "", year: CURRENT_YEAR, discards: 0, included_in_overall: true, order: 0, planned_races: 0, schedule: [], use_a5_3: false };
  const [form, setForm] = useState(blank);
  const [schedStart, setSchedStart] = useState("2026-08-08");

  useEffect(() => { if (!classFilter && classes[0]) setClassFilter(classes[0].id); }, [classes]); // eslint-disable-line
  // Reset filters only when the club actually changes — not on first mount,
  // or the reset would clobber the auto-selected first class above.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setClassFilter(""); setYearFilter(CURRENT_YEAR); setSeries([]);
  }, [clubId]);
  const load = useCallback(() => { if (classFilter) api.getSeries({ class_id: classFilter, year: yearFilter, ...(clubId ? { club_id: clubId } : {}) }).then(setSeries); }, [classFilter, yearFilter, clubId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name || !form.class_id) return toast.error("Name and class required");
    const payload = { ...form, discards: Number(form.discards), order: Number(form.order), year: Number(form.year), planned_races: Number(form.planned_races), schedule: form.schedule || [] };
    if (editing) await api.updateSeries(editing, payload); else await api.createSeries(payload);
    toast.success("Saved"); setOpen(false); setEditing(null); setForm({ ...blank, class_id: classFilter }); load();
  };
  const genSchedule = async () => {
    if (!editing) return toast.error("Save the series first, then re-open to auto-fill dates");
    const s = await api.generateSchedule(editing, { start_date: schedStart, count: Number(form.planned_races) || undefined });
    setForm((f) => ({ ...f, schedule: s.schedule || [], planned_races: s.planned_races }));
    toast.success("Weekly schedule generated"); load();
  };
  const setSchedDate = (idx, val) => setForm((f) => { const sc = [...(f.schedule || [])]; sc[idx] = val; return { ...f, schedule: sc }; });
  const del = async (id) => { await api.deleteSeries(id); toast.success("Deleted"); load(); };
  const quickSet = async (s, patch) => { await api.updateSeries(s.id, { ...s, ...patch }); load(); };

  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Class</Label>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-40" data-testid="series-class-filter"><SelectValue placeholder="Class" /></SelectTrigger>
            <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Year</Label>
          <Select value={yearFilter} onValueChange={(v) => setYearFilter(Number(v))}>
            <SelectTrigger className="w-28" data-testid="series-year-filter"><SelectValue /></SelectTrigger>
            <SelectContent>{YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm({ ...blank, class_id: classFilter }); } }}>
          <DialogTrigger asChild><Button data-testid="add-series-btn" onClick={() => setForm({ ...blank, class_id: classFilter, order: series.length + 1 })} className="gap-2 bg-ocean hover:bg-ocean-dark"><Plus className="w-4 h-4" /> Add series</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-heading uppercase">{editing ? "Edit" : "Add"} series</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Series name</Label><Input data-testid="series-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Early Spring" /></div>
              <div className="space-y-1.5"><Label>Class</Label>
                <Select value={form.class_id} onValueChange={(v) => setForm({ ...form, class_id: v })}>
                  <SelectTrigger data-testid="series-class-input"><SelectValue placeholder="Class" /></SelectTrigger>
                  <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Year</Label><Input type="number" min="2000" max="2100" data-testid="series-year-input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Discards</Label><Input type="number" min="0" data-testid="series-discards-input" value={form.discards} onChange={(e) => setForm({ ...form, discards: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Planned races</Label><Input type="number" min="0" data-testid="series-planned-input" value={form.planned_races} onChange={(e) => setForm({ ...form, planned_races: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Order</Label><Input type="number" data-testid="series-order-input" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} /></div>
              </div>
              <div className="flex items-center gap-2"><Switch checked={form.included_in_overall} onCheckedChange={(v) => setForm({ ...form, included_in_overall: v })} data-testid="series-overall-switch" /><Label>Counts toward overall championship</Label></div>
              <div className="flex items-center gap-2"><Switch checked={form.use_a5_3} onCheckedChange={(v) => setForm({ ...form, use_a5_3: v })} data-testid="series-a53-switch" /><Label>RRS A5.3 — boats that came to the start area score as starters + 1</Label></div>

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
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Order</TableHead><TableHead>Series</TableHead><TableHead>Year</TableHead><TableHead>Discards</TableHead><TableHead>Planned</TableHead><TableHead>In overall</TableHead><TableHead>A5.3</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{series.map((s) => (
            <TableRow key={s.id} data-testid={`series-row-${s.name}`}>
              <TableCell className="font-mono">{s.order}</TableCell>
              <TableCell className="font-heading text-lg uppercase tracking-tight">{s.name}</TableCell>
              <TableCell className="font-mono">{s.year || "—"}</TableCell>
              <TableCell className="font-mono">{s.discards}</TableCell>
              <TableCell className="font-mono">{s.planned_races || "—"}</TableCell>
              <TableCell><Switch checked={s.included_in_overall} onCheckedChange={(v) => quickSet(s, { included_in_overall: v })} data-testid={`overall-toggle-${s.name}`} /></TableCell>
              <TableCell><Switch checked={!!s.use_a5_3} onCheckedChange={(v) => quickSet(s, { use_a5_3: v })} data-testid={`a53-toggle-${s.name}`} /></TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(s.id); setForm({ name: s.name, class_id: s.class_id, year: s.year, discards: s.discards, included_in_overall: s.included_in_overall, use_a5_3: !!s.use_a5_3, order: s.order, planned_races: s.planned_races || 0, schedule: s.schedule || [] }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-series-${s.name}`} onClick={() => del(s.id)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>))}
            {!series.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No series yet for this class.</TableCell></TableRow>}
          </TableBody></Table>
      </div>
    </div>
  );
}

/* ---------------- Historic Results ---------------- */
function HistoricTab({ classes, rrsCodes, clubId }) {
  const [classId, setClassId] = useState("");
  const [yearFilter, setYearFilter] = useState(CURRENT_YEAR);
  const [seriesList, setSeriesList] = useState([]);
  const [seriesId, setSeriesId] = useState("");
  const [races, setRaces] = useState([]);
  const [race, setRace] = useState(null);
  const [boats, setBoats] = useState({});

  useEffect(() => { if (!classId && classes[0]) setClassId(classes[0].id); }, [classes]); // eslint-disable-line
  // Reset filters only when the club actually changes — not on first mount,
  // or the reset would clobber the auto-selected first class above.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setClassId(""); setSeriesId(""); setRace(null); setYearFilter(CURRENT_YEAR);
  }, [clubId]);
  useEffect(() => {
    if (classId) {
      const cparams = clubId ? { club_id: clubId } : {};
      api.getSeries({ class_id: classId, year: yearFilter, ...cparams }).then(setSeriesList);
      api.getBoats({ class_id: classId, ...cparams }).then((bs) => { const m = {}; bs.forEach((b) => (m[b.id] = b)); setBoats(m); });
    }
  }, [classId, yearFilter, clubId]);
  useEffect(() => { if (seriesId) api.getRaces({ series_id: seriesId, ...(clubId ? { club_id: clubId } : {}) }).then(setRaces); }, [seriesId, clubId]);

  const openRace = async (id) => setRace(await api.getRace(id));
  const change = async (boatId, patch) => { const r = await api.adjustResult(race.id, boatId, patch); setRace(r); toast.success("Result updated"); };
  const setStatus = async (s) => {
    await api.setStatus(race.id, s);
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
          <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={yearFilter} onValueChange={(v) => { setYearFilter(Number(v)); setSeriesId(""); setRace(null); }}>
          <SelectTrigger className="w-28" data-testid="hist-year"><SelectValue /></SelectTrigger>
          <SelectContent>{YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={seriesId} onValueChange={(v) => { setSeriesId(v); setRace(null); }}>
          <SelectTrigger className="w-48" data-testid="hist-series"><SelectValue placeholder="Series" /></SelectTrigger>
          <SelectContent>{seriesList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {seriesId && (
        <div className="flex flex-wrap gap-2 mb-4">
          {races.map((r) => (
            <Button key={r.id} variant={race?.id === r.id ? "default" : "outline"} size="sm" data-testid={`hist-race-${r.id}`}
              className={race?.id === r.id ? "bg-ocean" : ""} onClick={() => openRace(r.id)}>
              R{r.race_number} · {fmtDate(r.date)} · {r.status}
            </Button>
          ))}
          {!races.length && <p className="text-sm text-muted-foreground">No races in this series.</p>}
        </div>
      )}

      {race && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Race {race.race_number} · {fmtDate(race.date)}</span>
              <Badge className={race.status === "published" ? "bg-emerald-100 text-emerald-800" : race.status === "provisional" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}>{race.status}</Badge>
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
                    : <Badge variant="outline" className={CODE_COLORS[r.code]}>{r.code}</Badge>}</TableCell>
                  <TableCell>{r.code === "FINISHED"
                    ? <ElapsedInput finishTime={r.finish_time} race={race} onCommit={(secs) => change(r.boat_id, { elapsed_seconds: secs })} data-testid={`hist-elapsed-${b.sail_no}`} className="[&_input]:w-12" />
                    : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <Select value={r.code} onValueChange={(v) => change(r.boat_id, { code: v })}>
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
    </div>
  );
}

/* ---------------- Clubs ---------------- */
function ClubsTab() {
  const [clubs, setClubs] = useState([]);
  const [open, setOpen] = useState(false);
  const blank = { name: "", color: "#0A369D", officer_pin: "", admin_pin: "" };
  const [form, setForm] = useState(blank);

  const load = useCallback(() => api.getClubs().then(setClubs), []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name || !form.officer_pin || !form.admin_pin) return toast.error("Name and both passcodes required");
    await api.createClub(form);
    toast.success("Club added"); setOpen(false); setForm(blank); load();
  };
  const del = async (id) => {
    if (!window.confirm("Delete this club? Its classes must be deleted first.")) return;
    await api.deleteClub(id); toast.success("Club deleted"); load();
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Webmaster view — full club management (passcodes, colours and renames) lives on the <Link to="/webmaster" className="text-ocean font-semibold hover:underline">Webmaster page</Link>. Each club gets its own officer and admin passcodes, and staff only ever see their own club.
      </p>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Every club has its own classes, boats and results.</p>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(blank); }}>
          <DialogTrigger asChild><Button data-testid="add-club-btn" className="gap-2 bg-ocean hover:bg-ocean-dark"><Plus className="w-4 h-4" /> Add club</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-heading uppercase">Add a club</DialogTitle></DialogHeader>
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
      <div className="rounded-xl border overflow-hidden">
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Club</TableHead><TableHead>Classes</TableHead><TableHead>Link</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{clubs.map((c) => (
            <TableRow key={c.id} data-testid={`club-row-${c.slug}`}>
              <TableCell className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg grid place-items-center text-white font-heading" style={{ backgroundColor: c.color || "#0A369D" }}>{c.name.charAt(0)}</span>
                <span className="font-heading text-lg uppercase tracking-tight">{c.name}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">—</TableCell>
              <TableCell><a href={`/club/${c.slug}`} className="text-ocean text-sm hover:underline font-mono">/club/{c.slug}</a></TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => del(c.id)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>))}
          </TableBody></Table>
      </div>
    </div>
  );
}

export default function Admin() {
  const { role, clubId: authClubId, clubName: authClubName } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isWebmaster = role === "webmaster";
  const clubParam = searchParams.get("club");
  const [clubs, setClubs] = useState([]);

  useEffect(() => {
    if (isWebmaster) api.getClubs().then((cs) => setClubs(cs || [])).catch(() => {});
  }, [isWebmaster]);

  const clubId = isWebmaster ? clubParam : authClubId;
  const clubName = isWebmaster
    ? (clubs.find((c) => c.id === clubParam)?.name || null)
    : (authClubName || null);

  const [classes, setClasses] = useState([]);
  const [rrsCodes, setRrsCodes] = useState([]);
  const reloadClasses = useCallback(() => api.getClasses(clubId ? { club_id: clubId } : {}).then(setClasses), [clubId]);
  useEffect(() => { reloadClasses(); api.rrsCodes().then(setRrsCodes); }, [reloadClasses]);

  const switchClub = isWebmaster ? () => setSearchParams({}) : null;

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
      <TopBar clubName={clubName} onSwitchClub={switchClub} />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl uppercase tracking-tighter mb-1">Admin console</h1>
        <p className="text-muted-foreground text-sm mb-6">Manage the fleet, season structure and historic scoring.</p>
        <Tabs defaultValue="boats">
          <TabsList className="flex flex-wrap h-auto gap-1" data-testid="admin-tabs">
            <TabsTrigger value="boats" data-testid="tab-boats">Boats</TabsTrigger>
            <TabsTrigger value="classes" data-testid="tab-classes">Classes</TabsTrigger>
            <TabsTrigger value="series" data-testid="tab-series">Series</TabsTrigger>
            <TabsTrigger value="historic" data-testid="tab-historic">Historic Results</TabsTrigger>
            {isWebmaster && <TabsTrigger value="clubs" data-testid="tab-clubs">Clubs</TabsTrigger>}
          </TabsList>
          <TabsContent value="boats" className="pt-6"><BoatsTab classes={classes} clubId={clubId} /></TabsContent>
          <TabsContent value="classes" className="pt-6"><ClassesTab classes={classes} reload={reloadClasses} clubId={clubId} /></TabsContent>
          <TabsContent value="series" className="pt-6"><SeriesTab classes={classes} clubId={clubId} /></TabsContent>
          <TabsContent value="historic" className="pt-6"><HistoricTab classes={classes} rrsCodes={rrsCodes} clubId={clubId} /></TabsContent>
          {isWebmaster && <TabsContent value="clubs" className="pt-6"><ClubsTab /></TabsContent>}
        </Tabs>
      </main>
    </div>
  );
}
