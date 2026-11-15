import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { divisionTables, standingsColumns } from "./helpers";
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
const CLUB_LOGO_BOX = { w: 96, h: 50 }; // top-right club crest — aspect is preserved

// The sponsors for a PDF: up to `count` active adverts in website priority
// order (`order`, stable for ties). Deterministic for a given input list.
export function pickPdfSponsors(adverts, count = MAX_SPONSORS) {
  if (!Array.isArray(adverts)) return [];
  const active = adverts.filter((a) => a && a.active !== false);
  const ordered = [...active].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return ordered.slice(0, Math.max(0, count));
}

// An uploaded image (an advert's logo, the club's crest) decoded to the
// { bytes, format } pair jsPDF can embed. GIF and anything unrecognised are
// skipped — jsPDF embeds PNG/JPEG/WebP only — so a bad image never fails an
// export, it is simply left out.
function imageFromDataUrl(src) {
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

// The advert's print logo: its landscape image (or the legacy single image),
// with the sponsor's name/link still shown when it cannot be embedded.
function sponsorLogo(a) {
  return imageFromDataUrl((a.images && a.images.landscape) || a.image || null);
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

// Draw the club's crest at the top right of the CURRENT page, scaled to fit
// its box with the natural aspect ratio preserved. Anything jsPDF cannot
// embed (or an unreadable image) is skipped rather than failing the export.
function drawClubLogo(doc, logo) {
  if (!logo) return;
  const pageW = doc.internal.pageSize.getWidth();
  let w = CLUB_LOGO_BOX.h; // square fallback when the image size is unknown
  let h = CLUB_LOGO_BOX.h;
  try {
    const props = doc.getImageProperties(logo.bytes);
    if (props && props.width > 0 && props.height > 0) {
      const scale = Math.min(CLUB_LOGO_BOX.w / props.width, CLUB_LOGO_BOX.h / props.height);
      w = props.width * scale;
      h = props.height * scale;
    }
  } catch {
    // Unreadable image data — keep the square fallback.
  }
  doc.addImage(logo.bytes, logo.format, pageW - 40 - w, 24, w, h);
}

// Shrink the header line until it fits the space left beside the logo, then
// clip it to one line. A long class/series name can never run underneath the
// crest or off the page.
function fitHeaderText(doc, text, maxWidth, size, minSize = 11) {
  let current = size;
  doc.setFontSize(current);
  while (current > minSize && doc.getTextWidth(text) > maxWidth) {
    current = Math.max(minSize, current - 0.5);
    doc.setFontSize(current);
  }
  return doc.getTextWidth(text) > maxWidth
    ? (doc.splitTextToSize(text, maxWidth)[0] || text)
    : text;
}

// Draws the shared page header and returns the y where body content may
// start. The divider rule sits one leading below the LAST meta line, so a
// two-line header (competition page / boat identity) never has the rule
// struck through its second line, as a fixed position did. The logo's column
// is kept clear for the club crest drawn at the top right of every page.
function header(doc, { clubName, className, title, year, logo, competitionLabel }) {
  const pageW = doc.internal.pageSize.getWidth();
  const maxWidth = pageW - 80 - (logo ? CLUB_LOGO_BOX.w + 14 : 0);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...OCEAN);
  doc.text(fitHeaderText(doc, `${clubName}`, maxWidth, 16), 40, 40);
  doc.text(fitHeaderText(doc, `${className} — ${title}`, maxWidth, 20), 40, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  // Competition hierarchy line (e.g. "2026 MEDWAY YACHT CLUB REGATTA · Regatta")
  // when the export comes from a competition page; the year line follows.
  const metaLines = [competitionLabel, `${year} season · Scored under the RRS Low Point System`].filter(Boolean);
  const metaBaseline = 74;
  const metaLeading = 10 * 1.15; // jsPDF's default line height for 10pt text
  doc.text(metaLines, 40, metaBaseline);
  const ruleY = metaBaseline + (metaLines.length - 1) * metaLeading + 8;
  doc.setDrawColor(...OCEAN);
  doc.setLineWidth(1.2);
  doc.line(40, ruleY, pageW - 40, ruleY);
  return ruleY + 12;
}

// Footer plus the club crest, drawn once per page. Pages are tracked by number
// because a page can carry more than one table (rating divisions, or the
// all-series grid) and every table runs its own didDrawPage hook.
function drawPageChrome(doc, { sponsors, logo, drawnLogoPages, pageNumber }) {
  drawPageFooter(doc, sponsors);
  if (!logo || drawnLogoPages.has(pageNumber)) return;
  drawClubLogo(doc, logo);
  drawnLogoPages.add(pageNumber);
}

export function exportSeriesPdf({ clubName, className, seriesName, year, data, icon, adverts, competitionLabel }) {
  // A class split into rating divisions exports one table per division in the
  // same document, so an IRC boat is never printed against a YTC boat.
  const tables = divisionTables(data).filter((t) => t.standings?.length);
  if (!tables.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const logo = imageFromDataUrl(icon);
  const drawnLogoPages = new Set();
  const contentTop = header(doc, { clubName, className, title: `${seriesName} Series`, year, logo, competitionLabel });
  const sponsors = pickPdfSponsors(adverts);

  // The same columns the on-screen table shows (see standingsColumns), so the
  // printed sheet never disagrees with the page. An abandoned race keeps its
  // own numbered, empty column marked ABD.
  const columns = standingsColumns(data);
  const cols = columns.map((col) => {
    const label = col.mini_name || (col.race_number != null ? `R${col.race_number}` : "");
    return col.abandoned ? `${label} ABD` : label;
  });
  const totalCols = cols.length;

  // Each division is rendered after the previous one: autotable paginates a
  // table on its own, and its finalY carries into the next table's startY.
  tables.forEach((table, i) => {
  const startY = i === 0 ? contentTop : doc.lastAutoTable.finalY + 30;
  if (tables.length > 1) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...OCEAN);
    doc.text(`${table.division_name} ${table.table_kind === "scoring_mode" ? "results" : "division"}`, 40, startY - 12);
  }
  autoTable(doc, {
    startY,
    // The bottom margin reserves the footer band (sponsors + attribution) so
    // it never overlaps the results, on one page or many.
    margin: { top: contentTop, right: 40, bottom: FOOTER_BAND_HEIGHT + 40, left: 40 },
    head: [["#", "Boat", "Club", ...cols, "Total", "Net"]],
    // Race columns carry the raw score objects (not formatted strings) so the
    // cell hook below can style them from structured data — discarded DNCs,
    // duty averages etc. highlight identically to numerical discards.
    body: table.standings.map((row) => [
      String(row.rank),
      `${row.boat_name}\n${row.sail_no} · ${row.helm}`,
      row.home_club || "—",
      ...columns.map((col) => (col.scoreIndex == null ? "" : (row.scores || [])[col.scoreIndex] || "")),
      String(row.total),
      String(row.net),
    ]),
    theme: "striped",
    headStyles: { fillColor: OCEAN, fontSize: 8.5, halign: "center" },
    styles: { fontSize: 8.5, cellPadding: 4, valign: "middle" },
    // Fixed widths for rank/boat/club/total/net; the race columns flex to
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
    foot: [["", "", "", ...cols.map(() => ""), `Discards: ${data.discards}`, `${table.race_count} race${table.race_count !== 1 ? "s" : ""} sailed`]],
    footStyles: { fillColor: [241, 245, 249], textColor: MUTED, fontSize: 8, halign: "center" },
    // Drawn on every page, inside the reserved band at the page foot.
    didDrawPage: (d) => {
      if (d.doc) drawPageChrome(d.doc, { sponsors, logo, drawnLogoPages, pageNumber: d.pageNumber });
    },
  });
  });

  doc.save(`${className}-${seriesName}-${year}-results.pdf`);
}

// The boat profile page as a PDF: identity + per-season summary + the full
// race history across every club/class/season the boat has competed in.
export function exportBoatProfilePdf({ clubName, boat, seasons, history }) {
  if (!boat || (!seasons?.length && !history?.length)) return;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const years = (seasons || []).map((s) => s.year).filter(Boolean);
  const yearSpan = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "";
  const contentTop = header(doc, {
    clubName: clubName || boat.home_club || SITE_NAME,
    className: boat.class_name || "Boat",
    title: `${boat.name} — Boat Profile`,
    year: yearSpan,
    // The header's sub-title line: identity instead of a competition label.
    competitionLabel: `Sail No. ${boat.sail_no || "—"}${boat.helm ? ` · Helm: ${boat.helm}` : ""}${boat.home_club ? ` · Home club: ${boat.home_club}` : ""}`,
  });
  let cursorY = contentTop;

  if (seasons?.length) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: 40, right: 40, bottom: FOOTER_BAND_HEIGHT + 40 },
      head: [["Season", "Club", "Class", "Position", "Races", "Wins", "Podiums", "Avg pos"]],
      body: seasons.map((s) => [
        s.year,
        s.club_name || "—",
        s.class_name || "—",
        s.overall?.rank != null ? `${s.overall.rank}${s.overall.entries ? ` / ${s.overall.entries}` : ""}` : "—",
        s.stats?.races_sailed ?? "—",
        s.stats?.wins ?? "—",
        s.stats?.podiums ?? "—",
        s.stats?.avg_position ?? "—",
      ]),
      theme: "striped",
      headStyles: { fillColor: OCEAN, fontSize: 8.5, halign: "center" },
      styles: { fontSize: 8.5, cellPadding: 4, valign: "middle" },
      columnStyles: {
        0: { cellWidth: 50, halign: "center", fontStyle: "bold" },
        3: { halign: "center" }, 4: { halign: "center" },
        5: { halign: "center" }, 6: { halign: "center" }, 7: { halign: "center" },
      },
      didDrawPage: (d) => { if (d.doc) drawPageFooter(d.doc, []); },
    });
    cursorY = doc.lastAutoTable.finalY + 24;
  }

  autoTable(doc, {
    startY: cursorY,
    margin: { left: 40, right: 40, bottom: FOOTER_BAND_HEIGHT + 40 },
    head: [["Date", "Event / Series", "Race", "Pos", "Points", "Total", "Net"]],
    body: (history || []).map((h) => [
      h.date || "—",
      h.series_name + (h.club_name ? `\n${h.club_name}${h.class_name ? ` · ${h.class_name}` : ""}` : ""),
      `R${h.race_number}`,
      h.position != null ? (h.discarded ? `(${h.position})` : String(h.position)) : (h.code || "—"),
      h.points != null ? (h.discarded ? `(${h.points})` : String(h.points)) : "—",
      h.total ?? "—",
      h.net ?? "—",
    ]),
    theme: "striped",
    headStyles: { fillColor: OCEAN, fontSize: 8.5, halign: "center" },
    styles: { fontSize: 8.5, cellPadding: 3.5, valign: "middle" },
    columnStyles: {
      0: { cellWidth: 62 },
      2: { cellWidth: 40, halign: "center" },
      3: { cellWidth: 40, halign: "center", fontStyle: "bold" },
      4: { cellWidth: 44, halign: "center" },
      5: { cellWidth: 44, halign: "center" },
      6: { cellWidth: 44, halign: "center", fontStyle: "bold", textColor: OCEAN },
    },
    didParseCell: (d) => {
      // Discarded scores render muted and struck-through, like the on-screen table.
      if (d.section !== "body" || d.column.index < 3 || d.column.index > 5) return;
      if (String(d.cell.raw || "").startsWith("(")) {
        d.cell.styles.textColor = MUTED;
        d.cell.styles.fontStyle = "italic";
      }
    },
    didDrawPage: (d) => { if (d.doc) drawPageFooter(d.doc, []); },
  });

  const safe = (v) => String(v || "boat").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  doc.save(`${safe(boat.name)}-${safe(boat.sail_no)}-profile.pdf`);
}

