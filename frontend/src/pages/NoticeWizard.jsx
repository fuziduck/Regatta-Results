// The Official Notice Board creation wizard (specs 34–46, 50): a six-step
// flow — type, creation method, details, attachments, preview, publish —
// simple enough for a Race Officer on a phone straight after a race briefing.
//
// Both publication methods (Sailscore-generated structured fields, or an
// uploaded existing document) converge on the SAME notice record (spec 39);
// nothing is made public until the explicit "Publish Notice" action on the
// preview step (spec 44). Existing Sailscore data (club, event/series, race,
// class, dates, officer name) is pre-filled from ?race= / ?series= context
// (spec 46) and kept editable where appropriate.
//
// The dynamic field set, its greyed-out placeholder guidance, and the ONB
// heading all come from the backend's /notices/meta catalogue — the frontend
// never hardcodes the fields (spec 34/35), so type switches re-render the
// form immediately (spec 36).

import { useEffect, useMemo, useReducer, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NoticeBodyView, NoticeFacts, noticeHeadingLine, noticeContextLine } from "@/components/NoticeBody";
import { noticePdfDataUrl, noticePdfBlobUrl } from "@/lib/noticePdf";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronLeft, ChevronRight, FileText, Plus, Trash2, Loader2, UploadCloud, Download, ExternalLink, Send } from "lucide-react";

const STEPS = ["Notice Type", "Create Method", "Notice Details", "Attachments", "Preview", "Publish"];

const inputKind = (kind) => ({ text: "text", textarea: "textarea", date: "date", time: "time" }[kind] || "text");

// Seed a generated notice's fields from Sailscore context where the ids match
// the type's own series/race/class field keys (spec 46). Values stay editable.
function seedFields(typeDef, ctx, noticeNumber) {
  const fields = {};
  if (typeDef && typeDef.fields) {
    for (const f of typeDef.fields) {
      if (f.key === "series_id" && ctx?.series_id) fields.series_id = ctx.series_id;
      if (f.key === "race_id" && ctx?.race_id) fields.race_id = ctx.race_id;
      if (f.key === "class_id" && ctx?.class_id) fields.class_id = ctx.class_id;
      if (f.key === "date" && ctx?.race_date) fields.date = ctx.race_date;
      if (f.key === "time" && ctx?.start_time) fields.time = ctx.start_time;
    }
  }
  return fields;
}

// Turn the backend's denormalised context (race/series/class ids + names) into
// a friendly summary of what is auto-populated.
function contextSummary(ctx) {
  const parts = [];
  if (ctx?.club_name) parts.push(ctx.club_name);
  if (ctx?.series_name) parts.push(ctx.series_name);
  if (ctx?.race_number) parts.push(`Race ${ctx.race_number}`);
  if (ctx?.class_name) parts.push(ctx.class_name);
  if (ctx?.race_date) parts.push(ctx.race_date);
  return parts.join(" · ");
}

