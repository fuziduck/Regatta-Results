import { exportSeriesPdf, exportAllSeriesPdf, pickPdfSponsors, FOOTER_BAND_HEIGHT } from "./exportPdf";
import { SITE_NAME, SITE_ATTRIBUTION, SITE_SUPPORTERS_LINE } from "./siteConfig";
import qrcode from "qrcode-generator";
import autoTable from "jspdf-autotable";
import { jsPDF } from "jspdf";
import { DISCARD_TEXT, PODIUM_FILLS, PENALTY_TEXT } from "./resultCellStyle";

let mockCaptured = null; // the autoTable options object, set by the mock
let mockCalls = []; // every autoTable options object, in call order

// Module-level fake jsPDF so tests can assert what the export drew. The
// `mock` prefix is required: jest.mock factories may only close over
// variables prefixed with `mock`.
const mockDoc = {
  internal: { pageSize: { getWidth: () => 842, getHeight: () => 595 } },
  save: jest.fn(),
  setFont: jest.fn(),
  setFontSize: jest.fn(),
  setTextColor: jest.fn(),
  setDrawColor: jest.fn(),
  setLineWidth: jest.fn(),
  line: jest.fn(),
  text: jest.fn(),
  addImage: jest.fn(),
  addPage: jest.fn(),
  rect: jest.fn(),
  setFillColor: jest.fn(),
  getTextWidth: jest.fn((t) => String(t).length * 5),
  splitTextToSize: jest.fn((t) => [String(t)]),
  getImageProperties: jest.fn(() => ({ width: 100, height: 50 })),
};

jest.mock("jspdf", () => ({ jsPDF: jest.fn(() => mockDoc) }));
jest.mock("jspdf-autotable", () => jest.fn());

const baseData = () => ({
  race_count: 3,
  discards: 1,
  planned_races: 3,
  schedule: [],
  races: [{ race_number: 1 }, { race_number: 2 }, { race_number: 3 }],
  standings: [{ rank: 1, boat_name: "Boat", sail_no: "1", helm: "H", home_club: "Club", net: 10, total: 10, scores: [] }],
});

const runExport = (extra = {}) => {
  exportSeriesPdf({
    clubName: "Club", className: "Fleet", seriesName: "Spring", year: 2026,
    data: baseData(), icon: null, ...extra,
  });
  expect(mockCaptured).not.toBeNull();
};

// Run the export's didDrawPage hook (the sponsor-footer pass) against the fake
// doc and return the fake doc for assertions.
const drawFooter = () => {
  // Clear the header() drawing calls so assertions only see the footer.
  mockDoc.line.mockClear();
  mockDoc.text.mockClear();
  mockDoc.addImage.mockClear();
  mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 1 });
  return mockDoc;
};

// Run the export's didParseCell hook against one cell (default: the first
// race column) and return what it did to the cell.
const styleFor = (score, colIndex = 3) => {
  const cell = { raw: score, text: [], styles: {} };
  mockCaptured.didParseCell({ column: { index: colIndex }, cell });
  return cell;
};

