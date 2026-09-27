import { act } from "react";
import { createRoot } from "react-dom/client";
import ResultsBrowseTree from "./ResultsBrowseTree";

const tree = [{
  key: "category:club_championship",
  label: "Club Championship",
  testId: "view-club_championship-btn",
  children: [{
    key: "class:sonata",
    label: "Sonata",
    testId: "class-tab-Sonata",
    children: [{ key: "series:spring", label: "Spring", testId: "series-tab-Spring" }],
  }],
}];

let container;
let root;

const renderTree = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onSelect = jest.fn((node) => node.onSelect?.());
  act(() => root.render(
    <ResultsBrowseTree
      nodes={tree}
      selectedPath={[
        { key: "category:club_championship", label: "Club Championship" },
        { key: "class:sonata", label: "Sonata" },
        { key: "series:spring", label: "Spring" },
      ]}
      onSelect={onSelect}
    />,
  ));
  return onSelect;
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
});

test("keeps a concise browse label in the collapsed header", () => {
  renderTree();
  expect(container.querySelector('[data-testid="browse-tree-label"]').textContent)
    .toBe("Browse results");
  expect(container.textContent).not.toContain("Club Championship  /  Sonata  /  Spring");
  expect(container.querySelector('[data-testid="browse-tree-content"]')).toBeNull();
  expect(container.querySelector('[data-testid="browse-tree-toggle"]').getAttribute("aria-expanded")).toBe("false");
});

test("expands nested choices, selects a series, and collapses the tree", () => {
  const onSelect = renderTree();
  act(() => container.querySelector('[data-testid="browse-tree-toggle"]').click());
  expect(container.querySelector('[data-testid="view-club_championship-btn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="class-tab-Sonata"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="series-tab-Spring"]')).not.toBeNull();

  act(() => container.querySelector('[data-testid="series-tab-Spring"]').click());
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "series:spring" }));
  expect(container.querySelector('[data-testid="browse-tree-content"]')).toBeNull();
  expect(container.querySelector('[data-testid="browse-tree-toggle"]').getAttribute("aria-expanded")).toBe("false");
});
