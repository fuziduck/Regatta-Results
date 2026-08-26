// Race-day split dialog: turns one scheduled race into a mini series. The
// dialog posts race_number/count/name/scoring to the API and hands the result
// (series + group + races) back so the officer lands in the batch scoring view.
import { act } from "react";
import { createRoot } from "react-dom/client";

const mockSplit = jest.fn();
jest.mock("@/lib/api", () => {
  const api = { splitMiniSeries: jest.fn() };
  return { api, formatApiError: (d) => d || "error" };
});
// Avoid pulling the heavy Officer page dependencies (AuthContext, router, the
// whole page render) into this test — only the dialog is imported.
jest.mock("@/components/ui/dialog", () => {
  const React = require("react");
  const Dialog = ({ open, children }) => (open ? <div data-testid="mini-split-dialog">{children}</div> : null);
  const DialogContent = ({ children }) => <div>{children}</div>;
  const DialogHeader = ({ children }) => <div>{children}</div>;
  const DialogTitle = ({ children }) => <div>{children}</div>;
  const DialogFooter = ({ children }) => <div>{children}</div>;
  const DialogTrigger = ({ children }) => <div>{children}</div>;
  return { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger };
});

import { SplitMiniDialog } from "./Officer";

const mockApi = require("@/lib/api").api;

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let container;
let root;

const target = () => ({
  series_id: "s1",
  race_number: 3,
  class_name: "Laser",
  series_name: "Summer",
  start_time: "10:30",
});

afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  jest.clearAllMocks();
});

const renderDialog = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<SplitMiniDialog target={target()} onClose={jest.fn()} onSplit={jest.fn()} />);
  });
  return container;
};

describe("SplitMiniDialog", () => {
  it("sends the split request with combined scoring by default", async () => {
    mockApi.splitMiniSeries.mockResolvedValue({ series: { id: "s1" }, group: {}, group_index: 0, races: [] });
    const onSplit = jest.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<SplitMiniDialog target={target()} onClose={jest.fn()} onSplit={onSplit} />);
    });
    const confirm = container.querySelector('[data-testid="mini-split-confirm"]');
    expect(confirm).not.toBeNull();
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockApi.splitMiniSeries).toHaveBeenCalledWith("s1", {
      race_number: 3,
      count: 2,
      name: "",
      scoring: "combined",
    });
    expect(onSplit).toHaveBeenCalled();
  });

  it("defaults to a combined mini series (fold into one result)", () => {
    renderDialog();
    const scoring = container.querySelector('[data-testid="mini-split-scoring"]');
    expect(scoring.textContent).toContain("Combine into one daily result");
  });
});