describe("exportSeriesPdf cell styling", () => {
  beforeEach(() => {
    // react-scripts resets mock implementations before each test, so the
    // autoTable capture and the fake-doc helpers are re-wired here.
    mockCaptured = null;
    mockCalls = [];
    autoTable.mockImplementation((_doc, opts) => { mockCaptured = opts; mockCalls.push(opts); });
    jsPDF.mockImplementation(() => mockDoc);
    mockDoc.splitTextToSize.mockImplementation((t) => [String(t)]);
    mockDoc.getImageProperties.mockImplementation(() => ({ width: 100, height: 50 }));
    runExport();
  });

  it("keeps the discard style for a discarded DNC (non-numerical)", () => {
    const cell = styleFor({ points: 4, code: "DNC", discarded: true });
    expect(cell.text).toEqual(["(4 DNC)"]);
    expect(cell.styles.textColor).toEqual(DISCARD_TEXT);
    expect(cell.styles.fontStyle).toBe("italic");
    expect(cell.styles.fillColor).toBeUndefined();
  });

  it("keeps the discard style for a discarded duty (OOD) score", () => {
    const cell = styleFor({ points: 2.5, code: "OOD", discarded: true });
    expect(cell.text).toEqual(["(2.5 OOD)"]);
    expect(cell.styles.textColor).toEqual(DISCARD_TEXT);
    expect(cell.styles.fontStyle).toBe("italic");
  });

  it("highlights a counting 1st/2nd/3rd with the bold podium fill", () => {
    for (const pts of [1, 2, 3]) {
      const cell = styleFor({ points: pts, code: "FINISHED", discarded: false });
      expect(cell.styles.fillColor).toEqual(PODIUM_FILLS[pts]);
      expect(cell.styles.fontStyle).toBe("bold");
      expect(cell.styles.textColor).toBeDefined();
    }
  });

  it("discard takes priority over the podium fill", () => {
    const cell = styleFor({ points: 1, code: "FINISHED", discarded: true });
    expect(cell.styles.textColor).toEqual(DISCARD_TEXT);
    expect(cell.styles.fontStyle).toBe("italic");
    expect(cell.styles.fillColor).toBeUndefined();
  });

  it("keeps red text for a counting DNC and never fills it", () => {
    const cell = styleFor({ points: 4, code: "DNC", discarded: false });
    expect(cell.text).toEqual(["4 DNC"]);
    expect(cell.styles.textColor).toEqual(PENALTY_TEXT);
    expect(cell.styles.fillColor).toBeUndefined();
  });

  it("renders a combined mini-series day as a plain value without podium styling", () => {
    const cell = styleFor({ points: 3.5, code: "MINI", discarded: false });
    expect(cell.text).toEqual(["3.5"]);
    expect(cell.styles.fillColor).toBeUndefined();
    expect(cell.styles.textColor).toBeUndefined();
  });

  it("leaves non-race columns (rank/total/net) untouched", () => {
    // The fixture has 3 race columns; Total then Net follow them.
    for (const col of [3 + 3, 4 + 3]) {
      const cell = styleFor("10", col);
      expect(cell.text).toEqual([]);
      expect(cell.styles).toEqual({});
    }
  });

  it("leaves empty TBC cells untouched", () => {
    const cell = styleFor("");
    expect(cell.text).toEqual([]);
    expect(cell.styles).toEqual({});
  });
});

describe("pickPdfSponsors", () => {
  it("picks exactly three active sponsors in website order priority", () => {
    const adverts = [
      { name: "A", order: 2, active: true },
      { name: "B", order: 0 },
      { name: "C", order: 1 },
      { name: "D", order: 3 },
    ];
    expect(pickPdfSponsors(adverts).map((a) => a.name)).toEqual(["B", "C", "A"]);
  });

  it("shows all available sponsors when fewer than three are active", () => {
    const adverts = [{ name: "A", order: 0 }, { name: "B", order: 1 }];
    expect(pickPdfSponsors(adverts).map((a) => a.name)).toEqual(["A", "B"]);
  });

  it("ignores inactive adverts", () => {
    const adverts = [
      { name: "A", order: 0, active: false },
      { name: "B", order: 1, active: true },
    ];
    expect(pickPdfSponsors(adverts).map((a) => a.name)).toEqual(["B"]);
  });

  it("is deterministic and tolerant of empty or non-array input", () => {
    expect(pickPdfSponsors([])).toEqual([]);
    expect(pickPdfSponsors(null)).toEqual([]);
    expect(pickPdfSponsors(undefined)).toEqual([]);
    const list = [
      { name: "A", order: 2 }, { name: "B", order: 0 }, { name: "C", order: 1 },
    ];
    const shuffled = [list[2], list[0], list[1]];
    expect(pickPdfSponsors(shuffled).map((a) => a.name)).toEqual(["B", "C", "A"]);
  });
});