export default function NoticeWizard({ onDone }) {
  const { role, clubId, clubName } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Step state
  const [step, setStep] = useState(0);
  const [typeKey, setTypeKey] = useState(null);
  const [method, setMethod] = useState("generated"); // 'generated' | 'uploaded'
  const [publicationArea, setPublicationArea] = useState("Club Notices");
  const [publicationAreas, setPublicationAreas] = useState([{ key: "Club Notices", title: "Club Notices" }, { key: "Open Event Notices", title: "Open Event Notices" }]);
  const [newAreaName, setNewAreaName] = useState("");
  const [addingArea, setAddingArea] = useState(false);
  const [fields, setFields] = useState({});
  const [uploadFile, setUploadFile] = useState(null);
  const [noticeNumber, setNoticeNumber] = useState(1);
  const [effectiveDatetime, setEffectiveDatetime] = useState("");
  const [publicationDatetime, setPublicationDatetime] = useState("");
  const [attachments, setAttachments] = useState([]); // [{file, name}]
  const [noticeId, setNoticeId] = useState(null);
  const [draftVersion, setDraftVersion] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const [meta, setMeta] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [races, setRaces] = useState([]);
  const [series, setSeries] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [selectedClubId, setSelectedClubId] = useState(clubId || "");
  useEffect(() => { if (clubId && !selectedClubId) setSelectedClubId(clubId); }, [clubId, selectedClubId]);
  const [classes, setClasses] = useState([]);
  const [linkOptionsLoading, setLinkOptionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  const raceParam = searchParams.get("race");
  const seriesParam = searchParams.get("series");

  const typeDef = useMemo(() => (meta?.types || []).find((t) => t.key === typeKey) || null, [meta, typeKey]);

  // Load catalogue + optional Sailscore context on mount.
  useEffect(() => {
    if (role === "webmaster") api.getClubs().then((cs) => setClubs(cs || [])).catch(() => {});
  }, [role]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const m = await api.noticeMeta();
        if (!active) return;
        setMeta(m);
        // Pre-pick a type if deep-linked (?type=).
        const wanted = searchParams.get("type");
        if (wanted && m.types.some((t) => t.key === wanted)) setTypeKey(wanted);
        else if (m.types[0]) setTypeKey(m.types[0].key);
      } catch {
        toast.error("Could not load the notice types.");
      }
      setLoading(false);
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill from race/series context (spec 46) + current notice number.
  useEffect(() => {
    const effectiveClubId = role === "webmaster" ? selectedClubId : clubId;
    if (!effectiveClubId || !typeKey) return;
    if (raceParam || seriesParam) {
      api.noticeContext(raceParam ? { race_id: raceParam } : { series_id: seriesParam })
        .then((c) => { setCtx(c); if (c.class_id) setClasses([{ id: c.class_id, name: c.class_name }]); })
        .catch(() => {});
    }
    api.nextNoticeNumber(typeKey, effectiveClubId).then((r) => setNoticeNumber(r.next)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, role, selectedClubId, typeKey]);

  // Load link options once per type.
  useEffect(() => {
    const effectiveClubId = role === "webmaster" ? selectedClubId : clubId;
    if (!effectiveClubId || !typeKey) return;
    api.getNoticeAreas(effectiveClubId).then((areas) => setPublicationAreas((areas || []).map((a) => ({ key: a.title, title: a.title })))).catch(() => {});
    setLinkOptionsLoading(true);
    Promise.all([
      api.getClasses({ club_id: effectiveClubId }),
      api.getSeries({ club_id: effectiveClubId }),
      api.getRaces({ club_id: effectiveClubId }),
    ]).then(([cs, ss, rs]) => {
      setClasses((prev) => prev.length ? prev : cs || []);
      setSeries((prev) => prev.length ? prev : ss || []);
      setRaces((prev) => prev.length ? prev : rs || []);
    }).catch(() => {}).finally(() => setLinkOptionsLoading(false));
  }, [clubId, role, selectedClubId, typeKey]);

  // Re-seed the structured fields whenever the type changes (spec 36).
  useEffect(() => {
    if (typeDef) {
      const seeded = seedFields(typeDef, ctx, noticeNumber);
      setFields(seeded);
    }
  }, [typeKey, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const goNext = async () => {
    // Create the server-side draft when leaving the details step. This keeps
    // the preview and final publish actions tied to a real notice record.
    if (step === 2 && !noticeId) {
      try {
        const draft = method === "uploaded" ? await createUploaded() : await createGenerated();
        if (!draft) return;
      } catch (e) {
        toast.error(e?.response?.data?.detail || e?.message || "Could not create the notice draft.");
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  // ---- Step 1: type selection -------------------------------------------------
  const typeCards = (meta?.types || []).map((t) => ({
    ...t,
    fields: t.fields || [],
  }));

  // ---- Step 3: dynamic field renderer (spec 34/35) ---------------------------
  const renderField = (f) => {
    const kind = f.kind;
    const val = fields[f.key] || "";
    const set = (v) => setFields((prev) => ({ ...prev, [f.key]: v }));
    const place = f.placeholder;

    if (kind === "textarea") {
      return (
        <Textarea key={f.key} role="textbox" data-testid={`field-${f.key}`}
          placeholder={place} rows={3} className="min-h-20"
          value={val} onChange={(e) => set(e.target.value)} />
      );
    }
    if (kind === "series" || kind === "race" || kind === "class") {
      const opts = kind === "series" ? series : kind === "race" ? races : classes;
      const label = { series: "Event / Series", race: "Race", class: "Class / Fleet" }[kind];
      return (
        <Select key={f.key} value={val || "__none__"} onValueChange={(v) => set(v === "__none__" ? "" : v)}>
          <SelectTrigger data-testid={`field-${f.key}`}>            <SelectValue placeholder={`Optional — select ${label}`} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {opts.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {kind === "series" ? o.name : kind === "race" ? `Race ${o.race_number} — ${o.date}` : o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input key={f.key} type={inputKind(kind)} data-testid={`field-${f.key}`}
        placeholder={place} value={val} onChange={(e) => set(e.target.value)} />
    );
  };

  // ---- Step 4: attachments ----------------------------------------------------
  const addAttachment = (list, file) => {
    setAttachments((prev) => [...prev, { file, name: file.name || `Attachment ${prev.length + 1}`, local: true }]);
  };

  // ---- Create draft (generated) ----------------------------------------------
  const createGenerated = async () => {
    if (typeKey === "general_club_notice" && !(fields.body || "").trim()) {
      toast.error("Please enter the notice content before continuing.");
      return;
    }
    const payload = {
      notice_type: typeKey,
      publication_area: publicationArea,
      title: fields.subject || (typeDef ? typeDef.label : ""),
      notice_number: noticeNumber,
      effective_datetime: effectiveDatetime || null,
      fields,
    };
    const targetClubId = ctx?.club_id || selectedClubId || clubId;
    if (targetClubId) payload.club_id = targetClubId;
    const n = await api.createNotice(payload);
    setNoticeId(n.id);
    setDraftVersion(n.version);
    return n;
  };

  // ---- Create draft (uploaded) -----------------------------------------------
  const createUploaded = async () => {
    if (!uploadFile) { toast.error("Choose a document to upload."); return null; }
    const n = await api.uploadNotice({
      notice_type: typeKey,
      publication_area: publicationArea,
      title: fields.title || (uploadFile.name || "Uploaded notice"),
      notice_number: noticeNumber,
      series_id: fields.series_id || (ctx?.series_id || null),
      race_id: fields.race_id || (ctx?.race_id || null),
      class_id: fields.class_id || (ctx?.class_id || null),
      publication_datetime: publicationDatetime || null,
      effective_datetime: effectiveDatetime || null,
      club_id: ctx?.club_id || selectedClubId || clubId || null,
    }, uploadFile);
    setNoticeId(n.id);
    setDraftVersion(n.version);
    return n;
  };

  // ---- Step 5: preview --------------------------------------------------------
  // Generated notices preview the rendered HTML + the generated PDF (spec 44).
  // Uploaded notices preview their metadata + the actual uploaded document —
  // never its reproduced content (spec 48).
  const previewRecord = useMemo(() => {
    if (!typeDef || !noticeId) return null;
    // Build what the public ONB would show for this generated notice.
    if (method === "generated") {
      return {
        id: noticeId,
        notice_type: typeKey,
        notice_type_label: typeDef.label,
        notice_number: noticeNumber,
        title: fields.subject || typeDef.label,
        heading: publicationArea,
        content_type: "generated",
        status: "draft",
        version: draftVersion || 1,
        published_at: null,
        effective_at: effectiveDatetime || null,
        race_number: ctx?.race_number || null,
        race_date: ctx?.race_date || null,
        class_name: ctx?.class_name || null,
        event_name: ctx?.series_name || null,
        series_name: ctx?.series_name || null,
        body: (typeDef.fields || [])
          .filter((f) => !["series", "race", "class"].includes(f.kind) && fields[f.key])
          .map((f) => ({ label: f.label, value: fields[f.key] })),
      };
    }
    return {
      id: noticeId,
      notice_type: typeKey,
      notice_type_label: typeDef.label,
      notice_number: noticeNumber,
      title: fields.title || (uploadFile ? uploadFile.name : "Uploaded notice"),
      heading: publicationArea,
      content_type: "uploaded",
      status: "draft",
      version: draftVersion || 1,
      published_at: publicationDatetime || null,
      effective_at: effectiveDatetime || null,
      race_number: ctx?.race_number || null,
      race_date: ctx?.race_date || null,
      class_name: ctx?.class_name || null,
      event_name: ctx?.series_name || null,
      series_name: ctx?.series_name || null,
      has_file: !!uploadFile,
      original_filename: uploadFile?.name || null,
      file_size: uploadFile?.size || null,
      body: [],
    };
  }, [typeDef, typeKey, noticeId, method, fields, noticeNumber, effectiveDatetime, publicationDatetime, publicationArea, ctx, draftVersion, uploadFile]);

  // Generate the PDF blob for the preview pane and the data URL for publishing.
  useEffect(() => {
    if (method === "generated" && previewRecord && typeDef) {
      const opts = { notice: previewRecord, clubName: clubName || ctx?.club_name, adverts: [] };
      const url = noticePdfBlobUrl(opts);
      setPreviewUrl(url);
      return () => { if (url) URL.revokeObjectURL(url); };
    }
    return undefined;
  }, [method, previewRecord, typeDef, clubName, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Publish ----------------------------------------------------------------
  const publish = async () => {
    if (!noticeId) { toast.error("Create the draft first."); return; }
    setPublishing(true);
    try {
      // Attach supporting documents (step 4) if any were added but not yet stored.
      // (For a generated notice these go onto the draft before publishing.)
      for (const a of attachments.filter((x) => x.local)) {
        await api.addNoticeAttachment(noticeId, a.file, a.name);
      }
      // Generated notices carry the formal PDF; uploaded notices publish the
      // uploaded document as their content (no re-generated PDF, spec 48).
      const pdfUrl = method === "generated" ? noticePdfDataUrl({ notice: previewRecord, clubName: clubName || ctx?.club_name, adverts: [] }) : null;
      const n = await api.publishNotice(noticeId, pdfUrl, draftVersion);
      toast.success("Notice published to the Official Notice Board.");
      if (onDone) onDone(n);
      navigate("/officer");
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Publish failed.");
    } finally {
      setPublishing(false);
    }
  };

  // ---- Discard / cancel -------------------------------------------------------
  const discard = async () => {
    if (noticeId) {
      try {
        await api.deleteNotice(noticeId);
      } catch { /* non-fatal */ }
    }
    navigate("/officer");
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Loading…</div>;
  }

  const activeType = typeDef;
  const issueList = typeCards;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="font-heading text-xl uppercase tracking-tight">
            <span className="text-ocean">+</span> New Notice
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{clubName || "Your club"}</span>
            <Button variant="ghost" size="sm" data-testid="notice-cancel" onClick={discard}>
              Cancel
            </Button>
          </div>
        </div>
      </header>

      {/* Step indicator */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center gap-1 text-[11px]">
          {STEPS.map((label, i) => (
            <span key={label} className="flex items-center gap-1">
              <span className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide
                ${i === step ? "bg-ocean text-white" : i < step ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}
                data-testid={`step-${i + 1}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="text-muted-foreground/50 mx-0.5">›</span>}
            </span>
          ))}
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* STEP 1 — Notice Type */}
        {step === 0 && (
          <section data-testid="step-type">
            <h2 className="text-lg uppercase tracking-tight mb-1">What type of notice?</h2>
            <p className="text-muted-foreground text-sm mb-5">The fields offered next depend on the notice type — only what is relevant will be shown.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {issueList.map((t) => (
                <button key={t.key} type="button"
                  onClick={() => { setTypeKey(t.key); setFields(seedFields(t, ctx, noticeNumber)); }}
                  data-testid={`type-${t.key}`}
                  className={`text-left rounded-xl border p-4 transition-colors ${
                    typeKey === t.key ? "border-ocean ring-2 ring-ocean/20 bg-ocean/5" : "border-border hover:border-ocean/50 bg-card"
                  }`}>
                  <div className="font-heading uppercase tracking-tight">{t.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t.description}</div>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={goNext} data-testid="type-next" className="gap-2 bg-ocean hover:bg-ocean-dark" disabled={!typeKey}>Continue <ChevronRight className="w-4 h-4" /></Button>
            </div>
          </section>
        )}

        {/* STEP 2 — Create Method */}
        {step === 1 && (
          <section data-testid="step-method">
            <h2 className="text-lg uppercase tracking-tight mb-1">How would you like to create it?</h2>
            <p className="text-muted-foreground text-sm mb-5">Either type the notice straight into Sailscore, or upload an existing document as the official notice.</p>
            <RadioGroup value={method} onValueChange={(v) => setMethod(v)} className="grid sm:grid-cols-2 gap-3" data-testid="method-radio">
              <label className={`flex flex-col rounded-xl border p-5 cursor-pointer ${method === "generated" ? "border-ocean ring-2 ring-ocean/20 bg-ocean/5" : "border-border bg-card"}`}>
                <RadioGroupItem value="generated" id="method-generated" className="sr-only" />
                <div className="flex items-center gap-2">
                  <span className="text-xl">✍️</span>
                  <span className="font-heading uppercase tracking-tight">Create with Sailscore</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Use Sailscore’s structured fields to build a professional notice — an HTML version and a formal PDF are generated automatically.</p>
              </label>
              <label className={`flex flex-col rounded-xl border p-5 cursor-pointer ${method === "uploaded" ? "border-ocean ring-2 ring-ocean/20 bg-ocean/5" : "border-border bg-card"}`}>
                <RadioGroupItem value="uploaded" id="method-uploaded" className="sr-only" />
                <div className="flex items-center gap-2">
                  <span className="text-xl">📄</span>
                  <span className="font-heading uppercase tracking-tight">Upload Existing Notice</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Upload a PDF you have already produced — it is stored as the authoritative official document and never altered.</p>
              </label>
            </RadioGroup>
            <div className="mt-6 flex justify-between">
              <Button variant="outline" onClick={goBack} className="gap-1.5"><ChevronLeft className="w-4 h-4" /> Back</Button>
              <Button onClick={goNext} data-testid="method-next" className="gap-2 bg-ocean hover:bg-ocean-dark">Continue <ChevronRight className="w-4 h-4" /></Button>
            </div>
          </section>
        )}

        {/* STEP 3 — Notice Details */}
        {step === 2 && (
          <section data-testid="step-details">
            <h2 className="text-lg uppercase tracking-tight mb-1">Notice details — {activeType?.label}</h2>
            {role === "webmaster" && (
              <div className="space-y-1.5 mt-3 mb-4">
                <Label>Club</Label>
                <Select value={selectedClubId || undefined} onValueChange={(v) => { setSelectedClubId(v); setClasses([]); setSeries([]); setRaces([]); setFields((p) => ({ ...p, series_id: "", race_id: "", class_id: "" })); }}>
                  <SelectTrigger data-testid="field-club"><SelectValue placeholder="Select club" /></SelectTrigger>
                  <SelectContent>{clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="rounded-xl border border-ocean/20 bg-ocean/5 p-4 space-y-2" data-testid="publication-area-selector">
              <Label className="font-heading uppercase text-sm">Where should this notice appear?</Label>
              <p className="text-xs text-muted-foreground">Choose the club-wide board or the open event notices section.</p>
              <RadioGroup value={publicationArea} onValueChange={setPublicationArea} className="grid sm:grid-cols-2 gap-2">
                {publicationAreas.map((area) => <label key={area.key} className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer ${publicationArea === area.key ? "border-ocean bg-white dark:bg-card" : "border-border"}`}>
                  <RadioGroupItem value={area.key} id={`publication-area-${area.key}`} />
                  <span><span className="block font-semibold">{area.title}</span><span className="block text-xs text-muted-foreground">Notices posted in this ONB area</span></span>
                </label>)}
              </RadioGroup>
              <div className="flex flex-wrap gap-2 pt-1">
                <Input value={newAreaName} onChange={(e) => setNewAreaName(e.target.value)} placeholder="Example: Sailing Instructions" data-testid="new-notice-area-input" />
                <Button type="button" variant="outline" disabled={addingArea || !newAreaName.trim()} data-testid="add-notice-area-btn" onClick={async () => {
                  const targetClubId = ctx?.club_id || selectedClubId || clubId;
                  if (!targetClubId) return toast.error("Select a club first.");
                  setAddingArea(true);
                  try {
                    const area = await api.addNoticeArea(targetClubId, newAreaName.trim());
                    setPublicationAreas((prev) => [...prev, { key: area.title, title: area.title }]);
                    setPublicationArea(area.title);
                    setNewAreaName("");
                    toast.success("Notice area created");
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || e?.message || "Could not create notice area");
                  } finally { setAddingArea(false); }
                }}><Plus className="w-4 h-4" /> {addingArea ? "Creating…" : "New notice area"}</Button>
              </div>
            </div>
            {ctx && (
              <div className="mt-2 mb-5 inline-flex flex-wrap items-center gap-2 rounded-lg border border-ocean/20 bg-ocean/5 px-3 py-2 text-xs text-ocean" data-testid="prefilled-context">
                <Check className="w-4 h-4" /> Auto-filled from: {contextSummary(ctx)}
              </div>
            )}

            <div className="grid gap-4">
              {/* Notice number */}
              <div className="space-y-1.5 w-full sm:w-40">
                <Label>Notice number</Label>
                <Input type="number" min="1" data-testid="field-notice-number"
                  value={noticeNumber} onChange={(e) => setNoticeNumber(Number(e.target.value) || 1)} />
              </div>

              {/* Uploaded: document picker */}
              {method === "uploaded" && (
                <div className="rounded-xl border border-dashed border-border p-5 bg-card">
                  <Label className="flex items-center gap-2 mb-3"><UploadCloud className="w-4 h-4 text-ocean" /> Official document</Label>
                  <input type="file" id="upload-new-notice-file" accept=".pdf,image/png,image/jpeg,image/webp"
                    data-testid="upload-notice-file" className="hidden"
                    onChange={(e) => setUploadFile(e.target.files[0] || null)} />
                  <Button variant="outline" type="button" onClick={() => document.getElementById("upload-new-notice-file").click()}
                    className="gap-2" data-testid="choose-notice-file">
                    <FileText className="w-4 h-4" /> {uploadFile ? uploadFile.name : "Choose PDF or image"}
                  </Button>
                  {uploadFile && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {(uploadFile.size / 1024).toFixed(0)} KB · stored exactly as provided, never modified
                    </p>
                  )}
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    Your document becomes the notice content — you do not retype it. Add its metadata below.
                  </p>
                </div>
              )}

              {/* Generated: title = subject; uploaded: separate title */}
              {method === "uploaded" && (
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input data-testid="field-title" value={fields.title || ""}
                    placeholder="Example: Notice to Competitors No. 4 — change of race area"
                    onChange={(e) => setFields((p) => ({ ...p, title: e.target.value }))} />
                </div>
              )}

              {/* Generated: dynamic structured fields (spec 34). The subject IS
                  the title for generated notices, so it doubles as the heading. */}
              {method === "generated" && activeType && (
                <div className="grid gap-4" data-testid="dynamic-fields">
                  {linkOptionsLoading && <p className="text-xs text-muted-foreground">Loading optional race links…</p>}
                  {activeType.fields.map(renderField)}
                </div>
              )}

              {/* Metadata shared by both methods (spec 38/39) */}
              <div className="rounded-xl border border-border p-4 bg-card space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-ocean">Publication &amp; effective date/time</h3>
                {method === "uploaded" && (
                  <div className="space-y-1.5">
                    <Label>Publication date/time</Label>
                    <Input type="datetime-local" data-testid="field-publication-datetime"
                      value={publicationDatetime} onChange={(e) => setPublicationDatetime(e.target.value)} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Effective date/time (optional)</Label>
                  <Input type="datetime-local" data-testid="field-effective-datetime"
                    value={effectiveDatetime} onChange={(e) => setEffectiveDatetime(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <Button variant="outline" onClick={goBack} className="gap-1.5"><ChevronLeft className="w-4 h-4" /> Back</Button>
              <Button onClick={goNext} data-testid="details-next" className="gap-2 bg-ocean hover:bg-ocean-dark">Continue <ChevronRight className="w-4 h-4" /></Button>
            </div>
          </section>
        )}

        {/* STEP 4 — Attachments */}
        {step === 3 && (
          <section data-testid="step-attachments">
            <h2 className="text-lg uppercase tracking-tight mb-1">Attachments</h2>
            <p className="text-muted-foreground text-sm mb-5">Optional supporting documents: a course diagram, an extra instruction sheet, photos of a protest form, and so on.</p>
            <input type="file" id="add-attachment-input" className="hidden" accept=".pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => { if (e.target.files[0]) addAttachment(null, e.target.files[0]); e.target.value = ""; }} />
            <Button variant="outline" type="button" onClick={() => document.getElementById("add-attachment-input").click()}
              className="gap-2" data-testid="add-attachment">
              <Plus className="w-4 h-4" /> Add attachment
            </Button>
            {attachments.length > 0 && (
              <ul className="mt-4 space-y-2" data-testid="attachment-list">
                {attachments.map((a, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                    <FileText className="w-4 h-4 text-ocean" />
                    <span className="flex-1 truncate">{a.name}</span>
                    <Button variant="ghost" size="icon" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}
                      aria-label={`Remove ${a.name}`} data-testid={`remove-attachment-${i}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex justify-between">
              <Button variant="outline" onClick={goBack} className="gap-1.5"><ChevronLeft className="w-4 h-4" /> Back</Button>
              <Button onClick={goNext} data-testid="attachments-next" className="gap-2 bg-ocean hover:bg-ocean-dark">Continue <ChevronRight className="w-4 h-4" /></Button>
            </div>
          </section>
        )}

        {/* STEP 5 — Preview */}
        {step === 4 && (
          <section data-testid="step-preview">
            <h2 className="text-lg uppercase tracking-tight mb-1">Preview</h2>
            <p className="text-muted-foreground text-sm mb-5">This is exactly what competitors will see on the Official Notice Board.</p>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-ocean text-white uppercase">{activeType?.label}</Badge>
                <span className="text-2xl font-heading">{noticeHeadingLine(previewRecord || {})}</span>
              </div>
              <div className="font-heading text-lg uppercase tracking-tight">{previewRecord?.title}</div>
              {(previewRecord?.event_name || previewRecord?.race_number) && (
                <div className="text-sm text-muted-foreground mt-0.5">
                  {noticeContextLine(previewRecord)}
                </div>
              )}
              <div className="my-3 border-b border-border" />
              <NoticeFacts notice={previewRecord} />

              {method === "generated" ? (
                <>
                  <div className="my-4 border-t border-border pt-4"><NoticeBodyView notice={previewRecord} /></div>
                  {previewUrl && (
                    <div className="rounded-lg border border-border overflow-hidden mt-4">
                      <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
                        <span>Formal PDF preview</span>
                        <Button variant="ghost" size="sm" className="gap-1.5" asChild>
                          <a href={previewUrl} target="_blank" rel="noopener noreferrer"><Download className="w-3.5 h-3.5" /> Open PDF</a>
                        </Button>
                      </div>
                      <iframe title="Notice PDF preview" src={previewUrl} className="w-full h-[50vh]" data-testid="notice-pdf-preview" />
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4" data-testid="uploaded-preview">
                  {uploadFile ? (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <object data={URL.createObjectURL(uploadFile)} type={uploadFile.type} className="w-full h-[50vh]" data-testid="uploaded-file-preview">
                        <p className="p-4 text-sm text-muted-foreground text-center">Preview unavailable — use Open / Download after publishing.</p>
                      </object>
                      <div className="flex flex-wrap gap-2 px-3 py-2 bg-muted/50">
                        <Button variant="outline" size="sm" className="gap-1.5" asChild>
                          <a href={URL.createObjectURL(uploadFile)} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5" /> Open</a>
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5"><Download className="w-3.5 h-3.5" /> Download</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-600">Upload a document before previewing.</p>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-between items-center">
              <Button variant="outline" onClick={goBack} className="gap-1.5"><ChevronLeft className="w-4 h-4" /> Back to Edit</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => goBack()} className="gap-1.5">Edit</Button>
                <Button onClick={goNext} data-testid="preview-publish" className="gap-2 bg-ocean hover:bg-ocean-dark" disabled={!noticeId}>Publish <ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          </section>
        )}

        {/* STEP 6 — Publish confirm */}
        {step === 5 && (
          <section data-testid="step-publish">
            <div className="max-w-lg mx-auto text-center">
              <div className="mb-4 text-6xl">📣</div>
              <h2 className="text-xl font-heading uppercase tracking-tight mb-2">Publish to Official Notice Board?</h2>
              <p className="text-muted-foreground text-sm mb-4">
                <span className="font-semibold text-foreground">{activeType?.label}</span> — "{previewRecord?.title}"
                will be published on the {clubName || "club"} notice board.
              </p>
              <div className="mb-6 rounded-lg bg-muted/50 px-4 py-3 text-sm space-y-1 text-left">
                <div className="flex justify-between"><span className="text-muted-foreground">Notice no.</span><span>{noticeNumber}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Heading</span><span>{previewRecord?.heading}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Documents</span><span>{method === "uploaded" ? (uploadFile ? "1 official document" : "0") : "1 formal PDF"}</span></div>
              </div>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={goBack} className="gap-1.5"><ChevronLeft className="w-4 h-4" /> Back</Button>
                <Button onClick={publish} disabled={publishing} data-testid="notice-publish"
                  className="gap-2 bg-safety hover:bg-safety-dark">
                  {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {publishing ? "Publishing…" : "Publish to Official Notice Board"}
                </Button>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}