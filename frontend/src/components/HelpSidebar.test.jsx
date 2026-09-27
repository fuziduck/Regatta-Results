globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import HelpSidebar from "./HelpSidebar";


let container;
let root;
beforeEach(() => {
  window.history.replaceState({}, "", "/officer");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

test("opens contextual page topics with navigation to full guides", () => {
  act(() => root.render(<HelpSidebar />));
  act(() => container.querySelector('[data-testid="help-sidebar-trigger"]').click());
  expect(document.body.textContent).toContain("Race Officer");
  expect(document.body.textContent).toContain("Scheduled races");
  expect(document.body.querySelector('a[href="/help/quick-start/officer"]')).not.toBeNull();
  expect(document.body.querySelector('a[href="/help/quick-start/admin"]')).not.toBeNull();
  expect(document.body.querySelector('a[href="/faq"]')).not.toBeNull();
});

test("matches a new page topic when route changes", () => {
  window.history.replaceState({}, "", "/admin");
  act(() => root.render(<HelpSidebar />));
  act(() => container.querySelector('[data-testid="help-sidebar-trigger"]').click());
  expect(document.body.textContent).toContain("Race Admin");
  expect(document.body.textContent).toContain("Classes");
});
