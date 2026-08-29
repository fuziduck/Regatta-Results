// The public Official Notice Board (spec 41/42/43): notices grouped under the
// club's ONB AREAS — the officer-chosen publication area the backend stores on
// each notice ("Club Notices", "Open Event Notices" or a custom club area) —
// each area splitting into its notice TYPES. Notice numbers are sequential per
// area, so within each type the issued number orders the notices. Generated
// notices show the readable HTML version plus a stored formal PDF; uploaded
// notices show the official document in an embedded viewer where possible,
// with Open/Download actions — the document itself is served byte-for-byte as
// the club issued it (spec 48). Superseded versions never appear in the list;
// withdrawn ones stay, clearly marked.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NoticeBodyView, NoticeFacts, noticeHeadingLine, noticeContextLine } from "@/components/NoticeBody";
import { Download, ExternalLink, FileText, FlagTriangleRight, ScrollText } from "lucide-react";

// URL-friendly slug for a notice area (used by the ?area= deep link).
const areaSlug = (area) => area.replace(/\W+/g, "-").toLowerCase();

// The two built-in ONB areas always exist (backend /notice-areas); custom club
// areas sort alphabetically after them. When the club's configured area list
// is available it takes precedence over this order.
const BUILTIN_AREA_ORDER = ["Club Notices", "Open Event Notices"];

// Normalise raw publication-area KEYS to their display titles for legacy
// notices whose stored heading predates the key→title mapping on the backend.
const AREA_KEY_TITLES = { club: "Club Notices", open_event: "Open Event Notices" };
const areaTitle = (heading) => AREA_KEY_TITLES[heading] || heading || "Club Notices";