export function exportOverallPdf({ clubName, className, year, data, icon, adverts, competitionLabel }) {
  // A class split into rating divisions has a championship per division: each
  // is printed as its own table, never ranked against the other.
  const tables = divisionTables(data).filter((t) => t.standings?.length);
  if (!tables.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const logo = imageFromDataUrl(icon);
  const drawnLogoPages = new Set();
  const contentTop = header(doc, { clubName, className, title: "Overall Championship", year, logo, competitionLabel });
  const sponsors = pickPdfSponsors(adverts);

  tables.forEach((table, i) => {
  const startY = i === 0 ? contentTop : doc.lastAutoTable.finalY + 30;
  if (tables.length > 1) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...OCEAN);
    doc.text(`${table.division_name} ${table.table_kind === "scoring_mode" ? "results" : "division"}`, 40, startY - 12);
  }
  autoTable(doc, {
    startY,
    margin: { top: contentTop, right: 40, bottom: FOOTER_BAND_HEIGHT + 40, left: 40 },
    head: [["Pos", "Boat", "Club", ...table.series_names, "Total", "Net"]],
    body: table.standings.map((row) => [
      `${row.rank} / ${row.entries ?? table.entries ?? "–"}`,
      `${row.boat_name}\n${row.sail_no} · ${row.helm}`,
      row.home_club || "—",
      ...table.series_names.map((s) => (row.per_series?.[s] ?? "—")),
      String(row.total),
      String(row.net),
    ]),
    theme: "striped",
    headStyles: { fillColor: OCEAN, fontSize: 8.5, halign: "center" },
    styles: { fontSize: 8.5, cellPadding: 4, valign: "middle" },
    columnStyles: {
      0: { cellWidth: 42, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 145 },
      2: { cellWidth: 90 },
      ...Object.fromEntries(table.series_names.map((_, j) => [j + 3, { halign: "center" }])),
      [3 + table.series_names.length]: { cellWidth: 45, halign: "center", fontStyle: "bold" },
      [4 + table.series_names.length]: { cellWidth: 45, halign: "center" },
    },
    didDrawPage: (d) => {
      if (d.doc) drawPageChrome(d.doc, { sponsors, logo, drawnLogoPages, pageNumber: d.pageNumber });
    },
  });
  });

  doc.save(`${className}-Overall-${year}.pdf`);
}

