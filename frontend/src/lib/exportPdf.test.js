import { exportSeriesPdf, pickPdfSponsors, FOOTER_BAND_HEIGHT } from "./exportPdf";
import { SITE_NAME, SITE_ATTRIBUTION, SITE_SUPPORTERS_LINE } from "./siteConfig";
import autoTable from "jspdf-autotable";
import { jsPDF } from "jspdf";
import { DISCARD_TEXT, PODIUM_FILLS, PENALTY_TEXT } from "./resultCellStyle";

let mockCaptured = null; // the autoTable options object, set by the mock

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
    autoTable.mockImplementation((_doc, opts) => { mockCaptured = opts; });
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
    autoTable.mockImplementation((_doc, opts) => { mockCaptured = opts; });
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
