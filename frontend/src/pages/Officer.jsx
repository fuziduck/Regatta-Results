import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { fmtDate, fmtTime, fmtDur, CURRENT_YEAR, CODE_COLORS } from "@/lib/helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Anchor, LogOut, Plus, ChevronLeft, Flag, LifeBuoy, Undo2, CheckCircle2, Send, Trash2, Radio, Timer, CalendarDays, ChevronRight, RotateCcw } from "lucide-react";

const STATUS_BADGE = {
  setup: "bg-slate-200 text-slate-700",
  provisional: "bg-amber-100 text-amber-800 animate-pulse",
  published: "bg-emerald-100 text-emerald-800",
};

function TopBar() {
  const { role, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-ocean/95 text-white">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/15 grid place-items-center"><Radio className="w-5 h-5" /></div>
          <div className="font-heading text-xl uppercase tracking-tight leading-none">Race Officer</div>
        </div>
        <div className="flex items-center gap-2">
          {role === "admin" && <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" onClick={() => navigate("/admin")}>Admin</Button>}
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" data-testid="logout-btn" onClick={() => { logout(); navigate("/"); }}>
            <LogOut className="w-4 h-4 mr-1" /> Exit
          </Button>
        </div>
      </div>
    </header>
  );
}

function NewRaceDialog({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState([]);
  const [series, setSeries] = useState([]);
  const [form, setForm] = useState({ class_id: "", series_id: "", date: new Date().toISOString().slice(0, 10), race_number: 1, start_time: "" });

  useEffect(() => { if (open) api.getClasses().then(setClasses); }, [open]);
  useEffect(() => {
    if (form.class_id) api.getSeries({ class_id: form.class_id, year: CURRENT_YEAR }).then(setSeries);
  }, [form.class_id]);

  const create = async () => {
    if (!form.class_id || !form.series_id) return toast.error("Pick a class and series");
    try {
      const race = await api.createRace({ ...form, race_number: Number(form.race_number), start_time: form.start_time || null });
      toast.success("Race created");
      setOpen(false);
      onCreated(race);
    } catch (e) { toast.error("Could not create race"); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="new-race-btn" className="gap-2 bg-safety hover:bg-safety-dark h-12 text-base"><Plus className="w-5 h-5" /> New Race</Button>
      </DialogTrigger>
      <DialogContent data-testid="new-race-dialog">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">Set up a race</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Class</Label>
            <Select value={form.class_id} onValueChange={(v) => setForm({ ...form, class_id: v, series_id: "" })}>
              <SelectTrigger data-testid="new-race-class"><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Series</Label>
            <Select value={form.series_id} onValueChange={(v) => setForm({ ...form, series_id: v })} disabled={!form.class_id}>
              <SelectTrigger data-testid="new-race-series"><SelectValue placeholder="Select series" /></SelectTrigger>
              <SelectContent>{series.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Date</Label><Input type="date" data-testid="new-race-date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="space-y-2"><Label>Race #</Label><Input type="number" min="1" data-testid="new-race-number" value={form.race_number} onChange={(e) => setForm({ ...form, race_number: e.target.value })} /></div>
          </div>
          <div className="space-y-2"><Label>Start time (optional — auto from class)</Label><Input type="time" data-testid="new-race-time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={create} data-testid="create-race-confirm" className="bg-ocean hover:bg-ocean-dark">Create race</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RaceConsole({ raceId, meta, onBack, rrsCodes }) {
  const [race, setRace] = useState(null);
  const [boats, setBoats] = useState({});
  const [notif, setNotif] = useState({ course: "", special_rules: "", life_jackets: false, start_time: "" });

  const refresh = useCallback(async () => {
    const r = await api.getRace(raceId);
    setRace(r);
    setNotif({ course: r.course || "", special_rules: r.special_rules || "", life_jackets: !!r.life_jackets, start_time: r.start_time || "" });
  }, [raceId]);

  useEffect(() => {
    refresh();
    api.getBoats({ class_id: meta.class_id }).then((bs) => { const m = {}; bs.forEach((b) => (m[b.id] = b)); setBoats(m); });
  }, [raceId]); // eslint-disable-line

  if (!race) return <div className="p-8 text-muted-foreground">Loading race…</div>;

  const racing = race.results.filter((r) => r.code !== "DNC");
  const handicap = meta.scoring_type === "irc" || meta.scoring_type === "py";
  const toFinish = racing.filter((r) => r.code === "DNS").sort((a, b) => (boats[a.boat_id]?.sail_no || "").localeCompare(boats[b.boat_id]?.sail_no || ""));
  const finished = race.results.filter((r) => r.code === "FINISHED").sort((a, b) => a.position - b.position);

  const saveNotif = async () => { await api.updateNotifications(raceId, notif); toast.success("Notice updated & published to landing page"); refresh(); };
  const toggleBoat = async (boatId) => {
    const selected = new Set(racing.map((r) => r.boat_id));
    if (selected.has(boatId)) selected.delete(boatId); else selected.add(boatId);
    await api.selectBoats(raceId, [...selected]); refresh();
  };
  const finish = async (boatId) => {
    await api.recordFinish(raceId, boatId, new Date().toISOString());
    toast.success(`${boats[boatId]?.name} finished`); refresh();
  };
  const undo = async (boatId) => { await api.undoFinish(raceId, boatId); refresh(); };
  const changeCode = async (boatId, code) => { await api.adjustResult(raceId, boatId, { code }); refresh(); };
  const changePos = async (boatId, position) => { await api.adjustResult(raceId, boatId, { position: Number(position) }); refresh(); };
  const setStatus = async (s) => {
    await api.setStatus(raceId, s);
    toast.success(
      s === "published" ? "Results published to landing page!" :
      s === "setup" ? "Result recalled — race is back in setup" :
      `Marked ${s}`
    );
    if (s === "published") onBack(); else refresh();
  };
  const remove = async () => { await api.deleteRace(raceId); toast.success("Race deleted"); onBack(); };

  return (
    <div className="pb-40">
      <div className="sticky top-16 z-30 backdrop-blur-xl bg-white/85 border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="console-back-btn"><ChevronLeft className="w-4 h-4" /> Back</Button>
          <div className="flex-1">
            <div className="font-heading text-lg uppercase tracking-tight leading-none">{meta.class_name} · {meta.series_name}</div>
            <div className="text-xs text-muted-foreground">Race {race.race_number} · {fmtDate(race.date)} · Start {race.start_time}</div>
          </div>
          <Badge className={STATUS_BADGE[race.status]}>{race.status}</Badge>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-5 space-y-6">
        {/* Race day notice */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading uppercase tracking-tight text-ocean flex items-center gap-2 mb-3"><Flag className="w-4 h-4" /> Race-day notice</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Start time</Label><Input type="time" data-testid="notif-start-time" value={notif.start_time} onChange={(e) => setNotif({ ...notif, start_time: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Course</Label><Input data-testid="notif-course" placeholder="e.g. Windward/Leeward, 3 laps" value={notif.course} onChange={(e) => setNotif({ ...notif, course: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5 mt-3"><Label>Special rules</Label><Textarea data-testid="notif-rules" rows={2} placeholder="Any special instructions for the day" value={notif.special_rules} onChange={(e) => setNotif({ ...notif, special_rules: e.target.value })} /></div>
          <div className="flex items-center justify-between mt-3 p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 font-semibold"><LifeBuoy className="w-5 h-5 text-safety" /> Life jackets required</div>
            <Switch data-testid="notif-lifejackets" checked={notif.life_jackets} onCheckedChange={(v) => setNotif({ ...notif, life_jackets: v })} />
          </div>
          <Button onClick={saveNotif} data-testid="save-notif-btn" className="mt-3 bg-ocean hover:bg-ocean-dark">Publish notice</Button>
        </section>

        {/* Boat selection */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading uppercase tracking-tight mb-1">Boats racing today</h3>
          <p className="text-sm text-muted-foreground mb-3">Tap to include. Unselected boats score <strong>DNC</strong>.</p>
          <div className="flex flex-wrap gap-2" data-testid="boat-select-list">
            {race.results.map((r) => {
              const b = boats[r.boat_id] || {};
              const isRacing = r.code !== "DNC";
              return (
                <button key={r.boat_id} data-testid={`boat-toggle-${b.sail_no}`} onClick={() => toggleBoat(r.boat_id)}
                  className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-transform active:scale-95 ${isRacing ? "bg-ocean text-white border-ocean" : "bg-background border-border text-muted-foreground"}`}>
                  {b.name} <span className="font-mono text-xs opacity-80">{b.sail_no}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Finish recording */}
        <section>
          <h3 className="font-heading uppercase tracking-tight mb-1 flex items-center gap-2"><Timer className="w-5 h-5 text-safety" /> Record finishes</h3>
          <p className="text-sm text-muted-foreground mb-3">Big tap = finish time captured now. {toFinish.length} still racing.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="finish-grid">
            {toFinish.map((r) => {
              const b = boats[r.boat_id] || {};
              return (
                <button key={r.boat_id} data-testid={`finish-btn-${b.sail_no}`} onClick={() => finish(r.boat_id)}
                  className="race-btn h-28 rounded-2xl bg-safety text-white flex flex-col items-center justify-center transition-transform active:scale-95 hover:bg-safety-dark">
                  <span className="font-heading text-2xl uppercase tracking-tight leading-none">{b.name}</span>
                  <span className="font-mono text-sm opacity-90 mt-1">{b.sail_no}</span>
                </button>
              );
            })}
            {toFinish.length === 0 && <div className="col-span-full text-sm text-muted-foreground py-4">All racing boats have finished, or none selected yet.</div>}
          </div>

          {finished.length > 0 && (
            <div className="mt-5 rounded-xl border border-border bg-card divide-y" data-testid="finished-list">
              {finished.map((r) => {
                const b = boats[r.boat_id] || {};
                return (
                  <div key={r.boat_id} className="flex items-center gap-3 p-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-800 grid place-items-center font-heading text-lg">{r.position}</div>
                    <div className="flex-1"><div className="font-semibold leading-none">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span></div>
                      <div className="font-mono text-xs text-muted-foreground mt-0.5">{fmtTime(r.finish_time)}</div></div>
                    <Button size="sm" variant="outline" data-testid={`undo-btn-${b.sail_no}`} onClick={() => undo(r.boat_id)}><Undo2 className="w-4 h-4" /></Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Provisional / adjust */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading uppercase tracking-tight mb-3">Provisional results & penalties{handicap && <span className="ml-2 text-xs font-body normal-case text-safety">({meta.scoring_type.toUpperCase()} — ranked on corrected time)</span>}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b"><th className="py-2">Boat</th><th className="w-20">Pos</th>{handicap && <th className="w-28">Elapsed</th>}{handicap && <th className="w-28">Corrected</th>}<th className="w-40">Code / Penalty (RRS)</th></tr></thead>
              <tbody data-testid="adjust-table">
                {[...race.results].sort((a, b) => {
                  if (a.code === "FINISHED" && b.code === "FINISHED") return a.position - b.position;
                  if (a.code === "FINISHED") return -1; if (b.code === "FINISHED") return 1; return 0;
                }).map((r) => {
                  const b = boats[r.boat_id] || {};
                  return (
                    <tr key={r.boat_id} className="border-b last:border-0">
                      <td className="py-2 font-semibold">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span>{handicap && b.rating != null && <span className="ml-1 font-mono text-[10px] text-muted-foreground">·{b.rating}</span>}</td>
                      <td>
                        {r.code === "FINISHED"
                          ? (handicap
                            ? <span className="font-heading text-base" data-testid={`pos-input-${b.sail_no}`}>{r.position || "–"}</span>
                            : <Input type="number" min="1" value={r.position || ""} data-testid={`pos-input-${b.sail_no}`} className="h-8 w-16 font-mono" onChange={(e) => changePos(r.boat_id, e.target.value)} />)
                          : <Badge variant="outline" className={CODE_COLORS[r.code]}>{r.code}</Badge>}
                      </td>
                      {handicap && <td className="font-mono text-xs">{r.code === "FINISHED" ? fmtDur(r.elapsed_seconds) : "—"}</td>}
                      {handicap && <td className="font-mono text-xs font-bold text-ocean">{r.code === "FINISHED" ? fmtDur(r.corrected_seconds) : "—"}</td>}
                      <td>
                        <Select value={r.code} onValueChange={(v) => changeCode(r.boat_id, v)}>
                          <SelectTrigger className="h-8" data-testid={`code-select-${b.sail_no}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{rrsCodes.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {handicap && <p className="text-xs text-muted-foreground mt-2">Positions are auto-calculated from corrected time — tap order doesn't matter. Set boat ratings & the start time to compute correctly.</p>}
        </section>
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 backdrop-blur-xl bg-white/90 border-t border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          <Button variant="outline" className="text-destructive border-destructive/40" data-testid="delete-race-btn" onClick={remove}><Trash2 className="w-4 h-4" /></Button>
          {race.status === "published" ? (
            <Button variant="outline" className="flex-1 h-12 border-amber-500 text-amber-700" data-testid="recall-btn"
              onClick={() => { if (window.confirm("Recall the published result and roll this race back to setup? It will be removed from the public results and its race-day notice will show again.")) setStatus("setup"); }}>
              <RotateCcw className="w-4 h-4 mr-1" /> Recall Result
            </Button>
          ) : (
            <Button variant="outline" className="flex-1 h-12 border-amber-400 text-amber-700" data-testid="set-provisional-btn" onClick={() => setStatus("provisional")}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Mark Provisional
            </Button>
          )}
          <Button className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700" data-testid="publish-btn" onClick={() => setStatus("published")}>
            <Send className="w-4 h-4 mr-1" /> {race.status === "published" ? "Re-publish" : "Publish Results"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Officer() {
  const [races, setRaces] = useState([]);
  const [classes, setClasses] = useState({});
  const [series, setSeries] = useState({});
  const [selected, setSelected] = useState(null);
  const [rrsCodes, setRrsCodes] = useState([]);

  const loadRaces = useCallback(async () => {
    const [rs, cs, ss] = await Promise.all([api.getRaces(), api.getClasses(), api.getSeries({ year: CURRENT_YEAR })]);
    setRaces(rs);
    const cm = {}; cs.forEach((c) => (cm[c.id] = c)); setClasses(cm);
    const sm = {}; ss.forEach((s) => (sm[s.id] = s)); setSeries(sm);
  }, []);

  const [scheduled, setScheduled] = useState([]);
  const [schedDate, setSchedDate] = useState("");

  const loadScheduled = useCallback(async () => {
    const list = await api.scheduledRaces();
    setScheduled(list);
    setSchedDate((prev) => prev || new Date().toISOString().slice(0, 10));
  }, []);

  useEffect(() => { loadRaces(); loadScheduled(); api.rrsCodes().then(setRrsCodes); }, [loadRaces, loadScheduled]);

  const startScheduled = async (item) => {
    if (item.race_id) { setSelected(item.race_id); return; }
    const race = await api.createRace({
      date: item.date, class_id: item.class_id, series_id: item.series_id,
      race_number: item.race_number, start_time: item.start_time,
    });
    await loadRaces(); await loadScheduled();
    setSelected(race.id);
  };

  const meta = (r) => ({
    class_id: r.class_id,
    class_name: classes[r.class_id]?.name || "Class",
    series_name: series[r.series_id]?.name || "Series",
    scoring_type: classes[r.class_id]?.scoring_type || "fleet",
  });

  if (selected) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar />
        <RaceConsole raceId={selected} meta={meta(races.find((r) => r.id === selected) || {})} rrsCodes={rrsCodes}
          onBack={() => { setSelected(null); loadRaces(); }} />
      </div>
    );
  }

  const active = races.filter((r) => r.status !== "published");
  const done = races.filter((r) => r.status === "published");

  const RaceRow = ({ r }) => (
    <button data-testid={`race-item-${r.id}`} onClick={() => setSelected(r.id)}
      className="w-full text-left rounded-xl border border-border bg-card p-4 flex items-center gap-3 hover:border-ocean transition-colors active:scale-[0.99]">
      <div className="w-11 h-11 rounded-lg bg-ocean/10 grid place-items-center text-ocean font-heading text-lg">R{r.race_number}</div>
      <div className="flex-1">
        <div className="font-semibold leading-none">{classes[r.class_id]?.name} · {series[r.series_id]?.name}</div>
        <div className="text-xs text-muted-foreground mt-1">{fmtDate(r.date)} · Start {r.start_time}</div>
      </div>
      <Badge className={STATUS_BADGE[r.status]}>{r.status}</Badge>
    </button>
  );

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl uppercase tracking-tighter">Race day</h1>
            <p className="text-muted-foreground text-sm">Set up races, record finishes and publish.</p>
          </div>
          <NewRaceDialog onCreated={(r) => { loadRaces(); setSelected(r.id); }} />
        </div>

        <section className="rounded-xl border border-ocean/20 bg-ocean/5 p-4 mb-8" data-testid="schedule-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-lg md:text-lg uppercase tracking-tight flex items-center gap-2"><CalendarDays className="w-5 h-5 text-ocean" /> Scheduled races</h2>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Race day</Label>
              <Input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} data-testid="schedule-date" className="h-9 w-40" />
            </div>
          </div>
          {(() => {
            const dayItems = scheduled.filter((s) => s.date === schedDate);
            const dates = [...new Set(scheduled.map((s) => s.date))].sort();
            if (!dayItems.length) {
              return (
                <div className="text-sm text-muted-foreground">
                  No races scheduled for this date.
                  {dates[0] && <button className="ml-2 text-ocean font-semibold underline" onClick={() => setSchedDate(dates[0])}>Jump to next race day ({fmtDate(dates[0])})</button>}
                </div>
              );
            }
            return (
              <div className="space-y-2" data-testid="scheduled-list">
                {dayItems.map((item) => (
                  <button key={`${item.series_id}-${item.race_number}`} data-testid={`scheduled-${item.class_name}-${item.race_number}`}
                    onClick={() => startScheduled(item)}
                    className="w-full text-left rounded-lg border border-border bg-card p-3 flex items-center gap-3 hover:border-ocean transition-colors active:scale-[0.99]">
                    <div className="w-10 h-10 rounded-lg bg-safety/15 grid place-items-center text-safety font-heading">R{item.race_number}</div>
                    <div className="flex-1">
                      <div className="font-semibold leading-none">{item.class_name} · {item.series_name}</div>
                      <div className="text-xs text-muted-foreground mt-1">Start {item.start_time}</div>
                    </div>
                    <Badge className={item.status === "scheduled" ? "bg-ocean/10 text-ocean" : STATUS_BADGE[item.status]}>
                      {item.status === "scheduled" ? "Score now" : item.status}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            );
          })()}
        </section>

        <h2 className="text-lg md:text-lg uppercase tracking-tight mb-3">In progress</h2>
        <div className="space-y-3">
          {active.length ? active.map((r) => <RaceRow key={r.id} r={r} />) : <p className="text-muted-foreground text-sm">No active races. Create one to get started.</p>}
        </div>

        {done.length > 0 && (
          <>
            <h2 className="text-lg md:text-lg uppercase tracking-tight mb-3 mt-8">Published</h2>
            <div className="space-y-3">{done.map((r) => <RaceRow key={r.id} r={r} />)}</div>
          </>
        )}
      </main>
    </div>
  );
}
