import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  Megaphone,
  Radio,
  Save,
  Sliders,
  Tv,
} from "lucide-react";

const DEFAULT_CONFIG = {
  enabled: true,
  active_series_id: "",
  active_regatta_id: "",
  active_year: "",
  show_overall: true,
  show_classes: true,
  show_latest_race: true,
  show_series_progress: true,
  show_race_day_panel: true,
  rotation_seconds: 15,
  include_provisional: true,
  show_race_officer: true,
  show_courses: true,
  show_schedule: true,
  show_notes: true,
  show_announcements: true,
  show_status: true,
};

const DEFAULT_RACE_DAY_INFO = {
  title: "",
  date: "",
  race_officer: "",
  status: "",
  courses: "",
  course_diagram: "",
  start_sequence: "",
  notes: "",
  announcements: "",
};

/**
 * Race-Day Information Editor for Race Officers and Club Admins.
 * Updates the club's persistent race-day panel on the Clubhouse TV Display.
 */
export function RaceDayInfoEditor({ clubId, compact = false }) {
  const [info, setInfo] = useState(DEFAULT_RACE_DAY_INFO);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);

  const load = useCallback(() => {
    if (!clubId) return;
    if (typeof api.getClubs !== "function") return;
    Promise.resolve(api.getClubs())
      .then((clubs) => {
        const club = (clubs || []).find((c) => c.id === clubId);
        if (club?.race_day_info) {
          setInfo({
            ...DEFAULT_RACE_DAY_INFO,
            ...club.race_day_info,
          });
        }
      })
      .catch(() => {});
  }, [clubId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!clubId || typeof api.updateClubRaceDayInfo !== "function") return;
    setBusy(true);
    try {
      const res = await api.updateClubRaceDayInfo(clubId, info);
      if (res?.race_day_info) {
        setInfo({ ...DEFAULT_RACE_DAY_INFO, ...res.race_day_info });
      }
      toast.success("Race-day information updated for the Clubhouse TV display");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update race-day information");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-2xl border border-border bg-card p-5 mb-6"
      data-testid="race-day-info-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-ocean/10 grid place-items-center text-ocean shrink-0">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <div className="font-heading text-lg uppercase tracking-tight">
              Clubhouse TV — Race-Day Information
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Publish today’s race officer, course details, start sequence and announcements to the clubhouse television.
            </p>
          </div>
        </div>
        {compact && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="toggle-race-day-info-btn"
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? "Hide" : "Edit TV Race-Day Info"}
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-border pt-4" data-testid="race-day-info-form">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="rdi-title">Event / Race-day title</Label>
              <Input
                id="rdi-title"
                data-testid="rdi-title"
                placeholder="e.g. Saturday Club Points"
                value={info.title}
                onChange={(e) => setInfo({ ...info, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rdi-date">Race date</Label>
              <Input
                id="rdi-date"
                type="date"
                data-testid="rdi-date"
                value={info.date}
                onChange={(e) => setInfo({ ...info, date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rdi-officer">Race Officer / OOD</Label>
              <Input
                id="rdi-officer"
                data-testid="rdi-officer"
                placeholder="e.g. J. Smith (PRO)"
                value={info.race_officer}
                onChange={(e) => setInfo({ ...info, race_officer: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rdi-status">Race status</Label>
              <select
                id="rdi-status"
                data-testid="rdi-status"
                value={info.status}
                onChange={(e) => setInfo({ ...info, status: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Auto-detect from races</option>
                <option value="scheduled">Scheduled</option>
                <option value="racing">Racing Underway</option>
                <option value="provisional">Provisional Results</option>
                <option value="completed">Completed</option>
                <option value="postponed">Postponed (AP)</option>
                <option value="abandoned">Abandoned (N)</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rdi-courses">Courses &amp; descriptions</Label>
              <Textarea
                id="rdi-courses"
                rows={2}
                data-testid="rdi-courses"
                placeholder="e.g. Windward-Leeward · 3 laps (leave empty to show per-race courses)"
                value={info.courses}
                onChange={(e) => setInfo({ ...info, courses: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rdi-diagram">Mark rounding sequence / diagram</Label>
              <Textarea
                id="rdi-diagram"
                rows={2}
                data-testid="rdi-diagram"
                placeholder="e.g. Start → 1(P) → 1a(P) → 4s/4p → Finish"
                value={info.course_diagram}
                onChange={(e) => setInfo({ ...info, course_diagram: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rdi-sequence">Class start sequence &amp; schedule notes</Label>
              <Textarea
                id="rdi-sequence"
                rows={2}
                data-testid="rdi-sequence"
                placeholder="e.g. 10:25 Warning · 10:30 Dragon · 10:35 Sonata · 10:40 Cruiser"
                value={info.start_sequence}
                onChange={(e) => setInfo({ ...info, start_sequence: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rdi-notes">Start-line / course notes</Label>
              <Textarea
                id="rdi-notes"
                rows={2}
                data-testid="rdi-notes"
                placeholder="e.g. Committee boat on starboard end · VHF Ch 37"
                value={info.notes}
                onChange={(e) => setInfo({ ...info, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rdi-announcements">Clubhouse announcements</Label>
            <Textarea
              id="rdi-announcements"
              rows={2}
              data-testid="rdi-announcements"
              placeholder="e.g. Prizegiving in the main bar at 17:00 · Protest time limit 16:15"
              value={info.announcements}
              onChange={(e) => setInfo({ ...info, announcements: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              onClick={save}
              disabled={busy}
              data-testid="save-race-day-info-btn"
              className="gap-2 bg-ocean hover:bg-ocean-dark"
            >
              <Save className="w-4 h-4" />
              {busy ? "Saving…" : "Save Race-Day Info"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Full Clubhouse TV Display Configuration Card for Club Administrators.
 */
export default function TvDisplaySettingsCard({ clubId, clubSlug }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [seriesList, setSeriesList] = useState([]);
  const [classesById, setClassesById] = useState({});
  const [regattasList, setRegattasList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    if (!clubId) return;
    if (typeof api.getClubs === "function") {
      Promise.resolve(api.getClubs())
        .then((clubs) => {
          const c = (clubs || []).find((x) => x.id === clubId);
          if (c?.tv_config) {
            setConfig({
              ...DEFAULT_CONFIG,
              ...c.tv_config,
              active_series_id: c.tv_config.active_series_id || "",
              active_regatta_id: c.tv_config.active_regatta_id || "",
              active_year: c.tv_config.active_year || "",
            });
          }
        })
        .catch(() => {});
    }
    if (typeof api.getClasses === "function") {
      Promise.resolve(api.getClasses({ club_id: clubId }))
        .then((cls) => {
          const map = {};
          (cls || []).forEach((item) => {
            map[item.id] = item;
          });
          setClassesById(map);
        })
        .catch(() => {});
    }
    if (typeof api.getSeries === "function") {
      Promise.resolve(api.getSeries({ club_id: clubId }))
        .then((ss) => setSeriesList(ss || []))
        .catch(() => {});
    }
    if (typeof api.getRegattas === "function") {
      Promise.resolve(api.getRegattas({ club_id: clubId }))
        .then((rs) => setRegattasList(rs || []))
        .catch(() => {});
    }
  }, [clubId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveConfig = async (nextConfig = config) => {
    if (!clubId || typeof api.updateClubTvConfig !== "function") return;
    setBusy(true);
    try {
      const payload = {
        ...nextConfig,
        active_series_id: nextConfig.active_series_id || null,
        active_regatta_id: nextConfig.active_regatta_id || null,
        active_year: nextConfig.active_year ? Number(nextConfig.active_year) : null,
        rotation_seconds: Math.max(5, Math.min(120, Number(nextConfig.rotation_seconds) || 15)),
      };
      const res = await api.updateClubTvConfig(clubId, payload);
      if (res?.tv_config) {
        setConfig({
          ...DEFAULT_CONFIG,
          ...res.tv_config,
          active_series_id: res.tv_config.active_series_id || "",
          active_regatta_id: res.tv_config.active_regatta_id || "",
          active_year: res.tv_config.active_year || "",
        });
      }
      toast.success("Clubhouse TV display settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save TV display settings");
    } finally {
      setBusy(false);
    }
  };

  const displayIdentifier = clubSlug || clubId;
  const publicPath = displayIdentifier ? `/clubs/${displayIdentifier}/display` : "";
  const previewPath = publicPath ? `${publicPath}?preview=1` : "";
  const fullPublicUrl =
    typeof window !== "undefined" && publicPath
      ? `${window.location.origin}${publicPath}`
      : publicPath;

  const copyUrl = () => {
    if (!fullPublicUrl) return;
    navigator.clipboard?.writeText(fullPublicUrl).then(() => {
      setCopied(true);
      toast.success("TV display URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl border border-border bg-card p-5"
        data-testid="tv-display-settings-card"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-ocean/10 grid place-items-center text-ocean shrink-0">
              <Tv className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-heading text-lg uppercase tracking-tight">
                  Clubhouse TV Results Display
                </h3>
                <Badge variant={config.enabled ? "default" : "secondary"} className={config.enabled ? "bg-emerald-600 text-white" : ""}>
                  {config.enabled ? "Public Active" : "Disabled"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Full-screen 16:9 automatic results display for your clubhouse television.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {previewPath && (
              <a
                href={previewPath}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="tv-display-preview-link"
                className="inline-flex items-center gap-1.5 rounded-lg border border-ocean px-3 py-1.5 text-xs font-semibold text-ocean hover:bg-ocean hover:text-white transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Preview TV Display
              </a>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {config.enabled ? "Enabled" : "Disabled"}
              </span>
              <Switch
                checked={config.enabled}
                disabled={busy}
                data-testid="tv-display-enabled-switch"
                onCheckedChange={(checked) => {
                  const next = { ...config, enabled: checked };
                  setConfig(next);
                  saveConfig(next);
                }}
              />
            </div>
          </div>
        </div>

        {/* Shareable Public URL Bar */}
        {publicPath && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
                Shareable Smart-TV URL
              </span>
              <code
                data-testid="tv-display-share-url"
                className="font-mono text-xs text-foreground break-all"
              >
                {fullPublicUrl}
              </code>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyUrl}
              data-testid="tv-display-copy-url"
              className="gap-1.5 h-8"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy URL"}
            </Button>
          </div>
        )}

        {/* Active Series / Event & Rotation Duration */}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="tv-active-series">Active Series</Label>
            <select
              id="tv-active-series"
              data-testid="tv-active-series-select"
              value={config.active_series_id}
              onChange={(e) =>
                setConfig({
                  ...config,
                  active_series_id: e.target.value,
                  active_regatta_id: e.target.value ? "" : config.active_regatta_id,
                })
              }
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="">All active series (current season)</option>
              {seriesList.map((s) => {
                const clsName = classesById[s.class_id]?.name || "Class";
                return (
                  <option key={s.id} value={s.id}>
                    {clsName} · {s.name} ({s.year})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tv-active-regatta">Or Active Regatta / Event</Label>
            <select
              id="tv-active-regatta"
              data-testid="tv-active-regatta-select"
              value={config.active_regatta_id}
              onChange={(e) =>
                setConfig({
                  ...config,
                  active_regatta_id: e.target.value,
                  active_series_id: e.target.value ? "" : config.active_series_id,
                })
              }
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="">None (use series selection)</option>
              {regattasList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.year})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tv-rotation-seconds">Rotation duration (seconds per view)</Label>
            <Input
              id="tv-rotation-seconds"
              type="number"
              min={5}
              max={120}
              data-testid="tv-rotation-seconds-input"
              value={config.rotation_seconds}
              onChange={(e) =>
                setConfig({ ...config, rotation_seconds: e.target.value })
              }
            />
          </div>
        </div>

        {/* Rotating Views Checkboxes */}
        <div className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5" /> Rotating Views &amp; Panels
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { key: "show_overall", label: "View A: Overall Standings", testId: "tv-toggle-overall" },
              { key: "show_classes", label: "View B: Individual Classes", testId: "tv-toggle-classes" },
              { key: "show_latest_race", label: "View C: Latest Race Results", testId: "tv-toggle-latest-race" },
              { key: "show_series_progress", label: "View D: Series Progress", testId: "tv-toggle-series-progress" },
              { key: "include_provisional", label: "Include Provisional Race Results", testId: "tv-toggle-provisional" },
              { key: "show_race_day_panel", label: "Persistent Race-Day Side Panel", testId: "tv-toggle-race-day-panel" },
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-sm cursor-pointer"
              >
                <span className="font-medium">{item.label}</span>
                <Switch
                  checked={Boolean(config[item.key])}
                  data-testid={item.testId}
                  onCheckedChange={(v) => setConfig({ ...config, [item.key]: v })}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Race-day field toggles */}
        {config.show_race_day_panel && (
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Race-Day Panel Sections Displayed
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { key: "show_status", label: "Race Status" },
                { key: "show_race_officer", label: "Race Officer" },
                { key: "show_courses", label: "Courses & Marks" },
                { key: "show_schedule", label: "Start Times" },
                { key: "show_notes", label: "Course Notes" },
                { key: "show_announcements", label: "Announcements" },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-xs cursor-pointer"
                >
                  <span>{item.label}</span>
                  <Switch
                    checked={Boolean(config[item.key])}
                    data-testid={`tv-field-${item.key}`}
                    onCheckedChange={(v) => setConfig({ ...config, [item.key]: v })}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            onClick={() => saveConfig(config)}
            disabled={busy}
            data-testid="save-tv-config-btn"
            className="gap-2 bg-ocean hover:bg-ocean-dark"
          >
            <Save className="w-4 h-4" />
            {busy ? "Saving…" : "Save TV Configuration"}
          </Button>
        </div>
      </div>

      {/* Race-Day Information Editor */}
      <RaceDayInfoEditor clubId={clubId} />
    </div>
  );
}
