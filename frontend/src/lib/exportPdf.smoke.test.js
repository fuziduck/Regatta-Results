// Smoke test: run the REAL jsPDF + autoTable pipeline (no mocks) and confirm
// the export produces a valid, non-empty PDF without throwing. The cell-level
// styling decisions themselves are covered in resultCellStyle.test.js and
// exportPdf.test.js.
//
// jsdom does not provide TextEncoder/TextDecoder (jsPDF's node build needs
// them), and ESM imports hoist above any code — so these are required
// sequentially instead of imported.
const { TextEncoder, TextDecoder } = require("util");
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const jspdfModule = require("jspdf");
const RealJsPDF = jspdfModule.jsPDF;

let pdfBytes = null;
let lastDoc = null;
// exportSeriesPdf creates its own jsPDF instance; wrap the class so its
// save() captures the rendered document instead of triggering a download.
// jsPDF assigns save as an own instance property, so the override must be
// re-applied in the constructor after super().
class CaptureJsPDF extends RealJsPDF {
  constructor(...args) {
    super(...args);
    this.save = () => {
      pdfBytes = this.output("arraybuffer");
      lastDoc = this;
    };
  }
}
jspdfModule.jsPDF = CaptureJsPDF;

const fastPng = require("fast-png");

// A real tiny PNG (8x4, blue) used as a sponsor logo.
const logoW = 8, logoH = 4;
const logoPx = new Uint8Array(logoW * logoH * 4);
for (let i = 0; i < logoW * logoH; i++) {
  logoPx[i * 4] = 10; logoPx[i * 4 + 1] = 54; logoPx[i * 4 + 2] = 157; logoPx[i * 4 + 3] = 255;
}
const logoBytes = fastPng.encode({ width: logoW, height: logoH, data: logoPx });
const logoDataUrl = "data:image/png;base64," + Buffer.from(logoBytes).toString("base64");

const { exportSeriesPdf, exportAllSeriesPdf } = require("./exportPdf");

afterAll(() => {
  jspdfModule.jsPDF = RealJsPDF;
});

const data = () => ({
  race_count: 4,
  discards: 1,
  planned_races: 4,
  schedule: [],
  races: [{ race_number: 1 }, { race_number: 2 }, { race_number: 3 }, { race_number: 4 }],
  standings: [
    {
      rank: 1,
      boat_name: "Aria",
      sail_no: "GBR704",
      helm: "H",
      home_club: "Medway Yacht Club",
      net: 5,
      total: 9,
      scores: [
        { points: 1, code: "FINISHED", discarded: false }, // gold
        { points: 4, code: "DNC", discarded: true }, // discard (grey)
        { points: 3, code: "FINISHED", discarded: false }, // bronze
        { points: 1, code: "FINISHED", discarded: true }, // discarded 1st -> discard style
      ],
    },
    {
      rank: 2,
      boat_name: "Breeze",
      sail_no: "2",
      helm: "H2",
      home_club: "Medway Yacht Club",
      net: 6,
      total: 8,
      scores: [
        { points: 2, code: "FINISHED", discarded: false }, // silver
        { points: 2.5, code: "OOD", discarded: false },
        { points: 4, code: "DSQ", discarded: false }, // red
        { points: 3.5, code: "MINI", discarded: false },
      ],
    },
  ],
});

test("exportSeriesPdf renders a valid PDF with the real libraries", () => {
  pdfBytes = null;
  expect(() => {
    exportSeriesPdf({
      clubName: "Medway Yacht Club",
      className: "Cruiser",
      seriesName: "Spring",
      year: 2026,
      data: data(),
      icon: null,
      adverts: [
        { name: "Sponsor One", link_url: "https://one.example", order: 0, images: { landscape: logoDataUrl } },
        { name: "Sponsor Two", order: 1, image: logoDataUrl },
        { name: "Sponsor Three", order: 2, images: {} },
      ],
    });
  }).not.toThrow();
  expect(pdfBytes).toBeTruthy();
  const bytes = new Uint8Array(pdfBytes);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  // The page footer is drawn on every page: at least one image XObject (the
  // logo) must be embedded, the sponsor names must be rendered, and the
  // attribution (supporters line + SailScore contact) must be present.
  const txt = Buffer.from(pdfBytes).toString("latin1");
  expect(txt).toContain("/Subtype /Image");
  expect(txt).toContain("Sponsor One");
  expect(txt).toContain("sponsors keep this software free for clubs");
  expect(txt).toContain("SailScore");
  expect(txt).toContain("admin@sailscore.co.uk");
});

// The club crest must sit at the top right of the results export, and the
// per-page hook must keep it there on later pages too (the header is drawn
// once, the logo is not).
test("the club logo is embedded in the results export", () => {
  pdfBytes = null;
  exportSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Cruiser",
    seriesName: "Spring",
    year: 2026,
    data: data(),
    icon: logoDataUrl,
    adverts: [],
  });
  const txt = Buffer.from(pdfBytes).toString("latin1");
  expect(txt).toContain("/Subtype /Image");
  expect(txt).toContain("/XObject");
});

const allSeries = () => ["Spring", "Summer", "Autumn", "Winter"].map((name) => ({
  id: name, name, data: data(),
}));

test("four related series are condensed onto a single page", () => {
  pdfBytes = null;
  exportAllSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Sonata",
    year: 2026,
    series: allSeries(),
    icon: logoDataUrl,
    adverts: [],
  });
  expect(lastDoc.getNumberOfPages()).toBe(1);
  const txt = Buffer.from(pdfBytes).toString("latin1");
  // Every series is named, so all four panels really are on that page.
  ["Spring", "Summer", "Autumn", "Winter"].forEach((name) => expect(txt).toContain(name));
  // The club crest is embedded there too.
  expect(txt).toContain("/Subtype /Image");
});

