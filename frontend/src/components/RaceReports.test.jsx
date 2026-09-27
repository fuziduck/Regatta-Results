globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/lib/api", () => ({
  api: {
    getClassRaceReports: jest.fn(),
    getAdminRaceReports: jest.fn(),
    getSeries: jest.fn(),
    getRaceReport: jest.fn(),
    uploadRaceReport: jest.fn(),
    createRaceReportLink: jest.fn(),
    deleteRaceReport: jest.fn(),
  },
}));
jest.mock("@/hooks/use-delete-with-undo", () => ({
  useDeleteWithUndo: () => ({ askDelete: jest.fn(), isPending: () => false, dialog: null }),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}));

import { api } from "@/lib/api";
import { ClassRaceReports, RaceReportsAdmin } from "./RaceReports";

let container;
let root;

const mount = async (node) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
  return container;
};

const renderArchive = () => mount(<ClassRaceReports classIds={["class-1"]} series={[
  { id: "series-1", class_id: "class-1", name: "Summer Series", year: 2026, club_name: "Medway YC" },
  { id: "series-2", class_id: "class-1", name: "Winter Series", year: 2025, club_name: "Medway YC" },
]} />);

// React tracks input values, so a plain .value assignment is swallowed; go
// through the native setter the way a real keystroke would.
const typeInto = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const selectValue = (select, value) => {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

beforeEach(() => {
  api.getClassRaceReports.mockResolvedValue([
    { id: "report-1", series_id: "series-1", title: "Summer race report", original_filename: "summer.pdf" },
    { id: "report-link", series_id: "series-1", title: "Club website report", link_url: "https://medwayyc.org/reports/summer-2026" },
  ]);
  api.getAdminRaceReports.mockResolvedValue([]);
  api.getSeries.mockResolvedValue([]);
  api.getRaceReport.mockResolvedValue({ id: "report-1", file_data_url: "data:application/pdf;base64,JVBER" });
  api.uploadRaceReport.mockResolvedValue({ id: "report-uploaded" });
  api.createRaceReportLink.mockResolvedValue({ id: "report-linked" });
});

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  jest.clearAllMocks();
});

describe("ClassRaceReports", () => {
  it("lists all series and puts stored documents beside the matching series", async () => {
    await renderArchive();
    expect(api.getClassRaceReports).toHaveBeenCalledWith("class-1");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelector('[data-testid="race-report-series-series-1"]').textContent).toContain("Summer race report");
    expect(container.querySelector('[data-testid="race-report-series-series-2"]').textContent).toContain("No reports published");
    // A stored document is fetched on click, never turned into an anchor.
    const documentButton = container.querySelector('[data-testid="view-race-report-report-1"]');
    expect(documentButton.tagName).toBe("BUTTON");
    expect(api.getRaceReport).not.toHaveBeenCalled();
  });

  it("opens reports held on another website as an outbound link", async () => {
    await renderArchive();
    const link = container.querySelector('[data-testid="view-race-report-report-link"]');
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://medwayyc.org/reports/summer-2026");
    expect(link.getAttribute("target")).toBe("_blank");
    // A new tab keeps a handle on our page, so the opener must be cut.
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("Club website report");
    // The host tells the visitor where they are about to go.
    expect(container.querySelector('[data-testid="race-report-series-series-1"]').textContent).toContain("medwayyc.org");
  });
});

describe("RaceReportsAdmin", () => {
  it("publishes a website link without requiring a file", async () => {
    api.getSeries.mockResolvedValue([
      { id: "series-1", class_id: "class-1", name: "Summer Series", year: 2026 },
    ]);
    await mount(<RaceReportsAdmin clubId="club-1" classes={[{ id: "class-1", name: "Sonata" }]} />);

    // Upload is the default, so the file picker is on screen...
    expect(container.querySelector('[data-testid="race-report-file"]')).not.toBeNull();

    await act(async () => { container.querySelector('[data-testid="race-report-mode-link"]').click(); });
    // ...and switching to a website link replaces it with a URL field.
    expect(container.querySelector('[data-testid="race-report-file"]')).toBeNull();
    const urlInput = container.querySelector('[data-testid="race-report-link-url"]');
    expect(urlInput).not.toBeNull();
    // Nothing can be published until the link has a title and a real address.
    expect(container.querySelector('[data-testid="race-report-link-submit"]').disabled).toBe(true);

    await act(async () => {
      selectValue(container.querySelector('[data-testid="race-report-series-select"]'), "series-1");
      typeInto(container.querySelector('[data-testid="race-report-title"]'), "Summer Series report");
      typeInto(urlInput, "https://medwayyc.org/reports/summer-2026.pdf");
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector('[data-testid="race-report-upload-form"]')
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(api.createRaceReportLink).toHaveBeenCalledWith({
      series_id: "series-1", title: "Summer Series report",
      url: "https://medwayyc.org/reports/summer-2026.pdf",
    });
    expect(api.uploadRaceReport).not.toHaveBeenCalled();
    // The FormData upload endpoint must never be called without a file.
    expect(container.querySelector('[data-testid="race-report-link-url"]').value).toBe("");
  });

  it("refuses a link that is not a web address", async () => {
    api.getSeries.mockResolvedValue([{ id: "series-1", class_id: "class-1", name: "Summer Series", year: 2026 }]);
    await mount(<RaceReportsAdmin clubId="club-1" classes={[{ id: "class-1", name: "Sonata" }]} />);
    await act(async () => { container.querySelector('[data-testid="race-report-mode-link"]').click(); });
    await act(async () => {
      selectValue(container.querySelector('[data-testid="race-report-series-select"]'), "series-1");
      typeInto(container.querySelector('[data-testid="race-report-title"]'), "Nasty link");
      typeInto(container.querySelector('[data-testid="race-report-link-url"]'), "javascript:alert(1)");
      await Promise.resolve();
    });
    // The submit control never unlocks, so no request can escape.
    expect(container.querySelector('[data-testid="race-report-link-submit"]').disabled).toBe(true);
    expect(api.createRaceReportLink).not.toHaveBeenCalled();
  });
});
