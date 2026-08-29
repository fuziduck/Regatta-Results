// Series membership dialog: lists the class's boats, pre-ticking the stored
// member list, and saves the ticked fleet via updateSeriesBoats so the DNC
// scoring engine scores exactly those boats.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/lib/api", () => {
  const api = {
    getBoats: jest.fn(),
    updateSeriesBoats: jest.fn(),
  };
  return { api, formatApiError: (d) => d || "error" };
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock("@/components/ui/dialog", () => {
  const React = require("react");
  const Dialog = ({ open, children }) => (open ? <>{children}</> : null);
  const Pass = ({ children }) => <div>{children}</div>;
  return { Dialog, DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogFooter: Pass };
});

jest.mock("@/components/ui/checkbox", () => {
  const React = require("react");
  return {
    Checkbox: ({ checked, onCheckedChange, ...rest }) => (
      <button type="button" data-testid={rest["data-testid"]} data-checked={!!checked}
        onClick={() => onCheckedChange?.(!checked)}>
        {checked ? "✓" : ""}
      </button>
    ),
  };
});

import SeriesBoatsDialog from "@/components/SeriesBoatsDialog";
import { api } from "@/lib/api";
import { toast } from "sonner";

const series = { id: "s1", name: "Spring", class_id: "c1", year: 2026, version: 2, member_boat_ids: ["b1"] };
const boats = [
  { id: "b1", name: "Alpha", sail_no: "A1", helm: "H1" },
  { id: "b2", name: "Bravo", sail_no: "B2", helm: "H2" },
];

function renderDialog(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(
    <SeriesBoatsDialog series={series} open onOpenChange={() => {}} clubId="club-1" onSaved={() => {}} {...props} />
  ));
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getBoats.mockResolvedValue(boats);
});

it("pre-ticks stored members and saves the ticked fleet", async () => {
  api.updateSeriesBoats.mockResolvedValue({ ...series, member_boat_ids: ["b1", "b2"] });
  const onSaved = jest.fn();
  const onOpenChange = jest.fn();
  const container = renderDialog({ onSaved, onOpenChange });

  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  expect(api.getBoats).toHaveBeenCalledWith({ class_id: "c1", year: 2026, club_id: "club-1" });
  const alpha = container.querySelector('[data-testid="member-boat-A1"]');
  const bravo = container.querySelector('[data-testid="member-boat-B2"]');
  expect(alpha.dataset.checked).toBe("true");
  expect(bravo.dataset.checked).toBe("false");

  // Tick Bravo and save.
  act(() => bravo.click());
  await act(async () => {
    container.querySelector('[data-testid="save-series-boats"]').click();
    await new Promise((r) => setTimeout(r, 10));
  });

  expect(api.updateSeriesBoats).toHaveBeenCalledWith("s1", ["b1", "b2"], 2);
  expect(onSaved).toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("2 boats"));
});

it("saves an empty fleet when every boat is unticked", async () => {
  api.updateSeriesBoats.mockResolvedValue({ ...series, member_boat_ids: [] });
  const container = renderDialog();

  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const alpha = container.querySelector('[data-testid="member-boat-A1"]');
  act(() => alpha.click()); // untick the stored member
  await act(async () => {
    container.querySelector('[data-testid="save-series-boats"]').click();
    await new Promise((r) => setTimeout(r, 10));
  });

  expect(api.updateSeriesBoats).toHaveBeenCalledWith("s1", [], 2);
});

it("surfaces a stale-version conflict without closing", async () => {
  api.updateSeriesBoats.mockRejectedValue({ response: { status: 409 } });
  const onOpenChange = jest.fn();
  const container = renderDialog({ onOpenChange });

  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => {
    container.querySelector('[data-testid="save-series-boats"]').click();
    await new Promise((r) => setTimeout(r, 10));
  });

  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("changed by another user"));
  expect(onOpenChange).not.toHaveBeenCalled();
});