// The compact "all series" export behind an overall championship: every series
// that makes up the overall, condensed to # / Boat / Net panels so up to four
// series fit together on a single landscape page (two columns, two rows).
// Larger seasons continue onto further pages, four panels at a time.
const GRID = {
  columns: 2,
  perPage: 4,
  gapX: 18,
  gapY: 16,
  headingHeight: 16,
  rowHeight: 11.4, // one condensed standings row
  headHeight: 13.5,
};

// The condensed rows for one series panel. Rating divisions keep their own
// labelled group rather than being mixed into one fleet. Rows beyond the space
// available are replaced by a "+N more" line, so a panel can never overflow
// into the next one (or onto a new page).
function compactSeriesBody(data, maxRows) {
  const tables = divisionTables(data).filter((t) => t.standings?.length);
  const rows = [];
  tables.forEach((table) => {
    if (tables.length > 1) {
      rows.push([{
        content: `${table.division_name} ${table.table_kind === "scoring_mode" ? "results" : "division"}`,
        colSpan: 3,
        styles: { fontStyle: "bold", fillColor: [241, 245, 249], textColor: OCEAN },
      }]);
    }
    table.standings.forEach((row) => {
      rows.push([String(row.rank), `${row.boat_name} · ${row.sail_no}`, String(row.net)]);
    });
  });
  if (rows.length <= maxRows) return rows;
  const shown = Math.max(1, maxRows - 1);
  return [
    ...rows.slice(0, shown),
    [{ content: `+${rows.length - shown} more`, colSpan: 3, styles: { fontStyle: "italic", textColor: MUTED } }],
  ];
}

