import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { CURRENT_YEAR, CODE_COLORS, fmtDate } from "@/lib/helpers";
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
import { ShieldCheck, LogOut, Plus, Pencil, Trash2, Anchor } from "lucide-react";

function TopBar() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-ocean-dark/95 text-white">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/15 grid place-items-center"><ShieldCheck className="w-5 h-5" /></div>
          <div className="font-heading text-xl uppercase tracking-tight leading-none">Race Admin</div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" onClick={() => navigate("/officer")}>Officer</Button>
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" data-testid="admin-logout-btn" onClick={() => { logout(); navigate("/"); }}>
            <LogOut className="w-4 h-4 mr-1" /> Exit
          </Button>
        </div>
      </div>
    </header>
  );
}

/* ---------------- Classes ---------------- */
function ClassesTab({ classes, reload }) {
  const [form, setForm] = useState({ name: "", default_start_time: "10:30" });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const save = async () => {
    if (!form.name) return toast.error("Name required");
    if (editing) await api.updateClass(editing, form); else await api.createClass(form);
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
function BoatsTab({ classes }) {
  const [classFilter, setClassFilter] = useState("all");
  const [boats, setBoats] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const blank = { name: "", sail_no: "", class_id: "", helm: "", year: CURRENT_YEAR, active: true };
  const [form, setForm] = useState(blank);

  const load = useCallback(() => {
    const p = classFilter === "all" ? { year: CURRENT_YEAR } : { class_id: classFilter, year: CURRENT_YEAR };
    api.getBoats(p).then(setBoats);
  }, [classFilter]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name || !form.sail_no || !form.class_id || !form.helm) return toast.error("All fields required");
    const payload = { ...form, year: Number(form.year) };
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
              <div className="flex items-center gap-2 col-span-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="boat-active-switch" /><Label>Active (racing this year)</Label></div>
            </div>
            <DialogFooter><Button onClick={save} data-testid="save-boat-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-xl border overflow-hidden overflow-x-auto">
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Sail No.</TableHead><TableHead>Boat</TableHead><TableHead>Class</TableHead><TableHead>Helm</TableHead><TableHead>Active</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{boats.map((b) => (
            <TableRow key={b.id} data-testid={`boat-row-${b.sail_no}`}>
              <TableCell className="font-mono font-bold">{b.sail_no}</TableCell>
              <TableCell className="font-semibold">{b.name}</TableCell>
              <TableCell>{cname(b.class_id)}</TableCell>
              <TableCell>{b.helm}</TableCell>
              <TableCell>{b.active ? <Badge className="bg-emerald-100 text-emerald-800">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(b.id); setForm({ name: b.name, sail_no: b.sail_no, class_id: b.class_id, helm: b.helm, year: b.year, active: b.active }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-boat-${b.sail_no}`} onClick={() => del(b.id)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>))}
            {!boats.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No boats yet.</TableCell></TableRow>}
          </TableBody></Table>
      </div>
    </div>
  );
}

/* ---------------- Series ---------------- */
function SeriesTab({ classes }) {
  const [classFilter, setClassFilter] = useState("");
  const [series, setSeries] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const blank = { name: "", class_id: "", year: CURRENT_YEAR, discards: 0, included_in_overall: true, order: 0, planned_races: 0 };
  const [form, setForm] = useState(blank);

  useEffect(() => { if (!classFilter && classes[0]) setClassFilter(classes[0].id); }, [classes]); // eslint-disable-line
  const load = useCallback(() => { if (classFilter) api.getSeries({ class_id: classFilter, year: CURRENT_YEAR }).then(setSeries); }, [classFilter]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name || !form.class_id) return toast.error("Name and class required");
    const payload = { ...form, discards: Number(form.discards), order: Number(form.order), year: Number(form.year), planned_races: Number(form.planned_races) };
    if (editing) await api.updateSeries(editing, payload); else await api.createSeries(payload);
    toast.success("Saved"); setOpen(false); setEditing(null); setForm({ ...blank, class_id: classFilter }); load();
  };
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
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label>Discards</Label><Input type="number" min="0" data-testid="series-discards-input" value={form.discards} onChange={(e) => setForm({ ...form, discards: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Planned races</Label><Input type="number" min="0" data-testid="series-planned-input" value={form.planned_races} onChange={(e) => setForm({ ...form, planned_races: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Order</Label><Input type="number" data-testid="series-order-input" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} /></div>
              </div>
              <div className="flex items-center gap-2"><Switch checked={form.included_in_overall} onCheckedChange={(v) => setForm({ ...form, included_in_overall: v })} data-testid="series-overall-switch" /><Label>Counts toward overall championship</Label></div>
            </div>
            <DialogFooter><Button onClick={save} data-testid="save-series-btn" className="bg-ocean hover:bg-ocean-dark">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-xl border overflow-hidden overflow-x-auto">
        <Table><TableHeader><TableRow className="bg-muted"><TableHead>Order</TableHead><TableHead>Series</TableHead><TableHead>Discards</TableHead><TableHead>Planned</TableHead><TableHead>In overall</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{series.map((s) => (
            <TableRow key={s.id} data-testid={`series-row-${s.name}`}>
              <TableCell className="font-mono">{s.order}</TableCell>
              <TableCell className="font-heading text-lg uppercase tracking-tight">{s.name}</TableCell>
              <TableCell className="font-mono">{s.discards}</TableCell>
              <TableCell className="font-mono">{s.planned_races || "—"}</TableCell>
              <TableCell><Switch checked={s.included_in_overall} onCheckedChange={(v) => quickSet(s, { included_in_overall: v })} data-testid={`overall-toggle-${s.name}`} /></TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(s.id); setForm({ name: s.name, class_id: s.class_id, year: s.year, discards: s.discards, included_in_overall: s.included_in_overall, order: s.order, planned_races: s.planned_races || 0 }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" data-testid={`delete-series-${s.name}`} onClick={() => del(s.id)}><Trash2 className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>))}
            {!series.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No series yet for this class.</TableCell></TableRow>}
          </TableBody></Table>
      </div>
    </div>
  );
}

/* ---------------- Historic Results ---------------- */
function HistoricTab({ classes, rrsCodes }) {
  const [classId, setClassId] = useState("");
  const [seriesList, setSeriesList] = useState([]);
  const [seriesId, setSeriesId] = useState("");
  const [races, setRaces] = useState([]);
  const [race, setRace] = useState(null);
  const [boats, setBoats] = useState({});

  useEffect(() => { if (!classId && classes[0]) setClassId(classes[0].id); }, [classes]); // eslint-disable-line
  useEffect(() => {
    if (classId) {
      api.getSeries({ class_id: classId, year: CURRENT_YEAR }).then(setSeriesList);
      api.getBoats({ class_id: classId }).then((bs) => { const m = {}; bs.forEach((b) => (m[b.id] = b)); setBoats(m); });
    }
  }, [classId]);
  useEffect(() => { if (seriesId) api.getRaces({ series_id: seriesId }).then(setRaces); }, [seriesId]);

  const openRace = async (id) => setRace(await api.getRace(id));
  const change = async (boatId, patch) => { const r = await api.adjustResult(race.id, boatId, patch); setRace(r); toast.success("Result updated"); };

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">Correct any historic result. Changes recompute standings immediately.</p>
      <div className="flex flex-wrap gap-3 mb-4">
        <Select value={classId} onValueChange={(v) => { setClassId(v); setSeriesId(""); setRace(null); }}>
          <SelectTrigger className="w-40" data-testid="hist-class"><SelectValue placeholder="Class" /></SelectTrigger>
          <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
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
        <div className="rounded-xl border overflow-hidden overflow-x-auto">
          <Table data-testid="hist-results-table"><TableHeader><TableRow className="bg-muted"><TableHead>Boat</TableHead><TableHead>Position</TableHead><TableHead>Code</TableHead></TableRow></TableHeader>
            <TableBody>{[...race.results].sort((a, b) => (a.code === "FINISHED" && b.code === "FINISHED") ? a.position - b.position : a.code === "FINISHED" ? -1 : 1).map((r) => {
              const b = boats[r.boat_id] || {};
              return (
                <TableRow key={r.boat_id} data-testid={`hist-row-${b.sail_no}`}>
                  <TableCell className="font-semibold">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span></TableCell>
                  <TableCell>{r.code === "FINISHED"
                    ? <Input type="number" min="1" defaultValue={r.position || ""} className="h-8 w-20 font-mono" data-testid={`hist-pos-${b.sail_no}`} onBlur={(e) => change(r.boat_id, { position: Number(e.target.value) })} />
                    : <Badge variant="outline" className={CODE_COLORS[r.code]}>{r.code}</Badge>}</TableCell>
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
      )}
    </div>
  );
}

export default function Admin() {
  const [classes, setClasses] = useState([]);
  const [rrsCodes, setRrsCodes] = useState([]);
  const reloadClasses = useCallback(() => api.getClasses().then(setClasses), []);
  useEffect(() => { reloadClasses(); api.rrsCodes().then(setRrsCodes); }, [reloadClasses]);

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl uppercase tracking-tighter mb-1">Admin console</h1>
        <p className="text-muted-foreground text-sm mb-6">Manage the fleet, season structure and historic scoring.</p>
        <Tabs defaultValue="boats">
          <TabsList className="flex flex-wrap h-auto gap-1" data-testid="admin-tabs">
            <TabsTrigger value="boats" data-testid="tab-boats">Boats</TabsTrigger>
            <TabsTrigger value="classes" data-testid="tab-classes">Classes</TabsTrigger>
            <TabsTrigger value="series" data-testid="tab-series">Series</TabsTrigger>
            <TabsTrigger value="historic" data-testid="tab-historic">Historic Results</TabsTrigger>
          </TabsList>
          <TabsContent value="boats" className="pt-6"><BoatsTab classes={classes} /></TabsContent>
          <TabsContent value="classes" className="pt-6"><ClassesTab classes={classes} reload={reloadClasses} /></TabsContent>
          <TabsContent value="series" className="pt-6"><SeriesTab classes={classes} /></TabsContent>
          <TabsContent value="historic" className="pt-6"><HistoricTab classes={classes} rrsCodes={rrsCodes} /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
