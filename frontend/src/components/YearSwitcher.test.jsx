// YearSwitcher: grouped past/current/future pills on the results heroes.
// Past years beyond the inline pill budget collapse into a "More" dropdown so
// a long season history can never stretch the hero into a wall of pills.
import { act } from "react";

// React 19 warns when act() runs outside a concurrent-act environment (jsdom
// test setup). Radix's open/close updates are synchronous here, so silence it
// for this file (same pattern as analytics.test.js).
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
import { createRoot } from "react-dom/client";
import { CURRENT_YEAR } from "@/lib/helpers";

import YearSwitcher from "./YearSwitcher";

let container;
let root;
const renderSw = (props) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<YearSwitcher grouped value={CURRENT_YEAR} {...props} />);
  });
  return container;
};

const openMore = (el) => {
  const trigger = el.querySelector('[data-testid="year-more"]');
  expect(trigger).not.toBeNull();
  act(() => {
    trigger.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  // The Radix menu portals into <body>; make sure it is gone between tests.
  document.body.innerHTML = "";
});

const pillTexts = (el) =>
  [...el.querySelectorAll('button[data-testid^="year-btn-"]')].map((b) => b.textContent.trim());

test("renders a single past year and the current year as inline pills", () => {
  const el = renderSw({ years: [CURRENT_YEAR - 1] });
  expect(pillTexts(el)).toEqual([String(CURRENT_YEAR - 1), String(CURRENT_YEAR)]);
  expect(el.querySelector('[data-testid="year-more"]')).toBeNull();
});

test("collapses past years beyond the pill budget into a More dropdown", () => {
  const el = renderSw({ years: [CURRENT_YEAR - 4, CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1] });
  // The two newest past years stay inline; the current year joins them.
  expect(pillTexts(el)).toEqual([String(CURRENT_YEAR - 1), String(CURRENT_YEAR - 2), String(CURRENT_YEAR)]);
  expect(el.querySelector('[data-testid="year-more"]')).not.toBeNull();
});

test("More dropdown lists the overflow years newest-first", () => {
  const el = renderSw({ years: [CURRENT_YEAR - 4, CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1] });
  openMore(el);
  const items = [...document.body.querySelectorAll('[data-testid="year-more-menu"] [data-testid^="year-item-"]')];
  expect(items.map((i) => i.textContent.trim())).toEqual([
    String(CURRENT_YEAR - 3),
    String(CURRENT_YEAR - 4),
  ]);
});

test("selected overflow year is labelled on the More button and ticked in the menu", () => {
  const el = renderSw({ years: [CURRENT_YEAR - 4, CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1], value: CURRENT_YEAR - 3 });
  const more = el.querySelector('[data-testid="year-more"]');
  expect(more.textContent).toContain(`More · ${CURRENT_YEAR - 3}`);
  openMore(el);
  const ticked = document.body.querySelectorAll('[data-testid="year-more-menu"] [data-testid^="year-item-"] svg');
  expect(ticked.length).toBe(1);
});

test("future years always render inline (never overflow)", () => {
  const el = renderSw({ years: [CURRENT_YEAR - 1, CURRENT_YEAR + 1, CURRENT_YEAR + 2] });
  expect(pillTexts(el)).toContain(String(CURRENT_YEAR + 1));
  expect(pillTexts(el)).toContain(String(CURRENT_YEAR + 2));
  expect(el.querySelector('[data-testid="year-more"]')).toBeNull();
});