// One series panel: its name, race count and condensed standings table, placed
// at an explicit position on the current page.
function drawSeriesPanel(doc, entry, { x, top, width, maxRows, sponsors, logo, drawnLogoPages, contentTop }) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...OCEAN);
  doc.text(doc.splitTextToSize(String(entry.name || "Series"), width - 70)[0] || "", x, top + 10);
  const races = Number(entry.data?.race_count);
  if (Number.isFinite(races)) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`${races} race${races === 1 ? "" : "s"}`, x + width, top + 10, { align: "right" });
  }
  autoTable(doc, {
    startY: top + GRID.headingHeight,
    tableWidth: width,
    margin: { top: contentTop, right: pageW - x - width, bottom: FOOTER_BAND_HEIGHT + 40, left: x },
    head: [["#", "Boat", "Net"]],
    body: compactSeriesBody(entry.data, maxRows),
    theme: "striped",
    headStyles: { fillColor: OCEAN, fontSize: 7, cellPadding: 1.6, halign: "center" },
    styles: { fontSize: 6.8, cellPadding: 1.6, valign: "middle", overflow: "ellipsize" },
    columnStyles: {
      0: { cellWidth: 20, halign: "center", fontStyle: "bold" },
      1: { cellWidth: width - 54 },
      2: { cellWidth: 34, halign: "center", fontStyle: "bold", textColor: OCEAN },
    },
    didDrawPage: (d) => {
      if (d.doc) drawPageChrome(d.doc, { sponsors, logo, drawnLogoPages, pageNumber: d.pageNumber });
    },
  });
}

export function exportAllSeriesPdf({ clubName, className, year, series, icon, adverts, competitionLabel }) {
  const usable = (series || []).filter((s) => divisionTables(s.data).some((t) => t.standings?.length));
  if (!usable.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const sponsors = pickPdfSponsors(adverts);
  const logo = imageFromDataUrl(icon);
  const drawnLogoPages = new Set();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const gridBottom = pageH - FOOTER_BAND_HEIGHT - 40;
  const panelWidth = (pageW - 80 - GRID.gapX) / GRID.columns;
  let contentTop = 0;
  let rowHeight = 0;
  let maxRows = 0;

  usable.forEach((entry, index) => {
    const slot = index % GRID.perPage;
    if (slot === 0) {
      if (index > 0) doc.addPage();
      contentTop = header(doc, { clubName, className, title: "All Series", year, logo, competitionLabel });
      const onThisPage = Math.min(GRID.perPage, usable.length - index);
      const gridRows = Math.ceil(onThisPage / GRID.columns);
      rowHeight = (gridBottom - contentTop - (gridRows - 1) * GRID.gapY) / gridRows;
      maxRows = Math.max(2, Math.floor((rowHeight - GRID.headingHeight - GRID.headHeight) / GRID.rowHeight));
    }
    const column = slot % GRID.columns;
    const row = Math.floor(slot / GRID.columns);
    drawSeriesPanel(doc, entry, {
      x: 40 + column * (panelWidth + GRID.gapX),
      top: contentTop + row * (rowHeight + GRID.gapY),
      width: panelWidth,
      maxRows,
      sponsors,
      logo,
      drawnLogoPages,
      contentTop,
    });
  });

  doc.save(`${className}-All-Series-${year}.pdf`);
}
