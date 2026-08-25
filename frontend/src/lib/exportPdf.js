import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtScore, raceCellStyle } from "./resultCellStyle";
import { SITE_NAME, SITE_ATTRIBUTION, SITE_SUPPORTERS_LINE } from "./siteConfig";

// Shared PDF styling for SailScore result exports.
const OCEAN = [10, 54, 157]; // brand ocean blue
const MUTED = [100, 116, 139];

// ---------------------------------------------------------------------------
// Page footer (sponsors + attribution)
// ---------------------------------------------------------------------------
// Every results export carries a compact footer at the bottom of each page:
// the sponsor section first (the main website's active adverts, in their
// existing `order` priority — exactly three when three or more exist, all
// available ones when fewer, and omitted entirely when there are none), then
// the supporters line and the SailScore attribution beneath it. Selection is
// deterministic — the same advert list always yields the same sponsors.
//
// The band is reserved as a bottom margin on every page, so the footer can
// never overlap the results table, whatever the fleet size or page count.
// The attribution is small (6–6.5pt) so the band stays compact.
const MAX_SPONSORS = 3;
export const FOOTER_BAND_HEIGHT = 82; // vertical space reserved at the page foot
const SPONSOR_LOGO_BOX = { w: 88, h: 30 }; // max logo box — aspect is preserved
const SPONSOR_TEXT = [30, 41, 59]; // near-black, readable on any logo

// The sponsors for a PDF: up to `count` active adverts in website priority
// order (`order`, stable for ties). Deterministic for a given input list.
export function pickPdfSponsors(adverts, count = MAX_SPONSORS) {
  if (!Array.isArray(adverts)) return [];
  const active = adverts.filter((a) => a && a.active !== false);
  const ordered = [...active].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return ordered.slice(0, Math.max(0, count));
}

// The advert's print logo: its landscape image (or the legacy single image)
// decoded to the { bytes, format } pair jsPDF can embed. GIF and anything
// unrecognised are skipped — jsPDF embeds PNG/JPEG/WebP only — and the
// sponsor's name/link are still shown without the logo.
function sponsorLogo(a) {
  const src = (a.images && a.images.landscape) || a.image || null;
  if (typeof src !== "string" || !src.startsWith("data:image/")) return null;
  const m = /^data:image\/(png|jpeg|webp);base64,/.exec(src);
  if (!m) return null;
  try {
    const bin = atob(src.slice(src.indexOf(",") + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const format = m[1] === "png" ? "PNG" : m[1] === "jpeg" ? "JPEG" : "WEBP";
    return { bytes, format };
  } catch {
    return null; // undecodable base64 — name/link only
  }
}

// Draw the footer at the foot of the current page: the sponsor band first,
// then the supporters line and the SailScore attribution beneath it. The
// divider line is drawn above the reserved band so the footer reads as a
// footer, never as part of the results table. Sponsor logos are scaled to fit
// the box while preserving their natural aspect ratio (intrinsic size read
// via jsPDF's own decoder), so a logo is never stretched or distorted. The
// attribution is always drawn, even when there are no sponsors, so the
// software/contact reference appears on every export.
function drawPageFooter(doc, sponsors) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const bandTop = pageH - FOOTER_BAND_HEIGHT - 2;

  doc.setDrawColor(...OCEAN);
  doc.setLineWidth(0.6);
  doc.line(margin, bandTop - 5, pageW - margin, bandTop - 5);

  if (sponsors.length) {
    const slotW = (pageW - margin * 2) / sponsors.length;
    sponsors.forEach((a, i) => {
      const centerX = margin + slotW * i + slotW / 2;
      const name = String(a.name || "");
      const link = String(a.link_url || "");

      // Logo (if any), centred above the name, sized proportionally.
      let logoH = 0;
      const logo = sponsorLogo(a);
      if (logo) {
        try {
          const props = doc.getImageProperties(logo.bytes);
          if (props && props.width > 0 && props.height > 0) {
            const scale = Math.min(SPONSOR_LOGO_BOX.w / props.width, SPONSOR_LOGO_BOX.h / props.height);
            const w = props.width * scale;
            const h = props.height * scale;
            logoH = h;
            doc.addImage(logo.bytes, logo.format, centerX - w / 2, bandTop + 2, w, h);
          }
        } catch {
          // Unreadable image data — show the sponsor's name/link only.
        }
      }

      // Name and (optional) link, truncated to one line each so a long
      // sponsor name can never push the band out of the printable area.
      const textTop = bandTop + (logoH ? 38 : 22);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...SPONSOR_TEXT);
      if (name) doc.text(doc.splitTextToSize(name, slotW - 8)[0] || "", centerX, textTop, { align: "center" });
      if (link) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(...MUTED);
        doc.text(doc.splitTextToSize(link, slotW - 8)[0] || "", centerX, textTop + 9, { align: "center" });
      }
    });
  }

  // Attribution beneath the sponsors: the supporters line, then the software
  // identity and contact. Small and unobtrusive, but always present.
  const attrY = bandTop + (sponsors.length ? 60 : 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(doc.splitTextToSize(SITE_SUPPORTERS_LINE, pageW - margin * 2)[0] || "", pageW / 2, attrY, { align: "center" });
  doc.setFontSize(6);
  doc.text(`${SITE_NAME} · ${SITE_ATTRIBUTION}`, pageW / 2, attrY + 8, { align: "center" });
}

