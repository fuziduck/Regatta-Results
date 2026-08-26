// New-race dialog: the officer can add a race on the day and, with the
// "Mini series day" mode, create the slot race AND split it into a mini
// series in one action — landing in the batch scoring view.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/lib/api", () => {
  const api = {
    getClasses: jest.fn(),
    getSeries: jest.fn(),
    createRace: jest.fn(),
    splitMiniSeries: jest.fn(),
    deleteRace: jest.fn(),
  };
  return { api, formatApiError: (d) => d || "error" };
});

// Minimal stateful UI mocks so the dialog can be opened, options selected and
// submitted without pulling in the full Radix implementations.
jest.mock("@/components/ui/dialog", () => {
  const React = require("react");
  // Radix keeps the trigger in the tree while the content only mounts when
  // open — mirror that so the test can click the trigger to open the dialog.
  let openRef = false;
  let onOpenChangeRef = null;
  const Dialog = ({ open, onOpenChange, children }) => {
    openRef = open;
    onOpenChangeRef = onOpenChange;
    return <>{children}</>;
  };
  const DialogTrigger = ({ children }) =>
    React.cloneElement(React.Children.only(children), {
      onClick: (e) => {
        if (onOpenChangeRef) onOpenChangeRef(true);
        children.props.onClick?.(e);
      },
    });
  const DialogContent = ({ children }) => (openRef ? <div data-testid="new-race-dialog">{children}</div> : null);
  const Pass = ({ children }) => <div>{children}</div>;
  return { Dialog, DialogTrigger, DialogContent, DialogHeader: Pass, DialogTitle: Pass, DialogFooter: Pass };
});

jest.mock("@/components/ui/select", () => {
  const React = require("react");
  const Ctx = React.createContext(null);
  const Select = ({ value, onValueChange, children }) => (
    <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
  );
  const SelectItem = ({ value, children }) => {
    const ctx = React.useContext(Ctx);
    return (
      <button type="button" data-testid={`select-item-${value}`} onClick={() => ctx?.onValueChange?.(value)}>
        {children}
      </button>
    );
  };
  const Pass = ({ children }) => <>{children}</>;
  return { Select, SelectItem, SelectTrigger: Pass, SelectContent: Pass, SelectValue: () => null };
});

jest.mock("@/components/ui/switch", () => {
  const React = require("react");
  return {
    Switch: ({ checked, onCheckedChange, ...rest }) => (
      <button type="button" {...rest} onClick={() => onCheckedChange?.(!checked)} />
    ),
  };
});

import { NewRaceDialog } from "./Officer";
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

beforeEach(() => {
  // CRA's jest config sets resetMocks: true, which strips factory-set
  // implementations — reapply them per test instead.
  mockApi.getClasses.mockResolvedValue([{ id: "c1", name: "Sonata" }]);
  mockApi.getSeries.mockResolvedValue([{ id: "s1", name: "Summer" }]);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  jest.clearAllMocks();
});

const renderDialog = (props = {}) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <NewRaceDialog clubId="medway" onCreated={props.onCreated || jest.fn()} onSplitDone={props.onSplitDone || jest.fn()} />
    );
  });
  return container;
};

const openAndSelectSeries = async () => {
  const btn = container.querySelector('[data-testid="new-race-btn"]');
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  act(() => {
    container.querySelector('[data-testid="select-item-c1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  act(() => {
    container.querySelector('[data-testid="select-item-s1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("NewRaceDialog", () => {
  it("creates a plain race when the mini-series switch is off", async () => {
    mockApi.createRace.mockResolvedValue({ id: "r1", series_id: "s1", race_number: 1 });
    const onCreated = jest.fn();
    renderDialog({ onCreated });
    await openAndSelectSeries();
    await act(async () => {
      container.querySelector('[data-testid="create-race-confirm"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockApi.createRace).toHaveBeenCalledWith(
      expect.objectContaining({ class_id: "c1", series_id: "s1", race_number: 1 })
    );
    expect(mockApi.splitMiniSeries).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
  });

  it("creates the race then turns the day into a mini series when mini series day is chosen", async () => {
    mockApi.createRace.mockResolvedValue({ id: "r1", series_id: "s1", race_number: 1 });
    mockApi.splitMiniSeries.mockResolvedValue({
      series: { id: "s1" },
      group: { name: "Light winds day", race_numbers: [1, 2], scoring: "combined" },
      group_index: 0,
      races: [],
    });
    const onSplitDone = jest.fn();
    renderDialog({ onSplitDone });
    await openAndSelectSeries();
    // Pick mini series day: default combined, 2 races.
    act(() => {
      container.querySelector('[data-testid="new-race-mode-mini"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector('[data-testid="create-race-confirm"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockApi.createRace).toHaveBeenCalledWith(
      expect.objectContaining({ class_id: "c1", series_id: "s1", race_number: 1 })
    );
    expect(mockApi.splitMiniSeries).toHaveBeenCalledWith("s1", {
      race_number: 1,
      count: 2,
      name: "",
      scoring: "combined",
    });
    expect(onSplitDone).toHaveBeenCalledWith(expect.objectContaining({ series: { id: "s1" } }));
  });

  it("mini series day hides the per-race fields and the count stepper clamps to 2–20", async () => {
    renderDialog();
    await openAndSelectSeries();
    act(() => {
      container.querySelector('[data-testid="new-race-mode-mini"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The per-race fields are gone — only the mini panel remains.
    expect(container.querySelector('[data-testid="new-race-date"]')).toBeNull();
    expect(container.querySelector('[data-testid="new-race-number"]')).toBeNull();
    expect(container.querySelector('[data-testid="new-race-time"]')).toBeNull();
    expect(container.querySelector('[data-testid="new-race-mini-count"]').textContent).toBe("2");
    act(() => {
      container.querySelector('[data-testid="new-race-mini-minus"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="new-race-mini-count"]').textContent).toBe("2"); // clamped
    act(() => {
      container.querySelector('[data-testid="new-race-mini-plus"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="new-race-mini-count"]').textContent).toBe("3");
  });

  it("surfaces the backend error when the split is rejected, keeps the dialog open and removes the stray race", async () => {
    mockApi.createRace.mockResolvedValue({ id: "r1", series_id: "s1", race_number: 5, version: 1 });
    mockApi.splitMiniSeries.mockRejectedValue({
      response: { data: { detail: "Race 6 is already published — split an earlier slot" } },
    });
    mockApi.deleteRace.mockResolvedValue({ ok: true });
    renderDialog();
    await openAndSelectSeries();
    act(() => {
      container.querySelector('[data-testid="new-race-mode-mini"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector('[data-testid="create-race-confirm"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    // The dialog stays open (acknowledge via the still-present confirm button),
    // the split payload never reached the handler, and the orphaned race the
    // create step left behind was deleted so the series is unchanged.
    expect(container.querySelector('[data-testid="create-race-confirm"]')).not.toBeNull();
    expect(mockApi.splitMiniSeries).toHaveBeenCalledWith("s1", { race_number: 5, count: 2, name: "", scoring: "combined" });
    expect(mockApi.deleteRace).toHaveBeenCalledWith("r1", 1);
  });

  it("defaults the race number to the series' last planned slot", async () => {
    mockApi.createRace.mockResolvedValue({ id: "r1", series_id: "s1", race_number: 5 });
    mockApi.getSeries.mockResolvedValue([{ id: "s1", name: "Summer", planned_races: 5, schedule: ["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29"] }]);
    renderDialog();
    await openAndSelectSeries();
    const num = container.querySelector('[data-testid="new-race-number"]');
    expect(num.value).toBe("5");
  });
});