// CopyLinkButton: copies a shareable permalink to the clipboard (with a
// textarea fallback for non-secure contexts) and confirms with a toast.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import CopyLinkButton from "@/components/CopyLinkButton";
import { toast } from "sonner";

const URL_UNDER_TEST = "https://sailscore.example/club/medway-yacht-club?class=c1&series=s2";

function renderButton(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CopyLinkButton url={URL_UNDER_TEST} {...props} />));
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  navigator.clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
});

it("copies the exact permalink and confirms with a toast", async () => {
  const container = renderButton();
  await act(async () => {
    container.querySelector('[data-testid="share-results-link"]').click();
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(URL_UNDER_TEST);
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Link copied"));
  // Visual confirmation flips to "Copied" while the toast is up.
  expect(container.querySelector('[data-testid="share-results-link"]').textContent).toContain("Copied");
});

it("falls back to the textarea copy when the async clipboard API is missing", async () => {
  delete navigator.clipboard;
  document.execCommand = jest.fn(() => true);
  const container = renderButton();
  await act(async () => {
    container.querySelector('[data-testid="share-results-link"]').click();
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(document.execCommand).toHaveBeenCalledWith("copy");
  expect(toast.success).toHaveBeenCalled();
});
