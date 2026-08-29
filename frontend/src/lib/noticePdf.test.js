import { buildNoticePdf, noticePdfDataUrl, noticeHeadingLine, noticeContextLine } from "./noticePdf";
import { jsPDF } from "jspdf";
import { SITE_NAME, SITE_ATTRIBUTION, SITE_SUPPORTERS_LINE } from "./siteConfig";
import { FOOTER_BAND_HEIGHT } from "./exportPdf";

const mockDoc = {
  internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 } },
  setFont: jest.fn(),
  setFontSize: jest.fn(),
  setTextColor: jest.fn(),
  setDrawColor: jest.fn(),
  setLineWidth: jest.fn(),
  line: jest.fn(),
  text: jest.fn(),
  splitTextToSize: jest.fn((t) => [String(t)]),
  addImage: jest.fn(),
  addPage: jest.fn(),
  getImageProperties: jest.fn(() => ({ width: 100, height: 50 })),
};

jest.mock("jspdf", () => ({ jsPDF: jest.fn(() => mockDoc) }));
jest.mock("jspdf-autotable", () => jest.fn());

const notice = {
  id: "notice-abc",
  version: 3,
  notice_type_label: "Notice to Competitors",
  notice_number: 4,
  title: "Change of race area",
  event_name: "Summer Series",
  race_number: 8,
  class_name: "Cruiser Class 1",
  published_at: "2026-08-28T15:42:00+00:00",
  effective_at: "2026-08-29T09:00:00+00:00",
  body: [
    { label: "Subject", value: "Change of race area" },
    { label: "Reason", value: "The wind shifted 40 degrees." },
    { label: "Race Officer / Race Committee", value: "J Smith, Race Officer" },
  ],
};

function lastArg(fn) {
  return fn.mock.calls[fn.mock.calls.length - 1];
}

beforeEach(() => {
  jsPDF.mockImplementation(() => mockDoc);
  mockDoc.splitTextToSize.mockImplementation((t) => [String(t)]);
  mockDoc.text.mockClear();
  mockDoc.output = jest.fn(() => "data:application/pdf;filename=notice.pdf;base64,JVBERi0xLjQ=");
});

describe("notice helpers", () => {
  test("heading line includes type + number", () => {
    expect(noticeHeadingLine(notice)).toBe("NOTICE TO COMPETITORS No. 4");
    expect(noticeHeadingLine({ notice_type_label: "Safety Notice" })).toBe("SAFETY NOTICE");
  });

  test("context line joins event, race and class", () => {
    expect(noticeContextLine(notice)).toBe("Summer Series · Race 8 · Cruiser Class 1");
  });
});

describe("buildNoticePdf", () => {
  test("renders club, ONB banner, heading, title and context", () => {
    buildNoticePdf({ notice, clubName: "Medway Yacht Club", adverts: [] });
    const texts = mockDoc.text.mock.calls.map((c) => c[0]);
    expect(mockDoc.text).toHaveBeenCalledWith("Medway Yacht Club", 40, 40);
    expect(texts).toContain("OFFICIAL NOTICE BOARD");
    expect(texts).toContain("NOTICE TO COMPETITORS No. 4");
    expect(texts.flat(Infinity)).toContain("Change of race area"); // title
    expect(texts.flat(Infinity)).toContain("Summer Series · Race 8 · Cruiser Class 1");
  });

  test("renders every structured body row label and value", () => {
    buildNoticePdf({ notice, adverts: [] });
    const texts = mockDoc.text.mock.calls.flatMap((c) => c[0]);
    expect(texts).toContain("SUBJECT");
    expect(texts).toContain("Change of race area");
    expect(texts).toContain("REASON");
    expect(texts).toContain("The wind shifted 40 degrees.");
  });

  test("renders the race officer name once and directly after its heading", () => {
    buildNoticePdf({ notice, adverts: [] });
    const texts = mockDoc.text.mock.calls.map((c) => c[0]);
    const flat = texts.flat(Infinity).map((t) => String(t));
    const labelMatches = flat.filter((t) => t.includes("RACE OFFICER / RACE COMMITTEE")
      || t.includes("Race Officer / Race Committee"));
    expect(labelMatches.length).toBe(1);
    const nameMatches = flat.filter((t) => t === "J Smith, Race Officer");
    expect(nameMatches.length).toBe(1);
    const labelIdx = flat.findIndex((t) => t.includes("RACE OFFICER / RACE COMMITTEE")
      || t.includes("Race Officer / Race Committee"));
    const valueIdx = flat.indexOf("J Smith, Race Officer");
    expect(valueIdx).toBeGreaterThan(labelIdx);
  });

  test("writes the Sailscore document identifier + version into the footer", () => {
    buildNoticePdf({ notice, adverts: [] });
    const texts = mockDoc.text.mock.calls.map((c) => c[0]);
    // Document identity is drawn twice (per-page footer): send the identifier.
    const ident = `${notice.id} · version ${notice.version}`;
    expect(texts.some((t) => String(t).includes(SITE_ATTRIBUTION))).toBe(true);
    expect(texts.find((t) => String(t).includes(notice.id) && String(t).includes("version 3"))).toBeTruthy();
  });
});

describe("noticePdfDataUrl", () => {
  test("returns a strict base64 PDF data URL", () => {
    mockDoc.output = jest.fn(() => "data:application/pdf;filename=notice.pdf;base64,JVBERi0xLjQ=");
    const url = noticePdfDataUrl({ notice, adverts: [] });
    expect(url.startsWith("data:application/pdf;base64,")).toBe(true);
    // Trailing filename segment and any extra params are stripped.
    expect(url).toBe("data:application/pdf;base64,JVBERi0xLjQ=");
  });

  test("returns null with no notice", () => {
    expect(noticePdfDataUrl({ notice: null, adverts: [] })).toBeNull();
  });
});