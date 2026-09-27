import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeleteWithUndo } from "@/hooks/use-delete-with-undo";
import { toast } from "sonner";
import { ArrowUpRight, FileText, Globe, Link2, Trash2, Upload } from "lucide-react";

// A report is either a stored document — fetched on click as a data URL and
// opened in a new tab — or a pointer to a page that already lives on another
// website, which is linked out to directly.
function reportIsLink(report) {
  return Boolean(report?.link_url);
}

function reportHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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
  if (reportIsLink(report)) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 border-ocean text-ocean hover:bg-ocean hover:text-white">
          <a href={report.link_url} target="_blank" rel="noopener noreferrer"
            data-testid={`view-race-report-${report.id}`}>
            <Globe className="h-3.5 w-3.5" /> {report.title || "View report"}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </Button>
        <span className="text-xs text-muted-foreground">{reportHost(report.link_url)}</span>
        {admin && <span className="text-xs text-muted-foreground">External link</span>}
      </div>
    );
  }
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

// A single report as one compact control, for lists where each row is a
// different series and only some of them have a document. Stored documents are
// fetched on click rather than linked, because the bytes are served as a data
// URL from the API and never as a stable public file; website reports are a
// plain outbound link.
export function RaceReportButton({ report, label = "Report" }) {
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
  if (reportIsLink(report)) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <Button asChild size="sm" variant="outline"
          className="h-8 gap-1.5 border-ocean/40 px-2.5 text-ocean hover:bg-ocean hover:text-white">
          <a href={report.link_url} target="_blank" rel="noopener noreferrer"
            data-testid={`report-button-${report.id}`}
            title={`${report.title || "Race report"} — opens ${reportHost(report.link_url)} in a new tab`}>
            <Globe className="h-3.5 w-3.5" /> {label}
          </a>
        </Button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Button type="button" size="sm" variant="outline"
        className="h-8 gap-1.5 border-ocean/40 px-2.5 text-ocean hover:bg-ocean hover:text-white"
        onClick={view} disabled={busy} data-testid={`report-button-${report.id}`}
        title={report.title || report.original_filename || "Open race report"}>
        <FileText className="h-3.5 w-3.5" /> {busy ? "Opening…" : label}
      </Button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </span>
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
          <p className="mt-1 text-sm text-muted-foreground">Uploaded documents and website links for every series in this class.</p>
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
                        : <span className="text-sm text-muted-foreground">No reports published</span>}
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
  const [mode, setMode] = useState("file");
  const [file, setFile] = useState(null);
  const [linkUrl, setLinkUrl] = useState("");
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

  const linkUrlLooksValid = /^https?:\/\//i.test(linkUrl.trim());

  // One form covers both kinds of report: a document we store, or a link to a
  // page the club keeps elsewhere. Everything else about the report (series,
  // title, publishing, removal from the public archive) behaves identically.
  const submit = async (event) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!seriesId || !cleanTitle) return toast.error("Choose a series and a report title");
    if (mode === "file") {
      if (!file) return toast.error("Choose the report file to upload");
      if (file.size > 10 * 1024 * 1024) return toast.error("Race reports must be 10 MB or smaller");
    } else if (!linkUrlLooksValid) {
      return toast.error("Website links must start with http:// or https://");
    }
    setBusy(true);
    try {
      if (mode === "file") {
        await api.uploadRaceReport({ series_id: seriesId, title: cleanTitle }, file);
        toast.success("Race report uploaded and published");
      } else {
        await api.createRaceReportLink({ series_id: seriesId, title: cleanTitle, url: linkUrl.trim() });
        toast.success("Race report link published");
      }
      setFile(null);
      setLinkUrl("");
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      loadReports();
    } catch (error) {
      toast.error(error.response?.data?.detail
        || (mode === "file" ? "Could not upload race report" : "Could not save race report link"));
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
        <p className="text-sm text-muted-foreground">Publish reports against a class series — either an uploaded document (PDF and common image formats, 10 MB max) or a link to a report published somewhere else on the web.</p>
      </div>
      <form className="rounded-xl border border-border bg-card p-4 sm:p-5" onSubmit={submit} data-testid="race-report-upload-form">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-heading uppercase tracking-tight">{mode === "file" ? "Upload a report" : "Link to a report"}</h3>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Report source">
            <Button type="button" size="sm" variant={mode === "file" ? "default" : "outline"}
              className={mode === "file" ? "gap-1.5 bg-ocean hover:bg-ocean-dark" : "gap-1.5"}
              onClick={() => setMode("file")} data-testid="race-report-mode-file"><Upload className="h-4 w-4" /> Upload a file</Button>
            <Button type="button" size="sm" variant={mode === "link" ? "default" : "outline"}
              className={mode === "link" ? "gap-1.5 bg-ocean hover:bg-ocean-dark" : "gap-1.5"}
              onClick={() => setMode("link")} data-testid="race-report-mode-link"><Link2 className="h-4 w-4" /> Link a website</Button>
          </div>
        </div>
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
        {mode === "file" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={pickFile} data-testid="race-report-file" />
            <Button type="button" variant="outline" className="gap-2" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="race-report-choose-file"><Upload className="h-4 w-4" />{file ? "Change file" : "Choose file"}</Button>
            {file && <span className="max-w-full truncate text-sm text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB</span>}
            <Button type="submit" className="gap-2 bg-ocean hover:bg-ocean-dark" disabled={busy || !seriesId || !file || !title.trim()} data-testid="race-report-upload-submit"><Upload className="h-4 w-4" />{busy ? "Uploading…" : "Upload report"}</Button>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <Label htmlFor="report-link-url">Website address</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input id="report-link-url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://club.example.org/results/summer-series-2026.pdf" className="max-w-xl flex-1" data-testid="race-report-link-url" />
              <Button type="submit" className="gap-2 bg-ocean hover:bg-ocean-dark" disabled={busy || !seriesId || !title.trim() || !linkUrlLooksValid} data-testid="race-report-link-submit"><Link2 className="h-4 w-4" />{busy ? "Saving…" : "Publish link"}</Button>
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{mode === "file"
          ? "Reports are visible on the class Race Reports page as soon as they upload successfully."
          : "Visitors open the link in a new tab. Use this for reports kept on your own club website or another host."}</p>
      </form>
      <div>
        <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-heading text-lg uppercase tracking-tight">Published reports</h3><Badge variant="outline">{reports?.filter((item) => !isPending(item.id)).length || 0}</Badge></div>
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
                : !reports.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No reports have been published yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