describe("sponsor footer", () => {
  beforeEach(() => {
    mockCaptured = null;
    mockCalls = [];
    autoTable.mockImplementation((_doc, opts) => { mockCaptured = opts; mockCalls.push(opts); });
    jsPDF.mockImplementation(() => mockDoc);
    mockDoc.splitTextToSize.mockImplementation((t) => [String(t)]);
    mockDoc.getImageProperties.mockImplementation(() => ({ width: 100, height: 50 }));
  });

  it("reserves the bottom band and draws a footer with logos for sponsors that have one", () => {
    const adverts = [
      { name: "Alpha Marine", link_url: "https://alpha.example", order: 0, images: { landscape: "data:image/png;base64,QUFB" } },
      { name: "Beta Yachts", order: 1, image: "data:image/jpeg;base64,QkJC" },
      { name: "Gamma Sails", order: 2, images: {} },
    ];
    runExport({ adverts });
    expect(mockCaptured.margin.bottom).toBe(FOOTER_BAND_HEIGHT + 40);
    const doc = drawFooter();
    expect(doc.line).toHaveBeenCalled(); // the divider
    // Alpha (landscape image) + Beta (legacy image) embed logos; Gamma has none.
    expect(doc.addImage).toHaveBeenCalledTimes(2);
    expect(doc.text).toHaveBeenCalled(); // sponsor names (and Beta's link)
  });

  it("draws only the attribution when there are no sponsors", () => {
    runExport({ adverts: [] });
    const doc = drawFooter();
    expect(doc.line).toHaveBeenCalled(); // divider
    expect(doc.addImage).not.toHaveBeenCalled();
    const texts = doc.text.mock.calls.map((c) => String(c[0]));
    expect(texts.join("\n")).toContain(SITE_SUPPORTERS_LINE);
    expect(texts.join("\n")).toContain(`${SITE_NAME} · ${SITE_ATTRIBUTION}`);
  });

  it("draws the supporters line and attribution beneath the sponsors", () => {
    const adverts = [{ name: "Only Co", order: 0 }];
    runExport({ adverts });
    const doc = drawFooter();
    const texts = doc.text.mock.calls.map((c) => String(c[0]));
    const all = texts.join("\n");
    expect(all).toContain("Only Co");
    expect(all).toContain(SITE_SUPPORTERS_LINE);
    expect(all).toContain(`${SITE_NAME} · ${SITE_ATTRIBUTION}`);
  });

  it("skips unsupported logo formats (GIF) but still shows the sponsor name", () => {
    const adverts = [{ name: "Gif Co", order: 0, images: { landscape: "data:image/gif;base64,QUFB" } }];
    runExport({ adverts });
    const doc = drawFooter();
    expect(doc.addImage).not.toHaveBeenCalled();
    expect(doc.text).toHaveBeenCalled();
  });

  it("falls back to name/link only when the logo cannot be decoded", () => {
    const adverts = [{ name: "Bad Co", order: 0, images: { landscape: "data:image/png;base64,QUFB" } }];
    mockDoc.getImageProperties.mockImplementation(() => { throw new Error("bad image"); });
    runExport({ adverts });
    const doc = drawFooter();
    expect(doc.addImage).not.toHaveBeenCalled();
    expect(doc.text).toHaveBeenCalled();
  });
});

describe("club logo", () => {
  beforeEach(() => {
    mockCaptured = null;
    mockCalls = [];
    autoTable.mockImplementation((_doc, opts) => { mockCaptured = opts; mockCalls.push(opts); });
    jsPDF.mockImplementation(() => mockDoc);
    mockDoc.splitTextToSize.mockImplementation((t) => [String(t)]);
    mockDoc.getImageProperties.mockImplementation(() => ({ width: 100, height: 50 }));
    mockDoc.addImage.mockClear();
  });

  it("draws the club crest once on every page, top right", () => {
    runExport({ icon: "data:image/png;base64,QUFB" });
    mockDoc.addImage.mockClear();

    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 1 });
    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 1 }); // second table on page 1
    expect(mockDoc.addImage).toHaveBeenCalledTimes(1);
    expect(mockDoc.addImage.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(mockDoc.addImage.mock.calls[0][1]).toBe("PNG");
    // Right-aligned inside the 40pt margin (100x50 image -> 96x48 box).
    expect(mockDoc.addImage.mock.calls[0][2]).toBe(842 - 40 - 96);
    expect(mockDoc.addImage.mock.calls[0][3]).toBe(24);

    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 2 });
    expect(mockDoc.addImage).toHaveBeenCalledTimes(2);
  });

  it("moves the crest left to leave room for the live-results QR", () => {
    runExport({ icon: "data:image/png;base64,QUFB", url: "https://www.sailscore.co.uk/club/harbour-club" });
    mockDoc.addImage.mockClear();
    mockDoc.rect.mockClear();
    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 1 });

    const [, , x, y, w] = mockDoc.addImage.mock.calls[0];
    expect(y).toBe(24);
    expect(x + w).toBeLessThanOrEqual(842 - 40 - 56 - 12);
    expect(mockDoc.rect).toHaveBeenCalled();
  });

  it("skips the crest when the club has no icon and never fails on a bad one", () => {
    runExport({ icon: null });
    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 1 });
    expect(mockDoc.addImage).not.toHaveBeenCalled();

    mockDoc.addImage.mockClear();
    runExport({ icon: "data:image/gif;base64,QUFB" });
    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 1 });
    expect(mockDoc.addImage).not.toHaveBeenCalled();
  });
});

