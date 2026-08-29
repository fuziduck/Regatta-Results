// The public Official Notice Board (spec 41/42/43): notices grouped under
// their automatic headings. Generated notices show the readable HTML version
// plus a stored formal PDF; uploaded notices show the official document in an
// embedded viewer where possible, with Open/Download actions — the document
// itself is served byte-for-byte as the club issued it (spec 48). Superseded
// versions never appear in the list; withdrawn ones stay, clearly marked.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { NoticeBodyView, NoticeFacts, noticeHeadingLine, noticeContextLine } from "@/components/NoticeBody";
import { Download, ExternalLink, FileText, FlagTriangleRight, ScrollText } from "lucide-react";

// Canonical heading order — mirrors the backend catalogue order (spec 43's
// default structure). Unknown headings fall back to alphabetical after these.
const HEADING_ORDER = [
  "Club Notices",
  "Open Event Notices",
  "Notices to Competitors",
  "Sailing Instructions / Amendments",
  "Race Notices",
  "Protests & Hearings",
  "Results",
  "Safety",
  "General Notices",
];

// Fetch the full notice (with the stored PDF / uploaded document payloads)
// on demand — list responses stay light.
function useNoticeDocument() {
  const [docs, setDocs] = useState({});
  const load = async (id) => {
    if (docs[id]) return docs[id];
    const full = await api.getNotice(id);
    setDocs((prev) => ({ ...prev, [id]: full }));
    return full;
  };
  return [docs, load];
}