function header(doc, { clubName, className, title, year, icon }) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...OCEAN);
  doc.text(`${clubName}`, 40, 40);
  doc.setFontSize(20);
  doc.text(`${className} — ${title}`, 40, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(`${year} season · Scored under the RRS Low Point System`, 40, 74);
  doc.setDrawColor(...OCEAN);
  doc.setLineWidth(1.2);
  doc.line(40, 82, pageW - 40, 82);

  // Home club logo, top-right. jsPDF embeds PNG/JPEG only; anything else
  // (or a missing icon) is skipped without breaking the export.
  if (icon && typeof icon === "string" && icon.startsWith("data:image/")) {
    try {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,/.exec(icon);
      const fmt = m && (m[1] === "image/png" ? "PNG" : m[1] === "image/jpeg" ? "JPEG" : null);
      if (fmt) {
        const size = 38;
        doc.addImage(icon, fmt, pageW - 40 - size, 24, size, size);
      }
    } catch (e) {
      // Unreadable image data — omit the logo rather than fail the export.
    }
  }
}

export function exportSeriesPdf({ clubName, className, seriesName, year, data, icon, adverts }) {
  if (!data || !data.standings?.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  header(doc, { clubName, className, title: `${seriesName} Series`, year, icon });
  const sponsors = pickPdfSponsors(adverts);

  const races = data.races || [];
  const totalCols = Math.max(races.length, data.planned_races || 0, (data.schedule || []).length);
  // A combined mini-series day is one column named after the mini series
  // (race_number is null on those units).
  const cols = Array.from({ length: totalCols }, (_, i) => {
    const r = races[i];
    return r ? (r.mini_name || `R${r.race_number}`) : `R${i + 1}`;
  });

  autoTable(doc, {
    startY: 94,
    // The bottom margin reserves the footer band (sponsors + attribution) so
    // it never overlaps the results, on one page or many.
    margin: { top: 94, right: 40, bottom: FOOTER_BAND_HEIGHT + 40, left: 40 },
    head: [["#", "Boat", "Club", ...cols, "Net", "Total"]],
    // Race columns carry the raw score objects (not formatted strings) so the
    // cell hook below can style them from structured data — discarded DNCs,
    // duty averages etc. highlight identically to numerical discards.
    body: data.standings.map((row) => [
      String(row.rank),
      `${row.boat_name}\n${row.sail_no} · ${row.helm}`,
      row.home_club || "—",
      ...cols.map((_, j) => (row.scores || [])[j] || ""),
      String(row.net),
      String(row.total),
    ]),
    theme: "striped",
    headStyles: { fillColor: OCEAN, fontSize: 8.5, halign: "center" },
    styles: { fontSize: 8.5, cellPadding: 4, valign: "middle" },
    // Fixed widths for rank/boat/club/net/total; the race columns flex to
    // fill the remaining page width (no cellWidth -> autotable distributes).
    columnStyles: {
      0: { cellWidth: 30, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 150 },
      2: { cellWidth: 90 },
      ...Object.fromEntries(cols.map((_, j) => [j + 3, { halign: "center" }])),
      [3 + totalCols]: { cellWidth: 45, halign: "center", fontStyle: "bold" },
      [4 + totalCols]: { cellWidth: 45, halign: "center" },
    },
    didParseCell: (d) => {
      const col = d.column.index;
      const isRaceCol = col >= 3 && col < 3 + totalCols;
      if (!isRaceCol) return;
      const s = d.cell.raw;
      if (!s || typeof s !== "object") return; // header/empty/TBC cells
      d.cell.text = [fmtScore(s)];
      const style = raceCellStyle(s);
      // Discard = grey italics; podium 1st/2nd/3rd = gold/silver/bronze fill;
      // non-finish codes = red text. Discard always beats podium.
      if (style.textColor) d.cell.styles.textColor = style.textColor;
      if (style.fontStyle) d.cell.styles.fontStyle = style.fontStyle;
      if (style.fillColor) d.cell.styles.fillColor = style.fillColor;
    },
    foot: [["", "", "", ...cols.map(() => ""), `${data.race_count} race${data.race_count !== 1 ? "s" : ""} sailed`, `Discards: ${data.discards}`]],
    footStyles: { fillColor: [241, 245, 249], textColor: MUTED, fontSize: 8, halign: "center" },
    // Drawn on every page, inside the reserved band at the page foot.
    didDrawPage: (d) => {
      if (d.doc) drawPageFooter(d.doc, sponsors);
    },
  });

  doc.save(`${className}-${seriesName}-${year}-results.pdf`);
}

export function exportOverallPdf({ clubName, className, year, data, icon, adverts }) {
  if (!data || !data.standings?.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  header(doc, { clubName, className, title: "Overall Championship", year, icon });
  const sponsors = pickPdfSponsors(adverts);

  autoTable(doc, {
    startY: 94,
    margin: { top: 94, right: 40, bottom: FOOTER_BAND_HEIGHT + 40, left: 40 },
    head: [["#", "Boat", "Club", ...data.series_names, "Total"]],
    body: data.standings.map((row) => [
      String(row.rank),
      `${row.boat_name}\n${row.sail_no} · ${row.helm}`,
      row.home_club || "—",
      ...data.series_names.map((s) => (row.per_series?.[s] ?? "—")),
      String(row.net),
    ]),
    theme: "striped",
    headStyles: { fillColor: OCEAN, fontSize: 8.5, halign: "center" },
    styles: { fontSize: 8.5, cellPadding: 4, valign: "middle" },
    columnStyles: {
      0: { cellWidth: 30, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 150 },
      2: { cellWidth: 90 },
      ...Object.fromEntries(data.series_names.map((_, j) => [j + 3, { halign: "center" }])),
      [3 + data.series_names.length]: { cellWidth: 45, halign: "center", fontStyle: "bold" },
    },
    didDrawPage: (d) => {
      if (d.doc) drawPageFooter(d.doc, sponsors);
    },
  });

  doc.save(`${className}-Overall-${year}.pdf`);
}
