// The api client redirects 401s to /login ONLY on protected pages — an
// anonymous visitor's /auth/me call (which 401s by design on every page load)
// must never bounce the whole site off a public results page.
import { isPublicRoute } from "./api";

describe("isPublicRoute", () => {
  it("treats the homepage and all public pages as public", () => {
    expect(isPublicRoute("/")).toBe(true);
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/forgot-password")).toBe(true);
    expect(isPublicRoute("/reset-password")).toBe(true);
    expect(isPublicRoute("/boats")).toBe(true);
    expect(isPublicRoute("/boat/abc-123")).toBe(true);
    expect(isPublicRoute("/club/medway-yacht-club")).toBe(true);
    expect(isPublicRoute("/club/medway-yacht-club/notice-board")).toBe(true);
    expect(isPublicRoute("/subscriptions/manage")).toBe(true);
    expect(isPublicRoute("/subscriptions/verify?token=abc")).toBe(true);
  });

  it("treats administration consoles as protected", () => {
    expect(isPublicRoute("/officer")).toBe(false);
    expect(isPublicRoute("/notice/new")).toBe(false);
    expect(isPublicRoute("/admin")).toBe(false);
    expect(isPublicRoute("/webmaster")).toBe(false);
    expect(isPublicRoute("/webmaster?tab=backups")).toBe(false);
  });
});
