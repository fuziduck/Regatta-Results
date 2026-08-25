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
// exportSeriesPdf creates its own jsPDF instance; wrap the class so its
// save() captures the rendered document instead of triggering a download.
// jsPDF assigns save as an own instance property, so the override must be
// re-applied in the constructor after super().
class CaptureJsPDF extends RealJsPDF {
  constructor(...args) {
    super(...args);
    this.save = () => {
      pdfBytes = this.output("arraybuffer");
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

const { exportSeriesPdf } = require("./exportPdf");

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
