import { Fragment, useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import ClubPicker from "@/components/ClubPicker";
import ConsoleNav from "@/components/ConsoleNav";
import { fmtDate, fmtDateShort, fmtTime, fmtClock, fmtElapsed, CURRENT_YEAR, CODE_COLORS, miniGroupForRace, miniSeriesNote, raceLabel } from "@/lib/helpers";
import { SeriesStandingsTable } from "@/components/StandingsTable";
import { ElapsedInput } from "@/components/ElapsedInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Anchor, Plus, ChevronLeft, ChevronDown, ChevronUp, Flag, FlagOff, LifeBuoy, Undo2, CheckCircle2, Send, Trash2, Radio, Timer, CalendarDays, ChevronRight, RotateCcw, Clock, Play, Copy, Building2, Pencil, ListChecks, Layers, Globe } from "lucide-react";

const STATUS_BADGE = {
  setup: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  provisional: "bg-amber-100 text-amber-800 animate-pulse dark:bg-amber-500/15 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
};

function useNow(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function startRefMs(race) {
  // Timer reference: the actual gun if fired, otherwise today's scheduled start.
  if (!race) return null;
  if (race.actual_start) {
    const ms = Date.parse(race.actual_start);
    if (!Number.isNaN(ms)) return ms;
  }
  if (!race.date || !race.start_time) return null;
  const d = new Date(`${race.date}T${race.start_time}:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function TopBar({ clubName, onSwitchClub, clubSlug }) {
  const { role, updateSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const clubQuery = searchParams.get("club");
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-ocean/95 text-white">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/15 grid place-items-center"><Radio className="w-5 h-5" /></div>
          <div className="font-heading text-xl uppercase tracking-tight leading-none">Race Officer</div>
          {clubName && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs bg-white/15 rounded-full px-3 py-1 font-semibold">
              <Building2 className="w-3.5 h-3.5" /> {clubName}
            </span>
          )}
        </div>
        <ConsoleNav
          menuLabel={clubName ? `${clubName} · Race Officer` : "Race Officer"}
          onChangedPasscode={updateSession}
          logoutTestId="logout-btn"
          items={[
            ...((role === "admin" || role === "webmaster") ? [{
              key: "admin",
              label: "Admin",
              icon: null,
              onClick: () => navigate(clubQuery ? `/admin?club=${clubQuery}` : "/admin"),
            }] : []),
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
              icon: null,
              onClick: () => navigate("/webmaster"),
            }] : []),
          ]}
        />
      </div>
    </header>
  );
}

function NewRaceDialog({ onCreated, clubId }) {
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState([]);
  const [series, setSeries] = useState([]);
  const [form, setForm] = useState({ class_id: "", series_id: "", date: new Date().toISOString().slice(0, 10), race_number: 1, start_time: "" });

  useEffect(() => { if (open) api.getClasses(clubId ? { club_id: clubId } : {}).then(setClasses); }, [open, clubId]);
  useEffect(() => {
    if (form.class_id) api.getSeries({ class_id: form.class_id, year: CURRENT_YEAR, ...(clubId ? { club_id: clubId } : {}) }).then(setSeries);
  }, [form.class_id, clubId]);

  const create = async () => {
    if (!form.class_id || !form.series_id) return toast.error("Pick a class and series");
    try {
      const race = await api.createRace({
        ...form,
        race_number: Number(form.race_number),
        start_time: form.start_time || null,
        start_tz_offset_minutes: -new Date().getTimezoneOffset(),
      });
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

function RaceConsole({ raceId, meta, series, clubId, onBack, rrsCodes, dayRaces = [], onEnterBatch }) {
  const [race, setRace] = useState(null);
  const [boats, setBoats] = useState({});
  const [boatsReady, setBoatsReady] = useState(false);
  // How the boat buttons are ordered: "last" = the same order as the most
  // recent race's results in this series, "alpha" = boat name, "sail" = sail
  // number. Applies to the boats-racing chips and the big finish buttons.
  const [boatOrder, setBoatOrder] = useState("last");
  const [lastOrder, setLastOrder] = useState([]);
  const [notif, setNotif] = useState({ course: "", special_rules: "", life_jackets: false, start_time: "" });
  const now = useNow();
  // DPI / RDG decision panel: which boat's committee decision is being
  // recorded, and the form fields for it (points are never inferred).
  const [panelBoat, setPanelBoat] = useState(null);
  const emptyDecision = { penalty_points: "", reason: "", decision_maker: "", date: "", notes: "" };
  const [decision, setDecision] = useState(emptyDecision);
  const [validateMsg, setValidateMsg] = useState(null);

  const refresh = useCallback(async () => {
    const r = await api.getRace(raceId);
    setRace(r);
    setNotif({ course: r.course || "", special_rules: r.special_rules || "", life_jackets: !!r.life_jackets, start_time: r.start_time || "" });
  }, [raceId]);

  useEffect(() => {
    refresh();
    api.getBoats({ class_id: meta.class_id }).then((bs) => { const m = {}; bs.forEach((b) => (m[b.id] = b)); setBoats(m); })
      .catch(() => {})
      .finally(() => setBoatsReady(true));
  }, [raceId]); // eslint-disable-line

  // Capture the boat order of the most recent race in the series so the
  // buttons can default to "the same order as the last set of results".
  useEffect(() => {
    if (!race || !race.series_id) return;
    api.getRaces({ series_id: race.series_id })
      .then((races) => {
        const others = (races || [])
          .filter((r) => r.id !== race.id && (r.results || []).length > 0)
          .sort((a, b) => {
            const ka = `${a.date || ""}|${String(a.race_number || 0).padStart(4, "0")}`;
            const kb = `${b.date || ""}|${String(b.race_number || 0).padStart(4, "0")}`;
            return ka < kb ? 1 : ka > kb ? -1 : 0;
          });
        if (others[0]) setLastOrder(others[0].results.map((r) => r.boat_id));
      })
      .catch(() => {});
  }, [race]); // eslint-disable-line

  // Mini-series feature: when the race belongs to a mini series, the console
  // stacks one scoring section per mini-series group (e.g. "Early" and
  // "Late" championships) down the page, each with that group's live standings
  // so the officer can cross-check/publish both on a single scroll.
  const miniGroups = (series && series.mini_series && Array.isArray(series.mini_series_groups))
    ? series.mini_series_groups.filter((g) => (g.race_numbers || []).length > 0)
    : [];
  const [miniStandings, setMiniStandings] = useState({});
  // Depends on the stable `series`/`clubId` props — never on the derived
  // miniGroups array (a fresh array each render would refetch on every paint).
  useEffect(() => {
    const groups = (series && series.mini_series && Array.isArray(series.mini_series_groups))
      ? series.mini_series_groups.filter((g) => (g.race_numbers || []).length > 0)
      : [];
    if (!groups.length) { setMiniStandings({}); return; }
    let cancelled = false;
    groups.forEach((g, idx) => {
      api.seriesStandings(series.id, clubId, idx + 1)
        .then((d) => { if (!cancelled) setMiniStandings((prev) => ({ ...prev, [idx]: d })); })
        .catch(() => { if (!cancelled) setMiniStandings((prev) => ({ ...prev, [idx]: undefined })); });
    });
    return () => { cancelled = true; };
  }, [series, clubId]); // eslint-disable-line

  // Short label for a group's race numbers, e.g. "R1–3" or "R5,R6".
  const miniRangeLabel = (nums) => {
    if (!nums || !nums.length) return "";
    if (nums.length === 1) return `R${nums[0]}`;
    const contig = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    return contig ? `R${nums[0]}–${nums[nums.length - 1]}` : `R${nums.join(",")}`;
  };

  if (!race) return <div className="p-8 text-muted-foreground">Loading race…</div>;

  const startRef = startRefMs(race);
  const racing = race.results.filter((r) => r.code !== "DNC");
  const orderBoatIds = (list) => {
    if (boatOrder === "alpha") {
      return [...list].sort((a, b) => (boats[a.boat_id]?.name || "").localeCompare(boats[b.boat_id]?.name || "", undefined, { numeric: true, sensitivity: "base" }));
    }
    if (boatOrder === "sail") {
      return [...list].sort((a, b) => (boats[a.boat_id]?.sail_no || "").localeCompare(boats[b.boat_id]?.sail_no || "", undefined, { numeric: true }));
    }
    // "last" (default): position in the most recent race's results, then
    // boats that weren't in it (e.g. new boats) keep their stored order.
    const idx = (bid) => {
      const i = lastOrder.indexOf(bid);
      return i === -1 ? lastOrder.length : i;
    };
    return [...list].sort((a, b) => idx(a.boat_id) - idx(b.boat_id));
  };
  const toFinish = orderBoatIds(racing.filter((r) => r.code === "DNS"));
  const finished = race.results.filter((r) => r.code === "FINISHED").sort((a, b) => a.position - b.position);
  // Big fleets (say a dozen or more boats still racing) get a compact layout:
  // more columns and smaller name/sail text so every boat is visible on one
  // screen instead of overflowing a huge wall of buttons.
  const crowded = toFinish.length > 12;

  // Optimistic concurrency: every mutation carries the version of the race
  // this screen loaded, so a concurrent edit by another scorer is rejected
  // (409) instead of silently overwritten — with a clear reload message.
  const version = race.version;
  const runMutation = async (fn, okMsg) => {
    try {
      const r = await fn();
      if (okMsg) toast.success(okMsg);
      refresh();
      return r;
    } catch (e) {
      if (e.response?.status === 409) {
        toast.error("This result has been changed by another user. Your version is out of date. Reload the latest results before making further changes.");
        refresh();
      } else {
        toast.error(e.response?.data?.detail || "Something went wrong");
      }
      return null;
    }
  };
  const saveNotif = () =>
    runMutation(() => api.updateNotifications(raceId, { ...notif, start_tz_offset_minutes: -new Date().getTimezoneOffset() }, version), "Notice updated & published to landing page");
  const toggleBoat = (boatId) => {
    const selected = new Set(racing.map((r) => r.boat_id));
    if (selected.has(boatId)) selected.delete(boatId); else selected.add(boatId);
    return runMutation(() => api.selectBoats(raceId, [...selected], version));
  };
  // Championship regattas: one tap puts every boat on the race as racing.
  const selectAll = () => {
    const all = race.results.map((r) => r.boat_id);
    return runMutation(() => api.selectBoats(raceId, all, version), `${all.length} boats selected as racing`);
  };
  const clearAll = () =>
    runMutation(() => api.selectBoats(raceId, [], version), "Selection cleared — every boat scores DNC");
  const finish = (boatId) =>
    runMutation(() => api.recordFinish(raceId, boatId, new Date().toISOString(), version), `${boats[boatId]?.name} finished`);
  const undo = (boatId) => runMutation(() => api.undoFinish(raceId, boatId, version));
  const changeCode = async (boatId, code) => {
    if (code === "DPI" || code === "RDG") {
      // The committee's decision (points + basis) is recorded together — the
      // engine will not infer a DPI/RDG score.
      const entry = race.results.find((r) => r.boat_id === boatId);
      setDecision({
        penalty_points: entry?.penalty_points ?? "",
        reason: entry?.[`${code.toLowerCase()}_reason`] || "",
        decision_maker: entry?.[`${code.toLowerCase()}_decision_maker`] || "",
        date: entry?.[`${code.toLowerCase()}_date`] || "",
        notes: entry?.[`${code.toLowerCase()}_notes`] || "",
      });
      setPanelBoat(boatId);
      return;
    }
    setPanelBoat(null);
    return runMutation(() => api.adjustResult(raceId, boatId, { code }, version));
  };
  const saveDecision = async (r) => {
    const code = r.code;
    const pts = Number(decision.penalty_points);
    if (Number.isNaN(pts) || decision.penalty_points === "") {
      return toast.error(`${code} requires the committee-entered points — the system will not guess a score`);
    }
    const prefix = code.toLowerCase();
    const payload = { code, penalty_points: pts };
    ["reason", "decision_maker", "date", "notes"].forEach((k) => {
      const v = (decision[k] || "").trim();
      if (v) payload[`${prefix}_${k}`] = v;
    });
    const res = await runMutation(
      () => api.adjustResult(raceId, r.boat_id, payload, version),
      code === "DPI" ? "Discretionary penalty recorded" : "Redress decision recorded");
    if (res) setPanelBoat(null);
  };
  const checkResults = async () => {
    try {
      const v = await api.validateRace(raceId);
      const errs = v.errors || [];
      const warns = v.warnings || [];
      if (!errs.length && !warns.length) {
        setValidateMsg({ level: "ok", text: "No validation issues — results are consistent." });
      } else {
        setValidateMsg({ level: errs.length ? "error" : "warning",
          text: [...errs.map((e) => `⚠ ${e.message}`), ...warns.map((w) => `· ${w.message}`)].join("\n") });
      }
    } catch (e) {
      setValidateMsg({ level: "error", text: e.response?.data?.detail || "Validation unavailable" });
    }
  };
  const changePos = (boatId, position) => runMutation(() => api.adjustResult(raceId, boatId, { position: Number(position) }, version));
  const changeElapsed = (boatId, seconds) => runMutation(() => api.adjustResult(raceId, boatId, { elapsed_seconds: seconds }, version));
  const setStatus = (s) => runMutation(
    () => api.setStatus(raceId, s, version),
    s === "published" ? "Results published to landing page!" :
    s === "setup" ? "Result recalled — race is back in setup" :
    `Marked ${s}`
  ).then((r) => { if (r && s === "published") onBack(); });
  const abandon = (flag) => runMutation(
    () => api.abandonRace(raceId, flag, version),
    flag ? "Race abandoned — removed from series scoring" : "Race restored to the series"
  );
  const remove = () => runMutation(() => api.deleteRace(raceId, version), "Race deleted").then((r) => { if (r) onBack(); });
  const gun = () => runMutation(() => api.startRace(raceId, new Date().toISOString(), version), "Race started — timer running");
  const clearGun = () => runMutation(() => api.startRace(raceId, null, version), "Timer reset to scheduled start");
  const applyToDay = async () => {
    const selected = racing.map((r) => r.boat_id);
    let applied = 0;
    for (const other of dayRaces) {
      const fresh = await api.getRace(other.id);
      if (fresh.results.some((r) => r.code === "FINISHED")) continue; // never clobber a scored race
      const ok = await runMutation(() => api.selectBoats(other.id, selected, fresh.version));
      if (ok) applied += 1;
    }
    toast.success(
      applied
        ? `Selection applied to ${applied} other race${applied > 1 ? "s" : ""} on ${fmtDateShort(race.date)}`
        : "No other races today can be updated (they already have finishes)"
    );
    refresh();
  };

  return (
    <div className="pb-40">
      <div className="sticky top-16 z-30 backdrop-blur-xl bg-background/85 border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="console-back-btn"><ChevronLeft className="w-4 h-4" /> Back</Button>
          <div className="flex-1">
            <div className="font-heading text-lg uppercase tracking-tight leading-none">{meta.class_name} · {meta.series_name}</div>
            <div className="text-xs text-muted-foreground">{race.mini_group_label || `Race ${race.race_number}`} · {fmtDate(race.date)} · Start {race.start_time}</div>
          </div>
          <Badge className={STATUS_BADGE[race.status]}>{race.status}</Badge>
          {race.abandoned && <Badge className="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" data-testid="abandoned-badge">Abandoned</Badge>}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-5 space-y-6">
        {race.abandoned && (
          <section className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-500/10 dark:border-red-500/40 p-4 text-sm text-red-700 dark:text-red-300 flex items-center gap-2" data-testid="abandoned-banner">
            <FlagOff className="w-4 h-4 shrink-0" /> This race is abandoned — it is excluded from the series scoring, so the series has one fewer race scored and its discards may reduce. Use “Restore race” below to count it again.
          </section>
        )}
        {/* Live timing */}
        <section className="rounded-2xl overflow-hidden bg-ocean-dark text-white relative" data-testid="timing-strip">
          <div className="absolute inset-0 bg-gradient-to-br from-ocean-dark via-ocean to-ocean-light opacity-90" />
          <div className="relative p-4 sm:p-5 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-white/60"><Clock className="w-3.5 h-3.5" /> Clock</div>
                <div className="font-mono text-3xl sm:text-4xl font-bold tabular-nums leading-none mt-1">{fmtClock(now)}</div>
              </div>
              <div className="w-px h-10 bg-white/20" />
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-widest text-white/60">{race.actual_start ? "Race time" : "To start"}</div>
                {(() => {
                  const elapsed = startRef ? now - startRef : null;
                  if (elapsed == null) {
                    return <div className="font-mono text-3xl sm:text-4xl font-bold tabular-nums leading-none text-white/40 mt-1">--:--</div>;
                  }
                  const live = race.actual_start || elapsed >= 0;
                  const cls = live ? (race.actual_start ? "text-safety" : "text-white") : "text-amber-300";
                  return <div className={`font-mono text-3xl sm:text-4xl font-bold tabular-nums leading-none mt-1 ${cls} ${race.actual_start ? "animate-pulse" : ""}`}>{fmtElapsed(elapsed)}</div>;
                })()}
                <div className="text-[10px] text-white/60 mt-0.5">
                  {race.actual_start ? `Gun ${fmtClock(Date.parse(race.actual_start))}` : `Scheduled ${race.start_time}`}
                </div>
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {race.actual_start && (
                <Button size="sm" variant="outline" className="border-white/30 text-white hover:bg-white/10" onClick={clearGun} data-testid="clear-gun-btn">
                  <RotateCcw className="w-4 h-4" /> Reset
                </Button>
              )}
              <Button className="gap-2 bg-safety hover:bg-safety-dark text-white" onClick={gun} data-testid="start-gun-btn" disabled={race.status === "published"}>
                <Play className="w-4 h-4" /> {race.actual_start ? "Re-start" : "Start race"}
              </Button>
            </div>
          </div>
        </section>

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
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="font-heading uppercase tracking-tight">Boats racing today</h3>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 border-ocean/40 text-ocean hover:bg-ocean hover:text-white" data-testid="select-all-boats-btn" onClick={selectAll}>
                <ListChecks className="w-3.5 h-3.5" /> All
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" data-testid="clear-all-boats-btn" onClick={clearAll}>Clear</Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-3">Tap to include. Unselected boats score <strong>DNC</strong>.</p>
          <div className="flex flex-wrap gap-2" data-testid="boat-select-list">
            {!boatsReady && <p className="text-sm text-muted-foreground">Loading boats…</p>}
            {boatsReady && orderBoatIds(race.results).map((r) => {
              const b = boats[r.boat_id] || {};
              const isRacing = r.code !== "DNC";
              return (
                <button key={r.boat_id} data-testid={`boat-toggle-${b.sail_no}`} onClick={() => toggleBoat(r.boat_id)}
                  className={`rounded-lg border font-semibold transition-transform active:scale-95 ${crowded ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"} ${isRacing ? "bg-ocean text-white border-ocean" : "bg-background border-border text-muted-foreground"}`}>
                  {b.name} <span className={`font-mono opacity-80 ${crowded ? "text-[10px]" : "text-xs"}`}>{b.sail_no}</span>
                </button>
              );
            })}
          </div>
          {dayRaces.length > 0 && (
            <Button variant="outline" size="sm" className="mt-3 gap-1.5 border-ocean/40 text-ocean hover:bg-ocean hover:text-white" onClick={applyToDay} data-testid="apply-day-btn">
              <Copy className="w-4 h-4" /> Apply selection to all {dayRaces.length + 1} races on {fmtDateShort(race.date)}
            </Button>
          )}
        </section>

        {/* Finish recording */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h3 className="font-heading uppercase tracking-tight flex items-center gap-2"><Timer className="w-5 h-5 text-safety" /> Record finishes</h3>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Order</Label>
              <Select value={boatOrder} onValueChange={setBoatOrder}>
                <SelectTrigger className="h-8 w-44" data-testid="finish-order-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="last">Last results</SelectItem>
                  <SelectItem value="alpha">Alphabetical</SelectItem>
                  <SelectItem value="sail">Sail number</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-3">Big tap = finish time captured now. {toFinish.length} still racing.</p>
          <div className={`grid gap-2 sm:gap-3 ${crowded ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-5" : "grid-cols-2 sm:grid-cols-3"}`} data-testid="finish-grid">
            {!boatsReady && <div className="col-span-full text-sm text-muted-foreground py-4">Loading boats…</div>}
            {boatsReady && toFinish.map((r) => {
              const b = boats[r.boat_id] || {};
              return (
                <button key={r.boat_id} data-testid={`finish-btn-${b.sail_no}`} onClick={() => finish(r.boat_id)}
                  className={`race-btn rounded-2xl bg-safety text-white flex flex-col items-center justify-center text-center px-1 transition-transform active:scale-95 hover:bg-safety-dark ${crowded ? "h-16 sm:h-20" : "h-28"}`}>
                  <span className={`font-heading uppercase tracking-tight leading-none ${crowded ? "text-sm sm:text-base" : "text-2xl"}`}>{b.name}</span>
                  <span className={`font-mono opacity-90 mt-0.5 ${crowded ? "text-sm sm:text-base" : "text-2xl mt-1"}`}>{b.sail_no}</span>
                </button>
              );
            })}
            {boatsReady && toFinish.length === 0 && <div className="col-span-full text-sm text-muted-foreground py-4">All racing boats have finished, or none selected yet.</div>}
          </div>

          {finished.length > 0 && (
            <div className="mt-5 rounded-xl border border-border bg-card divide-y" data-testid="finished-list">
              {finished.map((r) => {
                const b = boats[r.boat_id] || {};
                return (
                  <div key={r.boat_id} className="flex items-center gap-3 p-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-800 grid place-items-center font-heading text-lg">{r.position}</div>
                    <div className="flex-1"><div className="font-semibold leading-none">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span></div>
                      <div className="font-mono text-xs text-muted-foreground mt-0.5">{fmtTime(r.finish_time)}{(() => {
                        const e = startRef ? Date.parse(r.finish_time) - startRef : null;
                        return e != null && e >= 0 ? <span className="text-ocean font-bold"> · +{fmtElapsed(e)}</span> : null;
                      })()}</div></div>
                    <Button size="sm" variant="outline" data-testid={`undo-btn-${b.sail_no}`} onClick={() => undo(r.boat_id)}><Undo2 className="w-4 h-4" /></Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Provisional / adjust */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-heading uppercase tracking-tight">Provisional results & penalties</h3>
            <Button size="sm" variant="outline" className="h-8 border-ocean/40 text-ocean" data-testid="validate-btn" onClick={checkResults}>Check results</Button>
          </div>
          {validateMsg && (
            <div className={`mb-3 rounded-lg p-3 text-xs whitespace-pre-line ${validateMsg.level === "ok" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : validateMsg.level === "error" ? "bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-300" : "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"}`} data-testid="validate-msg">
              {validateMsg.text}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b"><th className="py-2">Boat</th><th className="w-20">Pos</th><th className="w-28">Elapsed</th><th className="w-44">Code / Penalty (RRS)</th></tr></thead>
              <tbody data-testid="adjust-table">
                {[...race.results].sort((a, b) => {
                  if (a.code === "FINISHED" && b.code === "FINISHED") return a.position - b.position;
                  if (a.code === "FINISHED") return -1; if (b.code === "FINISHED") return 1; return 0;
                }).map((r) => {
                  const b = boats[r.boat_id] || {};
                  const isManual = r.code === "DPI" || r.code === "RDG";
                  return (
                    <Fragment key={r.boat_id}>
                    <tr className="border-b last:border-0">
                      <td className="py-2 font-semibold">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.sail_no}</span></td>
                      <td>
                        {r.code === "FINISHED"
                          ? <Input type="number" min="1" value={r.position || ""} data-testid={`pos-input-${b.sail_no}`} className="h-8 w-16 font-mono" onChange={(e) => changePos(r.boat_id, e.target.value)} />
                          : <Badge variant="outline" className={CODE_COLORS[r.code]}>{r.code}</Badge>}
                      </td>
                      <td>
                        {r.code === "FINISHED"
                          ? <ElapsedInput finishTime={r.finish_time} race={race} onCommit={(secs) => changeElapsed(r.boat_id, secs)} data-testid={`elapsed-input-${b.sail_no}`} className="[&_input]:w-12" />
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Select value={r.code} onValueChange={(v) => changeCode(r.boat_id, v)}>
                            <SelectTrigger className="h-8" data-testid={`code-select-${b.sail_no}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{rrsCodes.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                          </Select>
                          {isManual && (
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-ocean" title="Record / edit the committee decision"
                              data-testid={`decision-btn-${b.sail_no}`}
                              onClick={() => {
                                setDecision({
                                  penalty_points: r.penalty_points ?? "",
                                  reason: r[`${r.code.toLowerCase()}_reason`] || "",
                                  decision_maker: r[`${r.code.toLowerCase()}_decision_maker`] || "",
                                  date: r[`${r.code.toLowerCase()}_date`] || "",
                                  notes: r[`${r.code.toLowerCase()}_notes`] || "",
                                });
                                setPanelBoat(panelBoat === r.boat_id ? null : r.boat_id);
                              }}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                        {isManual && r.penalty_points != null && r.penalty_points !== "" && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {r.penalty_points} pts{r[`${r.code.toLowerCase()}_decision_maker`] ? ` · ${r[`${r.code.toLowerCase()}_decision_maker`]}` : ""}
                          </div>
                        )}
                      </td>
                    </tr>
                    {panelBoat === r.boat_id && (
                      <tr className="border-b bg-muted/30">
                        <td colSpan={4} className="py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div className="space-y-1"><Label className="text-[10px] uppercase">Resulting points</Label><Input type="number" min="0" step="0.5" className="h-8" value={decision.penalty_points} onChange={(e) => setDecision({ ...decision, penalty_points: e.target.value })} data-testid={`decision-points-${b.sail_no}`} /></div>
                            <div className="space-y-1"><Label className="text-[10px] uppercase">Decision-maker / committee</Label><Input className="h-8" value={decision.decision_maker} onChange={(e) => setDecision({ ...decision, decision_maker: e.target.value })} data-testid={`decision-maker-${b.sail_no}`} /></div>
                            <div className="space-y-1"><Label className="text-[10px] uppercase">Date</Label><Input type="date" className="h-8" value={decision.date} onChange={(e) => setDecision({ ...decision, date: e.target.value })} data-testid={`decision-date-${b.sail_no}`} /></div>
                            <div className="space-y-1"><Label className="text-[10px] uppercase">Reason / rule basis</Label><Input className="h-8" value={decision.reason} onChange={(e) => setDecision({ ...decision, reason: e.target.value })} data-testid={`decision-reason-${b.sail_no}`} placeholder="e.g. RRS 44.1(b)" /></div>
                            <div className="col-span-full space-y-1"><Label className="text-[10px] uppercase">Notes</Label><Input className="h-8" value={decision.notes} onChange={(e) => setDecision({ ...decision, notes: e.target.value })} data-testid={`decision-notes-${b.sail_no}`} /></div>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-[11px] text-muted-foreground">{r.code === "DPI" ? "Discretionary penalty — imposed by the committee; the score is recorded, never inferred." : "Redress granted — the boat's score is adjusted without changing other boats' positions unless the committee directed it."}</p>
                            <Button size="sm" className="bg-ocean hover:bg-ocean-dark h-8" data-testid={`decision-save-${b.sail_no}`} onClick={() => saveDecision(r)}>Save decision</Button>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Mini-series scoring: one section per mini group, so the officer
            can see each mini championship's live standings down the page. */}
        {miniGroups.length > 0 && (
          <div className="space-y-6">
            <div className="pt-2">
              <div className="flex items-center justify-between gap-2 w-full">
                <h3 className="font-heading uppercase tracking-tight flex items-center gap-2">
                  <Layers className="w-4 h-4 text-ocean" /> Mini-series scoring
                </h3>
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1.5 border-ocean/40 text-ocean hover:bg-ocean hover:text-white" data-testid="batch-entry-btn" onClick={() => {
                  if (miniGroups.length > 0 && onEnterBatch) onEnterBatch({ group: miniGroups[0], groupIndex: 0, seriesId: race.series_id || meta.series_id, series: series, className: meta.class_name });
                }}>
                  <ListChecks className="w-3.5 h-3.5" /> Batch entry
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Each mini series scores as its own championship. Scroll down to review both groups' standings.</p>
            </div>
            {miniGroups.map((g, idx) => {
              const data = miniStandings[idx];
              return (
                <section key={idx} data-testid={`mini-scoring-section-${idx + 1}`} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-lg bg-ocean/10 grid place-items-center text-ocean font-heading font-bold">{idx + 1}</span>
                      <div>
                        <h3 className="font-heading uppercase tracking-tight leading-none">{g.name || `Mini ${idx + 1}`}</h3>
                        <div className="text-xs text-muted-foreground mt-1">
                          {miniRangeLabel(g.race_numbers)}
                          {g.discards > 0 ? ` · ${g.discards} discard${g.discards !== 1 ? "s" : ""}` : " · no discards"}
                          {g.scoring === "combined" ? " · combined into one daily result" : ""}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className={miniSeriesNote(g) ? "border-ocean/40 text-ocean capitalize" : ""}>
                      {g.scoring === "combined" ? "Combined day" : "Separate races"}
                    </Badge>
                  </div>
                  <SeriesStandingsTable data={data} />
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 backdrop-blur-xl bg-background/90 border-t border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          {race.abandoned ? (
            <Button variant="outline" className="h-12 border-emerald-500 text-emerald-700 gap-1.5" data-testid="restore-race-btn"
              onClick={() => { if (window.confirm("Restore this race to the series? It will count towards the series scoring again.")) abandon(false); }}>
              <Undo2 className="w-4 h-4" /> Restore race
            </Button>
          ) : (
            <Button variant="outline" className="h-12 border-red-400 text-red-600 gap-1.5" data-testid="abandon-race-btn"
              onClick={() => { if (window.confirm("Abandon this race? It will be removed from the series scoring — the series will have one fewer race scored and its discards may reduce. Its results are kept for the record.")) abandon(true); }}>
              <FlagOff className="w-4 h-4" /> Abandon race
            </Button>
          )}
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

export function MiniSeriesBatchEntry({ group, groupIndex, seriesId, clubId, classes, seriesMap, onClose }) {
  const [races, setRaces] = useState([]);
  const [boatsMap, setBoatsMap] = useState({});
  const [expandMap, setExpandMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [addingRace, setAddingRace] = useState(false);
  // Fleet sign-on: ONE boat selection shared across every race in the group.
  const [fleetSelected, setFleetSelected] = useState([]);
  const [fleetBusy, setFleetBusy] = useState(false);
  const [fleetInitialised, setFleetInitialised] = useState(false);

  const fetchRace = useCallback(async (raceId) => {
    try { return await api.getRace(raceId); } catch { return null; }
  }, []);

  const loadGroup = useCallback(async (setLoadingOn = true) => {
    const allRaces = await api.getRaces({ series_id: seriesId, club_id: clubId });
    const groupRaces = [];
    for (const r of allRaces) {
      if ((group.race_numbers || []).includes(r.race_number)) {
        const fresh = await fetchRace(r.id);
        if (fresh) groupRaces.push(fresh);
      }
    }
    groupRaces.sort((a, b) => a.race_number - b.race_number);
    setRaces(groupRaces);
    const classIds = [...new Set(groupRaces.map((r) => r.class_id))];
    const bm = {};
    for (const cid of classIds) {
      try {
        const bs = await api.getBoats({ class_id: cid });
        bs.forEach((b) => (bm[b.id] = b));
      } catch {}
    }
    setBoatsMap(bm);
    if (setLoadingOn) setLoading(false);
  }, [group, seriesId, clubId, fetchRace]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadGroup(false);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadGroup]);

  // Auto-expand every unpublished race so the scoring controls are visible
  // immediately — the officer scores race 1, then race 2, and so on down the
  // page without clicking each card open. Once seeded, manual expand/collapse
  // state is respected.
  useEffect(() => {
    if (loading) return;
    setExpandMap((prev) => {
      if (Object.keys(prev).length === races.length) return prev;
      const map = {};
      races.forEach((r) => (map[r.id] = r.status !== "published"));
      return map;
    });
  }, [loading, races]);

  // Seed the fleet selection from the first race once the group loads.
  useEffect(() => {
    if (loading || fleetInitialised || !races.length) return;
    const first = races[0];
    const racing = (first.results || []).filter((r) => r.code !== "DNC").map((r) => r.boat_id);
    setFleetSelected(racing);
    setFleetInitialised(true);
  }, [loading, fleetInitialised, races]);

  const allBoatIds = Object.keys(boatsMap);
  const toggleFleetBoat = (bid) =>
    setFleetSelected((prev) => (prev.includes(bid) ? prev.filter((x) => x !== bid) : [...prev, bid]));

  const mutate = useCallback(async (fn, silent) => {
    try {
      const r = await fn();
      if (!silent) toast.success("Updated");
      return r;
    } catch (e) {
      if (e.response?.status === 409) {
        toast.error("Changed by another user — reloading");
      } else {
        toast.error(e.response?.data?.detail || "Something went wrong");
      }
      return null;
    }
  }, []);

  // Apply the fleet selection to every unpublished race in the group, then
  // refresh so the race cards reflect the signed-on fleet.
  const applyFleet = useCallback(async () => {
    setFleetBusy(true);
    try {
      let applied = 0;
      for (const race of races) {
        if (race.status === "published") continue;
        const r = await mutate(() => api.selectBoats(race.id, fleetSelected, race.version), true);
        if (r) applied++;
      }
      if (applied) toast.success(`Fleet signed on for ${applied} race${applied > 1 ? "s" : ""}`);
      const allRaces = await api.getRaces({ series_id: seriesId, club_id: clubId });
      const updated = [];
      for (const r of allRaces) {
        if ((group.race_numbers || []).includes(r.race_number)) {
          const fresh = await fetchRace(r.id);
          if (fresh) updated.push(fresh);
        }
      }
      updated.sort((a, b) => a.race_number - b.race_number);
      setRaces(updated);
    } finally {
      setFleetBusy(false);
    }
  }, [races, fleetSelected, group, seriesId, clubId, mutate, fetchRace]);

  const refreshRace = useCallback(async (raceId, setFn) => {
    const fresh = await fetchRace(raceId);
    if (fresh) setFn ? setFn(fresh) : setRaces((prev) => prev.map((r) => r.id === raceId ? fresh : r));
  }, [fetchRace]);

  const toggleBoat = useCallback(async (race) => {
    const racing = race.results.filter((r) => r.code !== "DNC").map((r) => r.boat_id);
    return mutate(() => api.selectBoats(race.id, racing, race.version));
  }, [mutate]);

  const addBoatToRace = useCallback(async (race, boatId) => {
    const racing = race.results.filter((r) => r.code !== "DNC").map((r) => r.boat_id);
    if (racing.includes(boatId)) return;
    racing.push(boatId);
    const r = await mutate(() => api.selectBoats(race.id, racing, race.version), true);
    if (r) await refreshRace(race.id);
  }, [mutate, refreshRace]);

  const removeBoatFromRace = useCallback(async (race, boatId) => {
    const racing = race.results.filter((r) => r.code !== "DNC" && r.boat_id !== boatId).map((r) => r.boat_id);
    const r = await mutate(() => api.selectBoats(race.id, racing, race.version), true);
    if (r) await refreshRace(race.id);
  }, [mutate, refreshRace]);

  const finishBoat = useCallback(async (race, boatId) => {
    const r = await mutate(() => api.recordFinish(race.id, boatId, new Date().toISOString(), race.version), true);
    if (r) await refreshRace(race.id);
  }, [mutate, refreshRace]);

  const publish = useCallback(async (race) => {
    const r = await mutate(() => api.setStatus(race.id, "published", race.version));
    if (r) await refreshRace(race.id);
  }, [mutate, refreshRace]);

  // Recall a published mini-series race back to setup — the same correction
  // the single-race console offers, so a mis-published race can be fixed
  // without leaving the batch page.
  const recall = useCallback(async (race) => {
    const r = await mutate(() => api.setStatus(race.id, "setup", race.version));
    if (r) await refreshRace(race.id);
  }, [mutate, refreshRace]);

  const publishAll = useCallback(async () => {
    let count = 0;
    for (const race of races) {
      if (race.status === "published") continue;
      const r = await mutate(() => api.setStatus(race.id, "published", race.version), true);
      if (r) count++;
    }
    if (count) toast.success(`Published ${count} race${count > 1 ? "s" : ""}`);
    const allRaces = await api.getRaces({ series_id: seriesId, club_id: clubId });
    const updated = [];
    for (const r of allRaces) {
      if ((group.race_numbers || []).includes(r.race_number)) {
        const fresh = await fetchRace(r.id);
        if (fresh) updated.push(fresh);
      }
    }
    updated.sort((a, b) => a.race_number - b.race_number);
    setRaces(updated);
  }, [races, group, seriesId, clubId, mutate, fetchRace]);

  // Grow the mini series by one race on the day (only possible when it is the
  // last group of the series — the backend enforces this too).
  const addRace = useCallback(async () => {
    setAddingRace(true);
    try {
      const res = await api.addMiniRace(seriesId, groupIndex, {});
      toast.success(`Added race ${res.race.mini_group_label || res.race.race_number}`);
      await loadGroup();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not add a race");
    } finally {
      setAddingRace(false);
    }
  }, [seriesId, groupIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (raceId) => setExpandMap((prev) => ({ ...prev, [raceId]: !prev[raceId] }));
  const remaining = races.filter((r) => r.status !== "published");
  const allPublished = remaining.length === 0;

  // A race's step on the timeline: Published / Scored (all finishes in) /
  // the first race still to score (Active) / everything later (Pending).
  const raceState = (race) => {
    if (race.status === "published") return "published";
    const racing = (race.results || []).filter((r) => r.code !== "DNC");
    if (racing.length > 0 && racing.every((r) => r.code === "FINISHED")) return "scored";
    return "pending";
  };
  const firstActiveIdx = races.findIndex((r) => raceState(r) === "pending");
  const stateFor = (race, i) => {
    if (raceState(race) !== "pending") return raceState(race);
    return i === firstActiveIdx ? "active" : "pending";
  };
  const goToRace = (race) => {
    if (race.status !== "published" && !expandMap[race.id]) {
      setExpandMap((prev) => ({ ...prev, [race.id]: true }));
    }
    requestAnimationFrame(() => {
      document.getElementById(`batch-race-${race.race_number}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const STEP_STYLES = {
    published: "bg-emerald-600 text-white border-emerald-600",
    scored: "bg-amber-400 text-white border-amber-400",
    active: "bg-ocean text-white border-ocean ring-2 ring-ocean/30",
    pending: "bg-muted text-muted-foreground border-border",
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading batch entry…</p>
      </div>
    );
  }

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="sticky top-16 z-30 backdrop-blur-xl bg-background/85 border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="batch-back-btn"><ChevronLeft className="w-4 h-4" /> Back</Button>
          <div className="flex-1">
            <div className="font-heading text-lg uppercase tracking-tight leading-none">{group.name || `Mini ${groupIndex + 1}`}</div>
            <div className="text-xs text-muted-foreground">
              {races.length} race{races.length !== 1 ? "s" : ""}
              {allPublished
                ? " · all published"
                : ` · ${remaining.length} remaining`}
              {group.discards > 0 ? ` · ${group.discards} discard${group.discards !== 1 ? "s" : ""}` : ""}
            </div>
          </div>
          {races.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5 border-ocean/40 text-ocean hover:bg-ocean hover:text-white" data-testid="add-mini-race-btn" onClick={addRace} disabled={addingRace}>
              <Plus className="w-4 h-4" /> {addingRace ? "Adding…" : "Add race"}
            </Button>
          )}
          {remaining.length > 0 && (
            <Button className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" data-testid="publish-all-btn" onClick={publishAll}>
              <Send className="w-4 h-4" /> Publish all ({remaining.length})
            </Button>
          )}
        </div>
      </div>

      {/* Race cards */}
      <div className="max-w-5xl mx-auto px-4 pt-5 space-y-4">
        {/* Workflow guidance: sign on → score each race → publish */}
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="workflow-steps">
          <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded-full bg-ocean text-white grid place-items-center text-[11px] font-heading">1</span> Sign on the fleet</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded-full bg-ocean text-white grid place-items-center text-[11px] font-heading">2</span> Score each race</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded-full bg-emerald-600 text-white grid place-items-center text-[11px] font-heading">3</span> Publish results</span>
        </div>

        {/* Step 1 — sign on the fleet: ONE selection applied to every race */}
        <div className="rounded-xl border border-border bg-card p-4" data-testid="fleet-signon">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-lg bg-ocean/10 grid place-items-center text-ocean font-heading font-bold text-sm">1</span>
            <h3 className="font-heading uppercase tracking-tight text-sm">Sign on the fleet</h3>
            <span className="ml-auto text-xs text-muted-foreground">{fleetSelected.length} of {allBoatIds.length} boats</span>
          </div>
          <p className="text-xs text-muted-foreground mb-2.5">Pick which boats are racing — the selection applies to every race in this mini series.</p>
          {allBoatIds.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {allBoatIds.map((bid) => {
                  const b = boatsMap[bid] || {};
                  const on = fleetSelected.includes(bid);
                  return (
                    <button key={bid} onClick={() => toggleFleetBoat(bid)} data-testid={`fleet-boat-${b.sail_no || bid}`}
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold transition-all active:scale-95 ${on ? "bg-ocean text-white border-ocean" : "bg-background border-border text-muted-foreground hover:border-ocean/40"}`}>
                      {b.name || "?"} <span className="font-mono opacity-80">{b.sail_no || ""}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => setFleetSelected([...allBoatIds])} data-testid="fleet-signon-all">Sign on all</Button>
                <Button size="sm" variant="outline" onClick={() => setFleetSelected([])} data-testid="fleet-signon-none">Clear</Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 ml-auto gap-1.5" onClick={applyFleet} disabled={fleetBusy} data-testid="fleet-apply-btn">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {fleetBusy ? "Applying…" : "Apply to all races"}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No boats registered for this class yet.</p>
          )}
        </div>

        {/* Timeline: every race pre-shown in order, so the officer scores
            race 1 → race 2 → … without hunting for the next card. Only shown
            when the mini series has at least 2 races. */}
        {races.length >= 2 && (
          <div className="rounded-xl border border-border bg-card px-4 py-4" data-testid="race-timeline">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-lg bg-ocean/10 grid place-items-center text-ocean font-heading font-bold text-sm">2</span>
              <h3 className="font-heading uppercase tracking-tight text-sm">Races today</h3>
              <span className="ml-auto text-xs text-muted-foreground">Tap a race to jump to its results</span>
            </div>
            <div className="flex items-start overflow-x-auto pb-1">
              {races.map((race, i) => {
                const st = stateFor(race, i);
                const racing = (race.results || []).filter((r) => r.code !== "DNC");
                const finished = racing.filter((r) => r.code === "FINISHED").length;
                return (
                  <div key={race.id} className="flex items-start">
                    <button onClick={() => goToRace(race)} data-testid={`timeline-race-${race.race_number}`}
                      className={`flex flex-col items-center gap-1.5 group text-center w-20 shrink-0`}>
                      <span className={`w-10 h-10 rounded-full border-2 grid place-items-center font-heading text-sm transition-transform group-hover:scale-105 ${STEP_STYLES[st]}`}>
                        {st === "published" ? <CheckCircle2 className="w-5 h-5" /> : (st === "scored" ? <CheckCircle2 className="w-5 h-5" /> : i + 1)}
                      </span>
                      <span className={`text-[11px] font-semibold leading-tight ${st === "pending" ? "text-muted-foreground" : "text-foreground"}`}>
                        {race.mini_group_label || `Race ${race.race_number}`}
                      </span>
                      <span className="text-[10px] text-muted-foreground leading-none">
                        {st === "published" ? "Published" : st === "scored" ? "Scored" : st === "active" ? "Score now" : finished > 0 ? `${finished} finished` : "Waiting"}
                      </span>
                    </button>
                    {i < races.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground/40 mt-3.5 shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {group.scoring === "combined" && (
          <div className="rounded-xl border border-ocean/30 bg-ocean/5 p-3 text-sm text-ocean flex items-center gap-2" data-testid="combined-note">
            <Layers className="w-4 h-4 shrink-0" />
            <span>Combined mini series — these {races.length} races fold into <strong>one result</strong> in the series standings. Publish them all to confirm the combined score.</span>
          </div>
        )}
        {allPublished && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/40 p-4 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2" data-testid="all-published-banner">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> All {races.length} races in this group are published.
          </div>
        )}
        {races.map((race, raceIdx) => {
          const expanded = expandMap[race.id];
          const allBoats = race.results || [];
          const racing = allBoats.filter((r) => r.code !== "DNC");
          const finished = racing.filter((r) => r.code === "FINISHED");
          const toFinish = racing.filter((r) => r.code === "DNS");
          // A race is "Scored" once every boat signed on has a finish.
          const scored = racing.length > 0 && racing.every((r) => r.code === "FINISHED");
          const st = stateFor(race, raceIdx);
          const nextRace = races[raceIdx + 1];
          const cls = classes[race.class_id] || {};
          return (
            <section key={race.id} id={`batch-race-${race.race_number}`} className="rounded-xl border border-border bg-card overflow-hidden" data-testid={`batch-race-${race.race_number}`}>
              {/* Race header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-lg bg-ocean/10 grid place-items-center text-ocean font-heading text-lg shrink-0">{race.mini_group_label || `R${race.race_number}`}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm leading-none">{race.start_time || "TBD"}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(race.date)} · {cls.name || "Class"} · R{race.race_number}</div>
                </div>
                <Badge className={race.status === "published" ? STATUS_BADGE.published : scored ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : STATUS_BADGE[race.status]}>
                  {race.status === "published" ? "Published" : scored ? "Scored" : "Not started"}
                </Badge>
                {st === "active" && <span className="text-[10px] font-bold uppercase tracking-wide text-ocean">◄ You are here</span>}
                {race.status !== "published" && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 px-3 gap-1" data-testid={`publish-btn-${race.race_number}`} onClick={() => publish(race)}>
                    <Send className="w-3.5 h-3.5" /> Publish
                  </Button>
                )}
                {race.status === "published" && (
                  <Button size="sm" variant="outline" className="h-8 px-3 gap-1 border-amber-500 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-500/10" data-testid={`recall-btn-${race.race_number}`}
                    onClick={() => { if (window.confirm(`Recall ${race.mini_group_label || `race ${race.race_number}`} and roll it back to setup? It will be removed from the public results.`)) recall(race); }}>
                    <RotateCcw className="w-3.5 h-3.5" /> Recall
                  </Button>
                )}
                <button onClick={() => toggleExpand(race.id)} className="p-1 rounded-lg hover:bg-muted transition-colors" data-testid={`expand-btn-${race.race_number}`}>
                  {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              {/* Expanded: boat selection + finish recording */}
              {expanded && race.status !== "published" && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                  {/* Boat selection */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">Boats racing</span>
                      <span className="text-xs text-muted-foreground">{racing.length} selected</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {allBoats.map((r) => {
                        const b = boatsMap[r.boat_id] || {};
                        const isRacing = r.code !== "DNC";
                        return (
                          <button key={r.boat_id}
                            onClick={() => isRacing ? removeBoatFromRace(race, r.boat_id) : addBoatToRace(race, r.boat_id)}
                            data-testid={`batch-boat-${race.race_number}-${b.sail_no || r.boat_id}`}
                            className={`rounded-lg border px-2 py-1 text-xs font-semibold transition-all active:scale-95 ${isRacing ? "bg-ocean text-white border-ocean" : "bg-background border-border text-muted-foreground hover:border-ocean/40"}`}>
                            {b.name || "?"} <span className="font-mono opacity-80">{b.sail_no || ""}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Finish buttons */}
                  {toFinish.length > 0 && (
                    <div>
                      <span className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">Tap to finish</span>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {toFinish.map((r) => {
                          const b = boatsMap[r.boat_id] || {};
                          return (
                            <button key={r.boat_id}
                              onClick={() => finishBoat(race, r.boat_id)}
                              data-testid={`batch-finish-${race.race_number}-${b.sail_no || r.boat_id}`}
                              className="race-btn rounded-xl bg-safety text-white flex flex-col items-center justify-center text-center py-3 px-2 transition-transform active:scale-95 hover:bg-safety-dark">
                              <span className="font-heading uppercase tracking-tight text-base leading-none">{b.name || "?"}</span>
                              <span className="font-mono text-sm opacity-90 mt-0.5">{b.sail_no || ""}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Results summary */}
                  {finished.length > 0 && (
                    <div className="rounded-lg bg-muted/30 divide-y">
                      {finished.sort((a, b) => a.position - b.position).map((r) => {
                        const b = boatsMap[r.boat_id] || {};
                        return (
                          <div key={r.boat_id} className="flex items-center gap-2 px-3 py-2">
                            <span className="w-6 h-6 rounded bg-emerald-100 text-emerald-800 grid place-items-center font-heading text-xs shrink-0">{r.position}</span>
                            <span className="flex-1 text-sm font-semibold truncate">{b.name || "?"} <span className="font-mono text-xs text-muted-foreground">{b.sail_no || ""}</span></span>
                            <span className="text-xs font-mono text-muted-foreground">{fmtTime(r.finish_time)}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={async () => { await mutate(() => api.undoFinish(race.id, r.boat_id, race.version), true); await refreshRace(race.id); }} data-testid={`batch-undo-${race.race_number}-${b.sail_no || r.boat_id}`}>
                              <Undo2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <Button variant="outline" size="sm" className="w-full text-ocean border-ocean/30 hover:bg-ocean hover:text-white" data-testid={`batch-full-console-${race.race_number}`}                    onClick={() => onClose(race.id)}>
                    Open full race console
                  </Button>
                </div>
              )}
              {/* Expanded: published race shows results summary */}
              {expanded && race.status === "published" && (
                <div className="px-4 pb-4 border-t border-border/50 pt-3">
                  {finished.length > 0 && (
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 divide-y">
                      {finished.sort((a, b) => a.position - b.position).map((r) => {
                        const b = boatsMap[r.boat_id] || {};
                        return (
                          <div key={r.boat_id} className="flex items-center gap-2 px-3 py-2">
                            <span className="w-6 h-6 rounded bg-emerald-100 text-emerald-800 grid place-items-center font-heading text-xs shrink-0">{r.position}</span>
                            <span className="flex-1 text-sm font-semibold truncate">{b.name || "?"} <span className="font-mono text-xs text-muted-foreground">{b.sail_no || ""}</span></span>
                            <span className="text-xs font-mono text-muted-foreground">{fmtTime(r.finish_time)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {finished.length === 0 && <p className="text-sm text-muted-foreground">No results recorded.</p>}
                </div>
              )}
              {/* Guide the officer through the sequence: race 1 → race 2 → … */}
              {nextRace && (
                <button onClick={() => goToRace(nextRace)}
                  data-testid={`next-race-btn-${race.race_number}`}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold border-t border-border/60 bg-muted/40 hover:bg-ocean hover:text-white transition-colors text-left">
                  <span>Next up: {nextRace.mini_group_label || `Race ${nextRace.race_number}`}</span>
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function SplitMiniDialog({ target, onClose, onSplit }) {
  const [count, setCount] = useState(2);
  const [name, setName] = useState("");
  const [scoring, setScoring] = useState("combined");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await api.splitMiniSeries(target.series_id, {
        race_number: target.race_number,
        count,
        name: name.trim(),
        scoring,
      });
      toast.success(`Split race ${target.race_number} into ${count} races — mini series created`);
      onSplit(res);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not split the race");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="mini-split-dialog">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">Split into a mini series</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Run race {target?.race_number} as several shorter races for this class today, scored together as a mini series.
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>How many races?</Label>
            <Input type="number" min="2" max="20" value={count}
              onChange={(e) => setCount(Math.max(2, Math.min(20, Number(e.target.value) || 2)))}
              data-testid="mini-split-count" />
          </div>
          <div className="space-y-2">
            <Label>Name (optional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder={target ? `${target.class_name} · R${target.race_number} mini` : "Mini series name"}
              data-testid="mini-split-name" />
          </div>
          <div className="space-y-2">
            <Label>Scoring</Label>
            <Select value={scoring} onValueChange={setScoring}>
              <SelectTrigger data-testid="mini-split-scoring"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="combined">Combine into one daily result</SelectItem>
                <SelectItem value="additional">Count as extra races in the main series</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {scoring === "combined"
                ? "The races fold into ONE result in the series standings — the table shows a single combined column."
                : "Each race counts as its own race in the main series standings."}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} data-testid="mini-split-confirm" className="bg-ocean hover:bg-ocean-dark">
            Split into {count} races
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Officer() {
  const { role, clubId: authClubId, clubName: authClubName } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isWebmaster = role === "webmaster";
  const clubParam = searchParams.get("club");
  const [clubs, setClubs] = useState([]);

  // Every role loads the club list so the console can link back to the
  // public results page (the auth session only carries the club id/name).
  useEffect(() => {
    api.getClubs().then((cs) => setClubs(cs || [])).catch(() => {});
  }, []);

  const clubId = isWebmaster ? clubParam : authClubId;
  const clubName = isWebmaster
    ? (clubs.find((c) => c.id === clubParam)?.name || null)
    : (authClubName || null);
  const clubSlug = isWebmaster
    ? (clubs.find((c) => c.id === clubParam)?.slug || null)
    : (clubs.find((c) => c.id === authClubId)?.slug || null);

  const [races, setRaces] = useState([]);
  const [classes, setClasses] = useState({});
  const [series, setSeries] = useState({});
  const [selected, setSelected] = useState(null);
  const [rrsCodes, setRrsCodes] = useState([]);
  // Published races list: newest first by default (most recent race at the
  // top), switchable to oldest first.
  const [publishedOrder, setPublishedOrder] = useState("desc");
  // Mini-series batch entry mode
  const [batchMode, setBatchMode] = useState(false);
  const [batchGroup, setBatchGroup] = useState(null);
  const [pendingBatchRace, setPendingBatchRace] = useState(null);
  // Race-day split: the scheduled race the officer wants to expand into a mini series.
  const [splitTarget, setSplitTarget] = useState(null);

  const enterBatch = (g) => { setBatchGroup(g); setBatchMode(true); };

  const loadRaces = useCallback(async () => {
    const params = clubId ? { club_id: clubId } : {};
    const [rs, cs, ss] = await Promise.all([
      api.getRaces(params),
      api.getClasses(params),
      api.getSeries({ year: CURRENT_YEAR, ...params }),
    ]);
    setRaces(rs);
    const cm = {}; cs.forEach((c) => (cm[c.id] = c)); setClasses(cm);
    const sm = {}; ss.forEach((s) => (sm[s.id] = s)); setSeries(sm);
  }, [clubId]);

  const [scheduled, setScheduled] = useState([]);
  const [schedDate, setSchedDate] = useState("");

  const loadScheduled = useCallback(async () => {
    const list = await api.scheduledRaces(clubId ? { club_id: clubId } : {});
    setScheduled(list);
    setSchedDate((prev) => prev || new Date().toISOString().slice(0, 10));
  }, [clubId]);

  useEffect(() => { loadRaces(); loadScheduled(); api.rrsCodes().then(setRrsCodes); }, [loadRaces, loadScheduled]);

  // After batch exit, if the officer wants to open a specific race, wait
  // for races to load then select it.
  useEffect(() => {
    if (pendingBatchRace && races.length > 0) {
      const r = races.find((x) => x.id === pendingBatchRace);
      if (r) { setSelected(pendingBatchRace); setPendingBatchRace(null); }
    }
  }, [pendingBatchRace, races]);

  const startScheduled = async (item) => {
    if (item.race_id) { setSelected(item.race_id); return; }
    const race = await api.createRace({
      date: item.date, class_id: item.class_id, series_id: item.series_id,
      race_number: item.race_number, start_time: item.start_time,
      start_tz_offset_minutes: -new Date().getTimezoneOffset(),
    });
    await loadRaces(); await loadScheduled();
    setSelected(race.id);
  };

  const meta = (r) => ({
    class_id: r.class_id,
    series_id: r.series_id,
    class_name: classes[r.class_id]?.name || "Class",
    series_name: series[r.series_id]?.name || "Series",
  });

  // Note shown on a race (or scheduled race) that belongs to a mini series,
  // so the officer knows the race is part of a mini series and how it scores.
  const MiniNote = ({ item }) => {
    const mini = miniGroupForRace(series[item.series_id], item.race_number);
    const note = miniSeriesNote(mini);
    if (!note) return null;
    return (
      <div className="text-xs mt-1 flex items-center gap-1.5 text-ocean"
        data-testid={`mini-note-${item.id || `${item.series_id}-${item.race_number}`}`}>
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span>{note}</span>
      </div>
    );
  };

  const selectedRace = races.find((r) => r.id === selected);
  const switchClub = isWebmaster ? () => setSearchParams({}) : null;

  if (isWebmaster && !clubParam) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar />
        <ClubPicker
          title="Race Officer console"
          subtitle="Pick the club you're officiating for today."
          onPick={(c) => setSearchParams({ club: c.id })}
        />
      </div>
    );
  }

  if (selected && !batchMode) {
    const dayRaces = selectedRace ? races.filter((r) => r.id !== selectedRace.id && r.date === selectedRace.date) : [];
    return (
      <div className="min-h-screen bg-background">
        <TopBar clubName={clubName} onSwitchClub={switchClub} clubSlug={clubSlug} />
        <RaceConsole raceId={selected} meta={meta(selectedRace || {})}
          series={selectedRace ? series[selectedRace.series_id] : null} clubId={clubId}
          rrsCodes={rrsCodes} dayRaces={dayRaces}
          onEnterBatch={enterBatch}
          onBack={() => { setSelected(null); loadRaces(); }} />
      </div>
    );
  }

  const dayItems = scheduled.filter((s) => s.date === schedDate);
  const dayCreated = dayItems.filter((i) => i.race_id);
  const dayUnpublished = dayCreated.filter((i) => i.status !== "published");

  const active = races.filter((r) => r.status !== "published");
  const done = races.filter((r) => r.status === "published");
  const sortedDone = [...done].sort((a, b) => {
    const ka = `${a.date || ""}|${String(a.race_number || 0).padStart(4, "0")}`;
    const kb = `${b.date || ""}|${String(b.race_number || 0).padStart(4, "0")}`;
    return publishedOrder === "desc" ? (ka < kb ? 1 : ka > kb ? -1 : 0) : (ka < kb ? -1 : ka > kb ? 1 : 0);
  });

  const RaceRow = ({ r }) => {
    // A mini-series race opens the batch scoring page for its whole group
    // (all of R1A/R1B/R1C on one screen) — the single-race console is one
    // tap further away via the card's "Open full race console" button.
    const sr = series[r.series_id];
    const mini = miniGroupForRace(sr, r.race_number);
    return (
    <button data-testid={`race-item-${r.id}`} onClick={() => {
      if (mini) {
        const idx = (sr.mini_series_groups || []).indexOf(mini);
        enterBatch({ group: mini, groupIndex: idx, seriesId: sr.id, series: sr, className: classes[sr.class_id]?.name || "Class" });
      } else {
        setSelected(r.id);
      }
    }}
      className="w-full text-left rounded-xl border border-border bg-card p-4 flex items-center gap-3 hover:border-ocean transition-colors active:scale-[0.99]">
      <div className="w-11 h-11 rounded-lg bg-ocean/10 grid place-items-center text-ocean font-heading text-lg">{raceLabel(r, sr)}</div>
      <div className="flex-1">
        <div className="font-semibold leading-none">{classes[r.class_id]?.name} · {series[r.series_id]?.name}</div>
        <div className="text-xs text-muted-foreground mt-1">{fmtDate(r.date)} · Start {r.start_time}</div>
        <MiniNote item={r} />
      </div>
      <Badge className={STATUS_BADGE[r.status]}>{r.status}</Badge>
      {r.abandoned && <Badge className="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">Abandoned</Badge>}
    </button>
    );
  };

  // ── Mini-series batch entry ───────────────────────────────────────
  // Collect all mini-series groups from in-progress races so the officer
  // can open a multi-race batch entry view.
  const batchGroups = [];
  const seenBatchKeys = new Set();
  active.forEach((r) => {
    const sr = series[r.series_id];
    if (sr && sr.mini_series && Array.isArray(sr.mini_series_groups)) {
      sr.mini_series_groups.forEach((g, idx) => {
        const key = `${sr.id}:${idx}`;
        if (!seenBatchKeys.has(key)) {
          seenBatchKeys.add(key);
          batchGroups.push({ group: g, groupIndex: idx, seriesId: sr.id, series: sr, className: classes[sr.class_id]?.name || "Class" });
        }
      });
    }
  });

  const exitBatch = (raceId) => { setBatchMode(false); setBatchGroup(null); if (raceId) setPendingBatchRace(raceId); loadRaces(); loadScheduled(); };
  // After a successful race-day split, reload and drop straight into the batch
  // scoring page for the newly-created mini series.
  const handleSplitDone = (res) => {
    const sr = res.series;
    enterBatch({
      group: res.group,
      groupIndex: res.group_index,
      seriesId: sr.id,
      series: sr,
      className: classes[sr.class_id]?.name || "Class",
    });
    loadRaces(); loadScheduled();
  };

  if (batchMode && batchGroup) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar clubName={clubName} onSwitchClub={switchClub} clubSlug={clubSlug} />
        <MiniSeriesBatchEntry
          group={batchGroup.group}
          groupIndex={batchGroup.groupIndex}
          seriesId={batchGroup.seriesId}
          clubId={clubId}
          classes={classes}
          seriesMap={series}
          onClose={exitBatch}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar clubName={clubName} onSwitchClub={switchClub} clubSlug={clubSlug} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl uppercase tracking-tighter">Race day</h1>
            <p className="text-muted-foreground text-sm">Set up races, record finishes and publish.</p>
          </div>
          <NewRaceDialog onCreated={(r) => { loadRaces(); setSelected(r.id); }} clubId={clubId} />
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
                  <div key={`${item.series_id}-${item.race_number}`} data-testid={`scheduled-${item.class_name}-${item.race_number}`}
                    className="w-full rounded-lg border border-border bg-card flex items-stretch hover:border-ocean transition-colors">
                    <button onClick={() => {
                      const sri = series[item.series_id];
                      const mini = miniGroupForRace(sri, item.race_number);
                      // Created mini-series races open the whole group's batch
                      // scoring page; plain races open their single-race console.
                      if (mini && item.race_id) {
                        const idx = (sri.mini_series_groups || []).indexOf(mini);
                        enterBatch({ group: mini, groupIndex: idx, seriesId: sri.id, series: sri, className: item.class_name || classes[sri.class_id]?.name || "Class" });
                      } else {
                        startScheduled(item);
                      }
                    }}
                      className="flex-1 text-left p-3 flex items-center gap-3 active:scale-[0.99]">
                      <div className="w-10 h-10 rounded-lg bg-safety/15 grid place-items-center text-safety font-heading">{raceLabel(item, series[item.series_id])}</div>
                      <div className="flex-1">
                        <div className="font-semibold leading-none">{item.class_name} · {item.series_name}</div>
                        <div className="text-xs text-muted-foreground mt-1">Start {item.start_time}</div>
                        <MiniNote item={item} />
                      </div>
                      <Badge className={item.status === "scheduled" ? "bg-ocean/10 text-ocean" : STATUS_BADGE[item.status]}>
                        {item.status === "scheduled" ? "Score now" : item.status}
                      </Badge>
                    </button>
                    <Button variant="ghost" size="sm" className="self-center shrink-0 mr-1 gap-1 text-ocean border-ocean/30 hover:bg-ocean hover:text-white"
                      data-testid={`split-${item.class_name}-${item.race_number}`}
                      title="Split this race into a mini series (run it as several races today)"
                      onClick={() => setSplitTarget(item)}>
                      <Layers className="w-3.5 h-3.5" /> Split
                    </Button>
                  </div>
                ))}
              </div>
            );
          })()}
          {dayCreated.length > 0 && dayUnpublished.length > 0 && (
            <div className="mt-3 pt-3 border-t border-ocean/15 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{dayUnpublished.length} race{dayUnpublished.length > 1 ? "s" : ""} today not yet confirmed</span>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" data-testid="confirm-day-btn"
                onClick={async () => {
                  if (!window.confirm(`Publish all ${dayUnpublished.length} results for ${fmtDate(schedDate)}? Race-day notices for these races will clear from the landing page.`)) return;
                  for (const item of dayUnpublished) await api.setStatus(item.race_id, "published", item.version);
                  toast.success("All results for the day confirmed & published");
                  loadRaces(); loadScheduled();
                }}>
                <CheckCircle2 className="w-4 h-4" /> Confirm full day results
              </Button>
            </div>
          )}
        </section>

        <h2 className="text-lg md:text-lg uppercase tracking-tight mb-3">In progress</h2>
        <div className="space-y-3">
          {active.length ? active.map((r) => <RaceRow key={r.id} r={r} />) : <p className="text-muted-foreground text-sm">No active races. Create one to get started.</p>}
        </div>

        {done.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-2 mb-3 mt-8">
              <h2 className="text-lg md:text-lg uppercase tracking-tight">Published</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground hidden sm:inline">Order</span>
                <Select value={publishedOrder} onValueChange={setPublishedOrder}>
                  <SelectTrigger className="h-8 w-40" data-testid="published-order"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Newest first</SelectItem>
                    <SelectItem value="asc">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-3">{sortedDone.map((r) => <RaceRow key={r.id} r={r} />)}</div>
          </>
        )}
      </main>
      <SplitMiniDialog target={splitTarget} onClose={() => setSplitTarget(null)} onSplit={handleSplitDone} />
    </div>
  );
}
