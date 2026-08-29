import { jsPDF } from "jspdf";
import { pickPdfSponsors, FOOTER_BAND_HEIGHT } from "./exportPdf";
import { SITE_NAME, SITE_ATTRIBUTION, SITE_SUPPORTERS_LINE } from "./siteConfig";

// The formal, printable version of a Sailscore-GENERATED notice (spec 40):
// club logo + name, event/series/race context, every structured field, the
// issuing authority and the publication facts, plus a Sailscore document
// identifier and version. Uploaded notices never come through here — their
// uploaded document IS the formal version and is never re-generated (spec 48).
//
// Same styling architecture as the results exports: OCEAN brand colour,
// A4 in points, 40pt margins, sponsor/attribution footer band.

const OCEAN = [10, 54, 157];
const MUTED = [100, 116, 139];
const INK = [30, 41, 59];
const MARGIN = 40;

function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace("T", " ");
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function noticeHeadingLine(notice) {
  const label = (notice.notice_type_label || "Notice").toUpperCase();
  return notice.notice_number ? `${label} No. ${notice.notice_number}` : label;
}

export function noticeContextLine(notice) {
  const parts = [];
  if (notice.event_name || notice.series_name) parts.push(notice.event_name || notice.series_name);
  if (notice.race_number) parts.push(`Race ${notice.race_number}`);
  if (notice.class_name) parts.push(notice.class_name);
  return parts.join(" · ");
}

// Draw the page footer inside the reserved bottom band: supporters line +
// attribution + the notice's document identifier/version (spec 40).
function drawNoticeFooter(doc, notice, sponsors) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const bandTop = pageH - FOOTER_BAND_HEIGHT - 2;
  doc.setDrawColor(...OCEAN);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, bandTop - 5, pageW - MARGIN, bandTop - 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(doc.splitTextToSize(SITE_SUPPORTERS_LINE, pageW - MARGIN * 2)[0] || "", pageW / 2, bandTop + 6, { align: "center" });
  doc.setFontSize(6);
  doc.text(`${SITE_NAME} · ${SITE_ATTRIBUTION}`, pageW / 2, bandTop + 16, { align: "center" });
  const ident = `${notice.id || ""} · version ${notice.version || 1}`;
  doc.text(doc.splitTextToSize(ident, pageW - MARGIN * 2)[0] || "", pageW / 2, bandTop + 26, { align: "center" });
  if (sponsors.length) {
    doc.setFontSize(6);
    doc.text(sponsors.map((s) => s.name).filter(Boolean).join(" · "), pageW / 2, bandTop + 36, { align: "center" });
  }
}

