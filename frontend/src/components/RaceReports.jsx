import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeleteWithUndo } from "@/hooks/use-delete-with-undo";
import { toast } from "sonner";
import { ArrowUpRight, FileText, Trash2, Upload } from "lucide-react";

function openReportDocument(dataUrl) {
  if (!dataUrl) return false;
  try {
    const [header, encoded] = dataUrl.split(",", 2);
    const mime = (header.match(/data:([^;]+)/) || [])[1] || "application/pdf";
    const binary = atob(encoded || "");
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const opened = window.open(url, "_blank");
    if (!opened) window.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 120000);
    return true;
  } catch {
    const opened = window.open(dataUrl, "_blank");
    if (!opened) window.location.href = dataUrl;
    return true;
  }
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function ReportLink({ report, admin = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const view = async () => {
    setBusy(true);
    setError("");
    try {
      const full = await api.getRaceReport(report.id);
      if (!full?.file_data_url) throw new Error("The report document is unavailable.");
      openReportDocument(full.file_data_url);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Could not load the report.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 border-ocean text-ocean hover:bg-ocean hover:text-white"
        onClick={view} disabled={busy} data-testid={`view-race-report-${report.id}`}>
        <FileText className="h-3.5 w-3.5" /> {busy ? "Loading…" : report.title || report.original_filename || "View report"}
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Button>
      {report.original_filename && <span className="text-xs text-muted-foreground">{report.original_filename}</span>}
      {error && <span className="w-full text-xs text-red-600">{error}</span>}
      {admin && report.file_size != null && <span className="text-xs text-muted-foreground">{(report.file_size / 1024).toFixed(0)} KB</span>}
    </div>
  );
}

export function ClassRaceReports({ series = [], classIds = [] }) {
  const [reports, setReports] = useState(null);
  const classIdKey = classIds.filter(Boolean).join("|");
  const seriesKey = series.map((item) => item.id).join("|");
  const requestedClassesRef = useRef(classIdKey);
  const stableClassIds = useMemo(() => [...new Set(classIdKey.split("|").filter(Boolean))], [classIdKey]);
  const seriesIds = useMemo(() => new Set(seriesKey.split("|").filter(Boolean)), [seriesKey]);

  useEffect(() => {
    let current = true;
    requestedClassesRef.current = classIdKey;
    setReports(null);
    if (!stableClassIds.length) {
      setReports([]);
      return () => { current = false; };
    }
    Promise.all(stableClassIds.map((id) => api.getClassRaceReports(id).catch(() => [])))
      .then((lists) => {
        if (current && requestedClassesRef.current === classIdKey) setReports(lists.flat());
      });
    return () => { current = false; };
  }, [classIdKey, stableClassIds]);

  const reportsBySeries = useMemo(() => {
    const grouped = new Map();
    (reports || []).filter((report) => seriesIds.has(report.series_id)).forEach((report) => {
      const items = grouped.get(report.series_id) || [];
      items.push(report);
      grouped.set(report.series_id, items);
    });
    return grouped;
  }, [reports, seriesIds]);

  const orderedSeries = [...series].sort((a, b) => Number(b.year || 0) - Number(a.year || 0)
    || (a.club_name || "").localeCompare(b.club_name || "")
    || (a.name || "").localeCompare(b.name || ""));

  return (
    <section className="mt-12" id="race-reports" data-testid="class-race-reports">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-safety">Class archive</p>
          <h2 className="font-heading text-3xl uppercase tracking-tight text-ocean">Race Reports</h2>
          <p className="mt-1 text-sm text-muted-foreground">Reports uploaded for every series in this class.</p>
        </div>
        {reports !== null && <Badge variant="outline">{reports.length} {reports.length === 1 ? "report" : "reports"}</Badge>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card" data-testid="race-reports-table-wrap">

        <Table>
          <TableHeader><TableRow className="bg-muted"><TableHead>Season</TableHead><TableHead>Club</TableHead><TableHead>Series</TableHead><TableHead>Race reports</TableHead></TableRow></TableHeader>
          <TableBody>
            {orderedSeries.map((item) => {
              const itemReports = reportsBySeries.get(item.id) || [];
              return (
                <TableRow key={`${item.id}-${item.class_id}`} data-testid={`race-report-series-${item.id}`}>
                  <TableCell className="font-mono">{item.year || "—"}</TableCell>
                  <TableCell>{item.club_name || "—"}</TableCell>
                  <TableCell className="font-semibold">{item.name}</TableCell>
                  <TableCell>
                    {reports === null ? <span className="text-sm text-muted-foreground">Loading reports…</span>
                      : itemReports.length ? <div className="space-y-2">{itemReports.map((report) => <ReportLink key={report.id} report={report} />)}</div>
                        : <span className="text-sm text-muted-foreground">No reports uploaded</span>}
                  </TableCell>
                </TableRow>
              );
            })}
            {!orderedSeries.length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No series have been set up for this class yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function RaceReportsAdmin({ clubId, classes = [] }) {
  const [series, setSeries] = useState([]);
  const [reports, setReports] = useState(null);
  const [classFilter, setClassFilter] = useState("all");
  const [seriesId, setSeriesId] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const { askDelete, isPending, dialog } = useDeleteWithUndo();

  const loadReports = useCallback(() => {
    if (!clubId || !api.getAdminRaceReports) return;
    setReports(null);
    api.getAdminRaceReports({ club_id: clubId, ...(classFilter !== "all" ? { class_id: classFilter } : {}) })
      .then(setReports).catch(() => setReports([]));
  }, [clubId, classFilter]);

  useEffect(() => {
    if (!clubId) return;
    setSeries([]);
    setReports(null);
    api.getSeries({ club_id: clubId }).then((items) => setSeries(items || [])).catch(() => setSeries([]));
  }, [clubId]);
  useEffect(() => { setSeriesId(""); }, [classFilter, clubId]);
  useEffect(() => { loadReports(); }, [loadReports]);

  const availableSeries = series.filter((item) => classFilter === "all" || item.class_id === classFilter)
    .slice().sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || a.name.localeCompare(b.name));

  const pickFile = (event) => {
    const next = event.target.files?.[0] || null;
    setFile(next);
    if (next && !title.trim()) setTitle(next.name.replace(/\.[^.]+$/, ""));
  };

  const upload = async (event) => {
    event.preventDefault();
    if (!seriesId || !file || !title.trim()) return toast.error("Choose a series, report title and file");
    if (file.size > 10 * 1024 * 1024) return toast.error("Race reports must be 10 MB or smaller");
    setBusy(true);
    try {
      await api.uploadRaceReport({ series_id: seriesId, title: title.trim() }, file);
      toast.success("Race report uploaded and published");
      setFile(null);
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      loadReports();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not upload race report");
    } finally {
      setBusy(false);
    }
  };

  const remove = (report) => askDelete({
    key: report.id,
    title: `Remove “${report.title}” from Race Reports?`,
    description: "The report will no longer appear on the public class page.",
    confirmLabel: "Remove report",
    successMessage: "Race report removed",
    undoneMessage: "Race report kept",
    errorMessage: "Could not remove race report",
    commit: async () => { await api.deleteRaceReport(report.id); loadReports(); },
    undo: loadReports,
  });

  return (
    <section className="space-y-5" data-testid="race-reports-management">
      {dialog}
      <div>
        <h2 className="text-2xl uppercase tracking-tighter">Race Reports</h2>
        <p className="text-sm text-muted-foreground">Upload and manage reports attached to a class series. PDF and common image formats are supported (10 MB max).</p>
      </div>
      <form className="rounded-xl border border-border bg-card p-4 sm:p-5" onSubmit={upload} data-testid="race-report-upload-form">
        <h3 className="mb-3 font-heading uppercase tracking-tight">Upload a report</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="report-class">Class filter</Label>
            <select id="report-class" value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="race-report-class-select">
              <option value="all">All classes</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="report-series">Series</Label>
            <select id="report-series" value={seriesId} onChange={(event) => setSeriesId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="race-report-series-select">
              <option value="">Choose a series</option>{availableSeries.map((item) => <option key={item.id} value={item.id}>{item.year} · {item.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="report-title">Report title</Label>
            <Input id="report-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Summer Series report" data-testid="race-report-title" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={pickFile} data-testid="race-report-file" />
          <Button type="button" variant="outline" className="gap-2" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="race-report-choose-file"><Upload className="h-4 w-4" />{file ? "Change file" : "Choose file"}</Button>
          {file && <span className="max-w-full truncate text-sm text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB</span>}
          <Button type="submit" className="gap-2 bg-ocean hover:bg-ocean-dark" disabled={busy || !seriesId || !file || !title.trim()} data-testid="race-report-upload-submit"><Upload className="h-4 w-4" />{busy ? "Uploading…" : "Upload report"}</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Reports are visible on the class Race Reports page as soon as they upload successfully.</p>
      </form>
      <div>
        <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-heading text-lg uppercase tracking-tight">Uploaded reports</h3><Badge variant="outline">{reports?.filter((item) => !isPending(item.id)).length || 0}</Badge></div>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader><TableRow className="bg-muted"><TableHead>Season</TableHead><TableHead>Class / series</TableHead><TableHead>Report</TableHead><TableHead>Uploaded</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {reports?.filter((item) => !isPending(item.id)).map((report) => (
                <TableRow key={report.id} data-testid={`admin-race-report-${report.id}`}>
                  <TableCell className="font-mono">{report.year || "—"}</TableCell>
                  <TableCell><div className="font-semibold">{report.class_name}</div><div className="text-xs text-muted-foreground">{report.series_name}</div></TableCell>
                  <TableCell><ReportLink report={report} admin /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(report.uploaded_at)}</TableCell>
                  <TableCell className="text-right"><Button type="button" size="sm" variant="ghost" className="gap-1.5 text-destructive" onClick={() => remove(report)} data-testid={`remove-race-report-${report.id}`}><Trash2 className="h-4 w-4" /> Remove</Button></TableCell>
                </TableRow>
              ))}
              {reports === null
                ? <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading reports…</TableCell></TableRow>
                : !reports.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No reports have been uploaded yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