describe("live results QR", () => {
  const url = "https://www.sailscore.co.uk/club/harbour-club?class=dragon";

  beforeEach(() => {
    mockCaptured = null;
    mockCalls = [];
    autoTable.mockImplementation((_doc, opts) => { mockCaptured = opts; mockCalls.push(opts); });
    jsPDF.mockImplementation(() => mockDoc);
    mockDoc.splitTextToSize.mockImplementation((t) => [String(t)]);
    mockDoc.getImageProperties.mockImplementation(() => ({ width: 100, height: 50 }));
    mockDoc.rect.mockClear();
    mockDoc.setFillColor.mockClear();
  });

  // The number of dark horizontal runs in the same QR the export encodes; the
  // export draws one filled rectangle per run.
  const expectedRuns = (value) => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let runs = 0;
    for (let row = 0; row < count; row += 1) {
      let inRun = false;
      for (let col = 0; col < count; col += 1) {
        if (code.isDark(row, col) && !inRun) { runs += 1; inRun = true; }
        if (!code.isDark(row, col)) inRun = false;
      }
    }
    return runs;
  };

  it("draws the live page QR once per page inside the top-right box", () => {
    runExport({ url });
    mockDoc.rect.mockClear();
    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 1 });
    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 1 }); // second table, same page

    const calls = mockDoc.rect.mock.calls;
    expect(calls.length).toBe(expectedRuns(url));
    calls.forEach(([x, y, w, h, style]) => {
      expect(style).toBe("F");
      expect(x).toBeGreaterThanOrEqual(842 - 40 - 56);
      expect(x + w).toBeLessThanOrEqual(842 - 40);
      expect(y).toBeGreaterThanOrEqual(24);
      expect(y + h).toBeLessThanOrEqual(24 + 56);
    });
    expect(mockDoc.text.mock.calls.some(([t]) => t === "Live results")).toBe(true);

    // Every page carries the code — a printed page is never a dead end.
    mockDoc.rect.mockClear();
    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 2 });
    expect(mockDoc.rect).toHaveBeenCalledTimes(expectedRuns(url));
  });

  it("draws no QR when no live URL is supplied", () => {
    runExport({ url: null });
    mockCaptured.didDrawPage({ doc: mockDoc, pageNumber: 1 });
    expect(mockDoc.rect).not.toHaveBeenCalled();
    expect(mockDoc.text.mock.calls.some(([t]) => t === "Live results")).toBe(false);
  });
});