function openDocument(dataUrl) {
  if (!dataUrl) return false;
  try {
    const [header, encoded] = dataUrl.split(",", 2);
    const mime = (header.match(/data:([^;]+)/) || [])[1] || "application/pdf";
    const binary = atob(encoded || "");
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
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

function UploadedDocument({ notice }) {
  const [docs, load] = useNoticeDocument();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const full = docs[notice.id];

  const getDoc = async () => {
    try {
      return await load(notice.id);
    } catch {
      setError("Could not load the document.");
      return null;
    }
  };

  const view = async () => {
    const f = await getDoc();
    if (!f?.file_data_url) {
      setError("The official document is unavailable.");
      return;
    }
    openDocument(f.file_data_url);
  };


  return (
    <div className="mt-3" data-testid={`uploaded-doc-${notice.id}`}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Official Document</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="gap-1.5 border-ocean text-ocean hover:bg-ocean hover:text-white"
          data-testid={`view-pdf-${notice.id}`} onClick={view}>
          <ScrollText className="w-4 h-4" /> View PDF
        </Button>

      </div>
      {full?.original_filename && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {full.original_filename} · {(full.file_size / 1024).toFixed(0)} KB · published exactly as issued
        </p>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

    </div>
  );
}

function GeneratedNotice({ notice }) {
  const [docs, load] = useNoticeDocument();
  const [error, setError] = useState(null);
  const view = async () => {
    try {
      const f = docs[notice.id] || (await load(notice.id));
      if (f.pdf_data_url) openDocument(f.pdf_data_url);
      else setError("The formal PDF is not available for this notice.");
    } catch {
      setError("Could not load the PDF.");
    }
  };
  return (
    <div className="mt-3" data-testid={`generated-notice-${notice.id}`}>
      <NoticeBodyView notice={notice} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="gap-1.5 border-ocean text-ocean hover:bg-ocean hover:text-white"
          data-testid={`view-generated-pdf-${notice.id}`} onClick={view}>
          <ExternalLink className="w-4 h-4" /> View PDF
        </Button>
        <span className="text-xs text-muted-foreground">Formal document version (A4)</span>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function NoticeCard({ notice, open, onToggle }) {
  const ctx = noticeContextLine(notice);
  return (
    <AccordionItem value={notice.id} className={`border rounded-xl mb-3 px-4 bg-card ${notice.status === "withdrawn" ? "opacity-80" : ""}`}>
      <AccordionTrigger className="hover:no-underline" data-testid={`notice-trigger-${notice.id}`} onClick={onToggle}>
        <div className="flex items-start gap-3 text-left">
          <div className={`w-10 h-10 rounded-lg grid place-items-center font-heading shrink-0 mt-0.5
            ${notice.status === "withdrawn" ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" : "bg-ocean/10 text-ocean"}`}>
            <FlagTriangleRight className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-heading uppercase tracking-tight leading-tight flex flex-wrap items-center gap-2">
              {noticeHeadingLine(notice)}
              {notice.status === "withdrawn" && (
                <Badge className="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" data-testid={`withdrawn-badge-${notice.id}`}>
                  Withdrawn
                </Badge>
              )}

            </div>
            <div className="font-semibold mt-0.5">{notice.title}</div>
            {(ctx || notice.published_at) && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {ctx}{ctx && notice.published_at ? " · " : ""}
                {notice.published_at && <>Published {new Date(notice.published_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</>}
              </div>
            )}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>                {notice.status === "withdrawn" && notice.withdrawal_reason && (

          <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-3 text-sm text-red-700 dark:text-red-300" data-testid={`withdrawn-note-${notice.id}`}>
            <span className="font-semibold">Withdrawn</span> — {notice.withdrawal_reason}
          </div>
        )}
        <NoticeFacts notice={notice} />
        {notice.content_type === "uploaded" ? <UploadedDocument notice={notice} /> : <GeneratedNotice notice={notice} />}
        {(notice.attachments || []).length > 0 && (
          <div className="mt-4 pt-3 border-t border-border" data-testid={`attachments-${notice.id}`}>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Attachments</div>
            <ul className="text-sm space-y-1">
              {notice.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-muted-foreground">
                  <FileText className="w-3.5 h-3.5 shrink-0" /> {a.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

export default function NoticeBoard({ clubId, embedded = false, sectionId = null }) {
  const [notices, setNotices] = useState(null);
  const [openId, setOpenId] = useState(() => {
    const h = window.location.hash || "";
    return h.startsWith("#notice-") ? h.slice(8) : null;
  });

  useEffect(() => {
    if (!clubId) return;
    api.getNotices({ club_id: clubId, ...(sectionId ? { section_id: sectionId } : {}) }).then(setNotices).catch(() => setNotices([]));
  }, [clubId, sectionId]);

  // Deep link (#notice-<id>): the linked notice opens expanded.
  useEffect(() => {
    if (openId && notices && notices.some((n) => n.id === openId)) {
      const el = document.getElementById(`notice-heading-anchor-${openId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [openId, notices]);

  if (!clubId || !notices) return null;
  if (!notices.length) return null;

  const groups = new Map();
  notices.forEach((n) => {
    const key = n.heading || "General Notices";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  });
  const ordered = [...groups.keys()].sort((a, b) => {
    const ia = HEADING_ORDER.indexOf(a); const ib = HEADING_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  return (
    <section className={embedded ? "" : "min-h-screen bg-background py-10"} data-testid="official-notice-board">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-heading uppercase tracking-tight text-xl">Official Notice Board</h2>
        <span className="text-xs text-muted-foreground">· notices, amendments, protests and results as published</span>
      </div>
      <div className="space-y-6">
        {ordered.map((heading) => (
          <div key={heading} id={`notice-heading-anchor-${heading.replace(/\W+/g, "-").toLowerCase()}`}>
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-ocean border-b border-ocean/20 pb-1.5 mb-3">
              {heading}
            </h3>
            <Accordion type="single" collapsible value={openId} onValueChange={(v) => setOpenId(v || null)}>
              {(groups.get(heading) || []).map((n) => (
                <NoticeCard key={n.id} notice={n} open={openId === n.id} />
              ))}
            </Accordion>
          </div>
        ))}
      </div>
    </section>
  );
}