// Canonical notice type order (mirrors the backend catalogue) — used to order
// the type sub-sections within each area; unknown types sort alphabetically
// after the catalogue.
const TYPE_ORDER = [
  "notice_to_competitors",
  "si_amendment",
  "race_postponement",
  "race_cancellation",
  "hearing_schedule",
  "hearing_decision",
  "results_notice",
  "safety_notice",
  "general_club_notice",
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

function LinkNotice({ notice }) {
  // A LINK notice points at an external website: the card carries the URL and
  // a button that opens it in a new tab.
  const url = notice.link_url || "";
  if (!url) {
    return <p className="mt-3 text-xs text-muted-foreground" data-testid={`link-notice-${notice.id}`}>Website link unavailable.</p>;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid={`link-notice-${notice.id}`}>
      <Button size="sm" variant="outline" className="gap-1.5 border-ocean text-ocean hover:bg-ocean hover:text-white" asChild
        data-testid={`visit-link-${notice.id}`}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="w-4 h-4" /> Visit website
        </a>
      </Button>
      <span className="text-xs text-muted-foreground truncate max-w-[260px]" title={url}>{url}</span>
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
        {notice.content_type === "uploaded" ? <UploadedDocument notice={notice} />
          : notice.content_type === "link" ? <LinkNotice notice={notice} />
            : <GeneratedNotice notice={notice} />}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [notices, setNotices] = useState(null);
  // The club's configured ONB areas in display order (null when unavailable).
  const [areas, setAreas] = useState(null);
  // The area the board is filtered down to (null = all areas). Mirrors the
  // class/series filter idea from the results page.
  const [activeArea, setActiveArea] = useState(null);
  const [openId, setOpenId] = useState(() => {
    const h = window.location.hash || "";
    return h.startsWith("#notice-") ? h.slice(8) : null;
  });

  useEffect(() => {
    if (!clubId) return;
    api.getNotices({ club_id: clubId, ...(sectionId ? { section_id: sectionId } : {}) }).then(setNotices).catch(() => setNotices([]));
    api.getNoticeAreas(clubId).then((list) => setAreas(list.map((a) => a.title))).catch(() => setAreas(null));
  }, [clubId, sectionId]);

  // Within its type, a notice is ordered by its issued number, smallest first
  // (a number is stable across revisions, unlike publication time).
  const byNoticeNumber = (a, b) => Number(a.notice_number ?? Infinity) - Number(b.notice_number ?? Infinity)
    || ((a.published_at || "").localeCompare(b.published_at || ""));

  // Group into the main notice AREAS first (the officer-chosen publication
  // area stored on each notice — heading), then within each area by notice
  // TYPE — a number is only comparable within its own type, so each type keeps
  // its own numbered sequence.
  const groups = new Map(); // area -> Map<typeKey, { label, items }>
  (notices || []).forEach((n) => {
    const typeKey = n.notice_type || n.notice_type_label || "notice";
    const area = areaTitle(n.heading);
    if (!groups.has(area)) groups.set(area, new Map());
    const typeGroups = groups.get(area);
    if (!typeGroups.has(typeKey)) {
      typeGroups.set(typeKey, { label: n.notice_type_label || n.notice_type || "Notice", items: [] });
    }
    typeGroups.get(typeKey).items.push(n);
  });
  // Areas follow the club's configured order when known; otherwise the two
  // built-in areas first, then the rest alphabetically. Within an area, types
  // follow the canonical type order, then alphabetical.
  const typeRank = (key) => { const i = TYPE_ORDER.indexOf(key); return i < 0 ? 99 : i; };
  const areaRank = (area) => {
    if (areas && areas.includes(area)) return areas.indexOf(area);
    const i = BUILTIN_AREA_ORDER.indexOf(area);
    return i < 0 ? 99 : i;
  };
  const areaOrder = [...groups.keys()].sort((a, b) => {
    const ra = areaRank(a); const rb = areaRank(b);
    return (ra - rb) || a.localeCompare(b);
  });

  // Deep link (#notice-<id>): the linked notice opens expanded and is scrolled
  // into view.
  useEffect(() => {
    if (openId && notices && notices.some((n) => n.id === openId)) {
      const el = document.querySelector(`[data-testid="notice-trigger-${openId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [openId, notices]);

  // ?area=<slug> deep link: when the board's areas are known, honour a
  // requested area filter (e.g. from a shared link) unless the visitor has
  // already picked one.
  useEffect(() => {
    if (!notices || !notices.length || activeArea) return;
    const wanted = searchParams.get("area");
    if (!wanted) return;
    const match = areaOrder.find((a) => areaSlug(a) === wanted);
    if (match) setActiveArea(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, notices]);

  if (!clubId || !notices) return null;
  if (!notices.length) return null;

  // Selecting an area filters the board down to that area's full notices; the
  // choice is kept in the URL so the filtered view can be shared like a
  // results link. With a single area (or few) the filter bar is unnecessary.
  const selectArea = (area) => {
    setActiveArea(area);
    const p = new URLSearchParams(searchParams);
    if (area) p.set("area", areaSlug(area));
    else p.delete("area");
    setSearchParams(p, { replace: true });
  };
  const visibleAreas = activeArea && areaOrder.includes(activeArea) ? [activeArea] : areaOrder;

  return (
    <section className={embedded ? "" : "min-h-screen bg-background py-10"} data-testid="official-notice-board">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-heading uppercase tracking-tight text-xl">Official Notice Board</h2>
        <span className="text-xs text-muted-foreground">· notices, amendments, protests and results as published</span>
      </div>
      {areaOrder.length > 3 && (
        <div className="mb-6" data-testid="area-filter-tabs">
          <Tabs value={activeArea ? areaSlug(activeArea) : "all"}
            onValueChange={(v) => selectArea(v === "all" ? null : areaOrder.find((a) => areaSlug(a) === v))}>
            <TabsList className="h-auto flex-wrap gap-2 w-fit">
              <TabsTrigger value="all" data-testid="area-tab-all"
                className="px-3 py-1.5 rounded-lg border border-ocean/30 text-ocean data-[state=active]:bg-ocean data-[state=active]:text-white font-heading uppercase tracking-wide text-sm">
                All areas
              </TabsTrigger>
              {areaOrder.map((a) => (
                <TabsTrigger key={a} value={areaSlug(a)} data-testid={`area-tab-${areaSlug(a)}`}
                  className="px-3 py-1.5 rounded-lg border border-ocean/30 text-ocean data-[state=active]:bg-ocean data-[state=active]:text-white font-heading uppercase tracking-wide text-sm">
                  {a}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      <div className="columns-1 md:columns-2 xl:columns-3 gap-x-8">
        {visibleAreas.map((area) => {
          const typeGroups = groups.get(area);
          // Each area stays whole inside one column (never split across a
          // break), splitting into its notice types below.
          const types = [...typeGroups.keys()].sort((a, b) =>
            typeRank(a) - typeRank(b) || typeGroups.get(a).label.localeCompare(typeGroups.get(b).label));
          return (
            <div key={area} id={`notice-heading-anchor-${area.replace(/\W+/g, "-").toLowerCase()}`}
              className="mb-8 break-inside-avoid">
              <h3 className="font-heading text-base font-bold uppercase tracking-tight text-ocean border-b border-ocean/30 pb-1.5 mb-4">
                {area}
              </h3>
              {types.map((typeKey) => {
                const group = typeGroups.get(typeKey);
                return (
                  <div key={typeKey} className="mb-6">
                    <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                      {group.label}
                    </h4>
                    <Accordion type="single" collapsible value={openId} onValueChange={(v) => setOpenId(v || null)}>
                      {group.items.slice().sort(byNoticeNumber).map((n) => (
                        <NoticeCard key={n.id} notice={n} open={openId === n.id} />
                      ))}
                    </Accordion>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