export function buildNoticePdf({ notice, clubName, icon, adverts }) {
  if (!notice) return null;
  const sponsors = pickPdfSponsors(adverts);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  let y = 0;

  const footerLimit = pageH - FOOTER_BAND_HEIGHT - 24;
  const ensure = (h) => {
    if (y + h > footerLimit) {
      drawNoticeFooter(doc, notice, sponsors);
      doc.addPage();
      y = 48;
    }
  };

  // --- Header: club, ONB banner, logo -------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...OCEAN);
  doc.text(clubName || notice.club_name || "", MARGIN, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("OFFICIAL NOTICE BOARD", MARGIN, 54);
  y = 66;
  if (icon && typeof icon === "string" && icon.startsWith("data:image/")) {
    try {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,/.exec(icon);
      const fmt = m && (m[1] === "image/png" ? "PNG" : m[1] === "image/jpeg" ? "JPEG" : null);
      if (fmt) doc.addImage(icon, fmt, pageW - MARGIN - 38, 24, 38, 38);
    } catch {
      // Unreadable image data — omit the logo rather than fail the export.
    }
  }
  doc.setDrawColor(...OCEAN);
  doc.setLineWidth(1.2);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 26;

  // --- Notice type + number, title, context -------------------------------
  ensure(90);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...OCEAN);
  doc.text(noticeHeadingLine(notice), MARGIN, y);
  y += 24;
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  const titleLines = doc.splitTextToSize(notice.title || "", contentW);
  ensure(titleLines.length * 22 + 4);
  doc.text(titleLines, MARGIN, y);
  y += titleLines.length * 22 + 4;
  const ctx = noticeContextLine(notice);
  if (ctx) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...MUTED);
    const contextLines = doc.splitTextToSize(ctx, contentW);
    ensure(contextLines.length * 14 + 16);
    doc.text(contextLines, MARGIN, y);
    y += contextLines.length * 14;
  }
  y += 6;

  // --- Publication facts ---------------------------------------------------
  const rows = notice.body || [];
  const displayedRowLabels = new Set(rows.map((r) => String(r.label || "").toLowerCase().trim()));
  const facts = [];
  if (notice.published_at && !displayedRowLabels.has("published")) facts.push(["Published", fmtWhen(notice.published_at)]);
  if (notice.effective_at && !displayedRowLabels.has("effective")) facts.push(["Effective", fmtWhen(notice.effective_at)]);
  if (notice.race_date && !displayedRowLabels.has("date")) facts.push(["Race date", notice.race_date]);
  const issuedBy = rows.find((r) => /issued by|race officer/i.test(r.label));
  const issuedByAlreadyRendered = issuedBy && rows.some((r) => r === issuedBy);
  if (issuedBy) facts.push([issuedBy.label, issuedBy.value]);
  if (facts.length) {
    ensure(facts.length * 14 + 14);
    doc.setFontSize(9.5);
    facts.forEach(([k, v]) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...MUTED);
      doc.text(String(k).toUpperCase(), MARGIN, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...INK);
      const valueLines = doc.splitTextToSize(String(v), contentW - 120);
      doc.text(valueLines, MARGIN + 110, y);
      y += Math.max(1, valueLines.length) * 14;
    });
    y += 8;
  }

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 22;

  // --- Notice content (structured label/value sections) -------------------
  rows.forEach((row) => {
    const lines = doc.splitTextToSize(String(row.value || ""), contentW);
    ensure(16 + lines.length * 14 + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    const labelLines = doc.splitTextToSize(String(row.label || "").toUpperCase(), contentW);
    doc.text(labelLines, MARGIN, y);
    y += labelLines.length * 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(lines, MARGIN, y);
    y += lines.length * 14 + 10;
  });

  if (!rows.length && notice.content_type === "uploaded") {
    // Uploaded notices are never re-generated (spec 48) — point at the
    // authoritative document instead of attempting to reproduce it.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text("The official document for this notice is published on the", MARGIN, y);
    y += 14;
    doc.text("Official Notice Board exactly as issued by the club.", MARGIN, y);
    y += 14;
  }

  // Issuing signature block.
  if (issuedBy && !issuedByAlreadyRendered && notice.content_type === "generated") {
    ensure(56);
    y += 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(issuedBy.value, MARGIN, y);
    y += 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text("Issuing authority", MARGIN, y);
    y += 12;
  }

  // Footer on the final page too, then done.
  drawNoticeFooter(doc, notice, sponsors);
  return doc;
}

// Sponsor selection + document construction for the preview/download/publish
// helpers below.
export function noticePdfDocument(opts) {
  return buildNoticePdf(opts);
}

// In-browser preview URL for the wizard's PDF preview pane.
export function noticePdfBlobUrl(opts) {
  const doc = noticePdfDocument(opts);
  if (!doc) return null;
  return URL.createObjectURL(doc.output("blob"));
}

// The publish payload: a strict base64 data URL the backend validates by
// magic bytes (jsPDF's datauristring may carry a filename segment).
export function noticePdfDataUrl(opts) {
  const doc = noticePdfDocument(opts);
  if (!doc) return null;
  const out = doc.output("datauristring");
  const i = out.indexOf("base64,");
  return i >= 0 ? `data:application/pdf;base64,${out.slice(i + 7)}` : null;
}

export function downloadNoticePdf(opts) {
  const doc = noticePdfDocument(opts);
  if (!doc) return;
  const notice = opts.notice || {};
  const slug = `${noticeHeadingLine(notice)} - ${notice.title || "notice"}`
    .replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  doc.save(`${slug}.pdf`);
}