const fleet = (boats) => ({
  race_count: 4,
  discards: 1,
  planned_races: 4,
  schedule: [],
  races: [{ race_number: 1 }, { race_number: 2 }, { race_number: 3 }, { race_number: 4 }],
  standings: Array.from({ length: boats }, (_, i) => ({
    rank: i + 1, boat_name: `Boat ${i + 1}`, sail_no: `GBR${100 + i}`, helm: "H",
    home_club: "Medway Yacht Club", net: i + 1, total: i + 8,
    scores: [1, 2, 3, 4].map((points) => ({ points, code: "FINISHED", discarded: false })),
  })),
});

const fourSeries = (boats) => ["Spring", "Summer", "Autumn", "Winter"].map((name) => ({
  id: name, name, data: fleet(boats),
}));

const namedSeries = (names, boats) => names.map((name) => ({
  id: name, name, data: fleet(boats),
}));

test("six series of ten boats fit on one page in the roomy layout", () => {
  pdfBytes = null;
  exportAllSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Sonata",
    year: 2026,
    series: namedSeries(["Early Spring", "Spring", "Summer", "Autumn", "Winter", "Spring 2"], 10),
    icon: logoDataUrl,
    adverts: [],
    competitionLabel: "2026 CLUB CHAMPIONSHIP · Championship",
  });
  expect(lastDoc.getNumberOfPages()).toBe(1);
});

test("six series of twelve boats still fit on one page in the dense layout", () => {
  pdfBytes = null;
  exportAllSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Sonata",
    year: 2026,
    series: namedSeries(["Early Spring", "Spring", "Summer", "Autumn", "Winter", "Spring 2"], 12),
    icon: null,
    adverts: [],
    competitionLabel: "2026 CLUB CHAMPIONSHIP · Championship",
  });
  expect(lastDoc.getNumberOfPages()).toBe(1);
});

test("eighteen boats continue onto a second page in the three-row grid", () => {
  pdfBytes = null;
  exportAllSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Sonata",
    year: 2026,
    series: namedSeries(["Early Spring", "Spring", "Summer", "Autumn", "Winter", "Spring 2"], 18),
    icon: null,
    adverts: [],
  });
  expect(lastDoc.getNumberOfPages()).toBe(2);
});

test("four fleets of twelve, with every race column, fit on one page", () => {
  pdfBytes = null;
  exportAllSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Sonata",
    year: 2026,
    series: fourSeries(12),
    icon: logoDataUrl,
    adverts: [],
  });
  expect(lastDoc.getNumberOfPages()).toBe(1);
  const txt = Buffer.from(pdfBytes).toString("latin1");
  ["Spring", "Summer", "Autumn", "Winter"].forEach((name) => expect(txt).toContain(name));
});

test("a long fleet continues onto another page instead of being cut short", () => {
  pdfBytes = null;
  exportAllSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Sonata",
    year: 2026,
    series: fourSeries(40),
    icon: null,
    adverts: [],
  });
  expect(lastDoc.getNumberOfPages()).toBe(2);
});

test("a seventh series continues onto a second page", () => {
  pdfBytes = null;
  exportAllSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Sonata",
    year: 2026,
    series: [
      ...allSeries(),
      { id: "Extra 1", name: "Extra 1", data: data() },
      { id: "Extra 2", name: "Extra 2", data: data() },
      { id: "Extra 3", name: "Extra 3", data: data() },
    ],
    icon: null,
    adverts: [],
  });
  expect(lastDoc.getNumberOfPages()).toBe(2);
});

test("a live results QR is printed without disturbing the document", () => {
  pdfBytes = null;
  exportSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Cruiser",
    seriesName: "Spring",
    year: 2026,
    data: data(),
    icon: logoDataUrl,
    adverts: [],
    url: "https://www.sailscore.co.uk/club/medway-yacht-club?class=abc",
  });
  expect(lastDoc.getNumberOfPages()).toBe(1);
  const txt = Buffer.from(pdfBytes).toString("latin1");
  expect(txt).toContain("Live results");
});

// Regression: with a competition/identity line the header has two meta text
// lines, and the divider rule must move below the last line instead of being
// drawn at its fixed position — which cut straight through the scoring text.
test("two-line header draws no rule through the meta text", () => {
  pdfBytes = null;
  exportSeriesPdf({
    clubName: "Medway Yacht Club",
    className: "Sonata",
    seriesName: "2026 Regatta",
    year: 2026,
    data: data(),
    icon: null,
    adverts: [],
    competitionLabel: "MYC REGATTA · Regatta",
  });
  const txt = Buffer.from(pdfBytes).toString("latin1");
  // Meta baselines: 74 (first line) and 74 + 11.5 (second line). Collect the
  // y of every stroked line on page 1 and assert none falls inside the text
  // band (between the first baseline and just under the second).
  const ruleYs = [...txt.matchAll(/40\. ([\d.]+) m/g)].map((m) => parseFloat(m[1]));
  expect(ruleYs.length).toBeGreaterThan(0);
  const throughText = ruleYs.filter((y) => y > 70 && y < 88);
  expect(throughText).toEqual([]);
  // And the header rule now sits below the second baseline.
  expect(ruleYs.some((y) => y > 85.5 && y < 100)).toBe(true);
});
