import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/lib/api", () => ({
  api: {
    getClassRaceReports: jest.fn(),
    getRaceReport: jest.fn(),
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
import { ClassRaceReports } from "./RaceReports";

let container;
let root;

const render = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ClassRaceReports classIds={["class-1"]} series={[
      { id: "series-1", class_id: "class-1", name: "Summer Series", year: 2026, club_name: "Medway YC" },
      { id: "series-2", class_id: "class-1", name: "Winter Series", year: 2025, club_name: "Medway YC" },
    ]} />);
    await Promise.resolve();
  });
  return container;
};

beforeEach(() => {
  api.getClassRaceReports.mockResolvedValue([{
    id: "report-1", series_id: "series-1", title: "Summer race report", original_filename: "summer.pdf",
  }]);
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
  it("lists all series and puts uploaded reports beside the matching series", async () => {
    await render();
    expect(api.getClassRaceReports).toHaveBeenCalledWith("class-1");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelector('[data-testid="race-report-series-series-1"]').textContent).toContain("Summer race report");
    expect(container.querySelector('[data-testid="race-report-series-series-2"]').textContent).toContain("No reports uploaded");
  });
});