describe("exportAllSeriesPdf", () => {
  const seriesEntry = (name, boats = 2) => ({
    id: name,
    name,
    data: {
      race_count: 3,
      discards: 1,
      races: [{ race_number: 1 }, { race_number: 2 }, { race_number: 3 }],
      standings: Array.from({ length: boats }, (_, i) => ({
        rank: i + 1, boat_name: `Boat ${i + 1}`, sail_no: String(i + 1), net: i + 1, total: i + 3,
        scores: [
          { points: 1, code: "FINISHED", discarded: false },
          { points: 2, code: "FINISHED", discarded: false },
          { points: 3, code: "FINISHED", discarded: false },
        ],
      })),
    },
  });

  const runAll = (series, extra = {}) => exportAllSeriesPdf({
    clubName: "Club", className: "Fleet", year: 2026, series, icon: null, adverts: [], ...extra,
  });

  beforeEach(() => {
    mockCaptured = null;
    mockCalls = [];
    autoTable.mockImplementation((_doc, opts) => { mockCaptured = opts; mockCalls.push(opts); });
    jsPDF.mockImplementation(() => mockDoc);
    mockDoc.splitTextToSize.mockImplementation((t) => [String(t)]);
    mockDoc.getImageProperties.mockImplementation(() => ({ width: 100, height: 50 }));
    mockDoc.addPage.mockClear();
    mockDoc.save.mockClear();
  });

  it("condenses four series, with every race column, onto one page", () => {
    runAll(["Spring", "Summer", "Autumn", "Winter"].map((n) => seriesEntry(n)));

    expect(mockDoc.addPage).not.toHaveBeenCalled();
    expect(autoTable).toHaveBeenCalledTimes(4);
    // A two-by-two grid: two left edges and two starting rows.
    expect(new Set(mockCalls.map((c) => c.margin.left)).size).toBe(2);
    expect(new Set(mockCalls.map((c) => c.startY)).size).toBe(2);
    // Each table carries the series' races, not just the net score.
    expect(mockCalls[0].head[0]).toEqual(["#", "Boat", "R1", "R2", "R3", "Total", "Net"]);
    expect(mockCalls[0].body[0]).toHaveLength(7);
    expect(mockDoc.save).toHaveBeenCalledWith("Fleet-All-Series-2026.pdf");
  });

  it("styles race cells and shows points for each race", () => {
    runAll([seriesEntry("Spring")]);

    const opts = mockCalls[0];
    const cell = { raw: { points: 2, code: "FINISHED", discarded: false }, text: [], styles: {} };
    opts.didParseCell({ column: { index: 3 }, cell });
    expect(cell.text).toEqual(["2"]);
    expect(cell.styles.fillColor).toBeDefined(); // podium silver
    // Total and Net are not race cells.
    const total = { raw: "3", text: [], styles: {} };
    opts.didParseCell({ column: { index: 5 }, cell: total });
    expect(total.text).toEqual([]);
  });

  it("fits six series onto one page in three columns", () => {
    runAll(["Spring", "Summer", "Autumn", "Winter", "Spring 2", "Autumn 2"].map((n) => seriesEntry(n)));

    expect(mockDoc.addPage).not.toHaveBeenCalled();
    expect(autoTable).toHaveBeenCalledTimes(6);
    expect(new Set(mockCalls.map((c) => c.margin.left)).size).toBe(3);
    expect(new Set(mockCalls.map((c) => c.startY)).size).toBe(2);
    expect(mockCalls[5].head[0]).toEqual(["#", "Boat", "R1", "R2", "R3", "Total", "Net"]);
  });

  it("fits five series onto one page, three across and two down", () => {
    runAll(["A", "B", "C", "D", "E"].map((n) => seriesEntry(n)));

    expect(mockDoc.addPage).not.toHaveBeenCalled();
    expect(autoTable).toHaveBeenCalledTimes(5);
    expect(new Set(mockCalls.map((c) => c.margin.left)).size).toBe(3);
    expect(new Set(mockCalls.map((c) => c.startY)).size).toBe(2);
  });

  it("uses the roomy profile for ten boats or fewer", () => {
    runAll(["A", "B", "C", "D", "E", "F"].map((n) => seriesEntry(n, 10)));

    expect(mockDoc.addPage).not.toHaveBeenCalled();
    expect(autoTable).toHaveBeenCalledTimes(6);
    expect(mockCalls[0].styles.fontSize).toBe(6.2);
    expect(mockCalls[0].body).toHaveLength(10);
  });

  it("switches to the dense profile for eleven or more boats", () => {
    runAll(["A", "B", "C", "D", "E", "F"].map((n) => seriesEntry(n, 11)));

    expect(mockDoc.addPage).not.toHaveBeenCalled();
    expect(autoTable).toHaveBeenCalledTimes(6);
    expect(mockCalls[0].styles.fontSize).toBe(5.4);
    expect(mockCalls[0].body).toHaveLength(11);
  });

  it("continues a fleet larger than one dense panel", () => {
    runAll(["A", "B", "C", "D", "E", "F"].map((n) => seriesEntry(n, 20)));

    // 19 rows fit a dense panel, so 20 boats continue on a second page.
    expect(mockDoc.addPage).toHaveBeenCalledTimes(1);
    expect(autoTable).toHaveBeenCalledTimes(12);
    expect(mockCalls[6].body[0][1]).toBe("Boat 20");
  });

  it("prints every boat, continuing a long fleet on later pages", () => {
    runAll([seriesEntry("Spring", 80), seriesEntry("Autumn", 80)]);

    // 42 rows fit a dense page, so 80 boats take two pages — none are dropped.
    expect(mockDoc.addPage).toHaveBeenCalledTimes(1);
    expect(autoTable).toHaveBeenCalledTimes(4);
    const printed = mockCalls.flatMap((c) => c.body);
    expect(printed.length).toBe(160);
    // Each continuation page carries the next slice of the same table.
    expect(mockCalls[2].body[0][1]).toBe("Boat 43");
  });

  it("carries the live results QR on the grid pages", () => {
    runAll([seriesEntry("Spring")], { url: "https://www.sailscore.co.uk/club/harbour-club" });
    mockDoc.rect.mockClear();
    mockCalls[0].didDrawPage({ doc: mockDoc, pageNumber: 1 });
    expect(mockDoc.rect).toHaveBeenCalled();
    expect(mockDoc.text.mock.calls.some(([t]) => t === "Live results")).toBe(true);
  });

  it("ignores series with no standings and does nothing when none remain", () => {
    runAll([{ id: "empty", name: "Empty", data: { standings: [] } }]);
    expect(autoTable).not.toHaveBeenCalled();
    expect(mockDoc.save).not.toHaveBeenCalled();
  });
});
