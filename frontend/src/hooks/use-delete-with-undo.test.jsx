// The delete primitive used by the officer and admin consoles: a confirmation
// gate in front of every destructive delete, and a short window afterwards in
// which the officer can take it back. Undo works by holding the delete back
// rather than performing and reversing it — there is no undelete endpoint, and
// re-creating a record would orphan everything pointing at the old id.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

import { UNDO_WINDOW_MS, setUndoWindowMs, useDeleteWithUndo } from "./use-delete-with-undo";

const toast = require("sonner").toast;

let container;
let root;

const flush = async (ms = 20) => {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
};

// Mirrors how the real tabs use the hook: the row is filtered out while its
// delete is pending, exactly as a table filters by isPending(id).
function Harness({ commit, undo }) {
  const { askDelete, isPending, dialog } = useDeleteWithUndo();
  const [rows, setRows] = useState(["row-1", "row-2"]);
  return (
    <div>
      {dialog}
      {rows.filter((r) => !isPending(r)).map((r) => (
        <button
          key={r}
          data-testid={r}
          onClick={() => askDelete({
            key: r,
            title: `Delete ${r}?`,
            description: "It will be gone for good.",
            confirmLabel: "Delete row",
            successMessage: `${r} deleted`,
            undoneMessage: `${r} kept`,
            errorMessage: "Could not delete the row",
            // Like the real callers, the commit deletes and then refreshes:
            // the row leaves the data the page renders from.
            commit: async () => { await commit(); setRows((rs) => rs.filter((x) => x !== r)); },
            undo,
          })}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

const render = (el) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(el); });
  return container;
};

const query = (testId) => document.querySelector(`[data-testid="${testId}"]`);
const row = (id) => container.querySelector(`[data-testid="${id}"]`);

const click = async (id) => {
  const el = query(id) || row(id);
  expect(el).not.toBeNull();
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await flush();
};

beforeEach(() => {
  setUndoWindowMs(UNDO_WINDOW_MS);
  Object.values(toast).forEach((fn) => fn.mockClear());
});

afterEach(async () => {
  if (root) {
    await act(async () => {});
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  document.body.innerHTML = "";
  setUndoWindowMs(UNDO_WINDOW_MS);
});

describe("useDeleteWithUndo", () => {
  it("asks for confirmation and deletes nothing until it is given", async () => {
    const commit = jest.fn().mockResolvedValue({});
    render(<Harness commit={commit} />);

    await click("row-1");

    expect(query("confirm-delete-dialog")).not.toBeNull();
    expect(query("confirm-delete-title").textContent).toContain("Delete row-1?");
    expect(commit).not.toHaveBeenCalled();
    // The row is untouched while the officer is still deciding.
    expect(row("row-1")).not.toBeNull();
  });

  it("keeps the row when the confirmation is cancelled", async () => {
    const commit = jest.fn().mockResolvedValue({});
    render(<Harness commit={commit} />);

    await click("row-1");
    await click("confirm-delete-cancel");

    expect(commit).not.toHaveBeenCalled();
    expect(row("row-1")).not.toBeNull();
    expect(query("confirm-delete-dialog")).toBeNull();
  });

  it("hides the row at once, then commits once the undo window has closed", async () => {
    setUndoWindowMs(0);
    const commit = jest.fn().mockResolvedValue({});
    render(<Harness commit={commit} />);

    await click("row-1");
    await click("confirm-delete-confirm");

    // Gone for good, and not before the window closed.
    expect(commit).toHaveBeenCalledTimes(1);
    expect(row("row-1")).toBeNull();
    expect(row("row-2")).not.toBeNull();
  });

  it("restores the row and never commits when the officer undoes", async () => {
    setUndoWindowMs(5000);
    const commit = jest.fn().mockResolvedValue({});
    const undo = jest.fn();
    render(<Harness commit={commit} undo={undo} />);

    await click("row-1");
    await click("confirm-delete-confirm");
    expect(row("row-1")).toBeNull();
    expect(commit).not.toHaveBeenCalled();

    const action = toast.success.mock.calls.map(([, opts]) => opts?.action).find((a) => a?.label === "Undo");
    expect(action).toBeTruthy();
    act(() => { action.onClick(); });
    await flush();

    expect(row("row-1")).not.toBeNull();
    expect(undo).toHaveBeenCalled();

    // A later tick must not resurrect the delete that was taken back.
    await flush(40);
    expect(commit).not.toHaveBeenCalled();
  });

  it("puts the row back and reports the failure when the delete is rejected", async () => {
    setUndoWindowMs(0);
    const commit = jest.fn().mockRejectedValue({ response: { data: { detail: "Boat is in use" } } });
    const undo = jest.fn();
    render(<Harness commit={commit} undo={undo} />);

    await click("row-1");
    await click("confirm-delete-confirm");
    await flush();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(row("row-1")).not.toBeNull();
    expect(undo).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Boat is in use");
  });
});
