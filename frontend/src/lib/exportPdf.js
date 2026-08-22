import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Shared PDF styling for SailScore result exports.
const OCEAN = [10, 54, 157]; // brand ocean blue
const MUTED = [100, 116, 139];

const fmtScore = (s) => {
  if (!s) return "";
  const val = Number.isInteger(s.points) ? String(s.points) : s.points.toFixed(1);
  const label = s.code && s.code !== "FINISHED" ? `${val} ${s.code}` : val;
  return s.discarded ? `(${label})` : label;
};

function header(doc, { clubName, className, title, year }) {
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
  doc.line(40, 82, doc.internal.pageSize.getWidth() - 40, 82);
}

export function exportSeriesPdf({ clubName, className, seriesName, year, data }) {
  if (!data || !data.standings?.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  header(doc, { clubName, className, title: `${seriesName} Series`, year });

  const races = data.races || [];
  const totalCols = Math.max(races.length, data.planned_races || 0, (data.schedule || []).length);
  const cols = Array.from({ length: totalCols }, (_, i) => races[i]?.race_number ?? i + 1);

  autoTable(doc, {
    startY: 94,
    margin: { top: 94, right: 40, bottom: 40, left: 40 },
    head: [["#", "Boat", "Club", ...cols.map((n) => `R${n}`), "Net", "Total"]],
    body: data.standings.map((row) => [
      String(row.rank),
      `${row.boat_name}\n${row.sail_no} · ${row.helm}`,
      row.home_club || "—",
      ...cols.map((_, j) => fmtScore((row.scores || [])[j])),
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
      // Discarded scores shown in grey italics; penalty codes in red.
      const txt = String(d.cell.raw || "");
      if (txt.startsWith("(")) {
        d.cell.styles.textColor = [148, 163, 184];
        d.cell.styles.fontStyle = "italic";
      } else if (/\b(DNC|DNF|RET|DSQ|UFD|OCS|ZFP|BFD|DGM)\b/.test(txt)) {
        d.cell.styles.textColor = [220, 38, 38];
      }
    },
    foot: [["", "", "", ...cols.map(() => ""), `${data.race_count} race${data.race_count !== 1 ? "s" : ""} sailed`, `Discards: ${data.discards}`]],
    footStyles: { fillColor: [241, 245, 249], textColor: MUTED, fontSize: 8, halign: "center" },
  });

  doc.save(`${className}-${seriesName}-${year}-results.pdf`);
}

export function exportOverallPdf({ clubName, className, year, data }) {
  if (!data || !data.standings?.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  header(doc, { clubName, className, title: "Overall Championship", year });

  autoTable(doc, {
    startY: 94,
    margin: { top: 94, right: 40, bottom: 40, left: 40 },
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
  });

  doc.save(`${className}-Overall-${year}.pdf`);
}
