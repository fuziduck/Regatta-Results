import { seriesNavModel } from "./seriesNav";

const series = (id, overrides = {}) => ({ id, name: id, included_in_overall: true, ...overrides });

describe("seriesNavModel — single-series year", () => {
  it("one series (one race): no Overall tab, defaults to the series, no (excl.)", () => {
    const s = series("Summer Regatta");
    const m = seriesNavModel([s], true);
    expect(m.single).toBe(true);
    expect(m.showOverall).toBe(false);
    expect(m.defaultTab).toBe("Summer Regatta");
    expect(m.showExcl(s)).toBe(false);
  });

  it("one series (many races / regatta): same single-series treatment", () => {
    const s = series("National Championship");
    const m = seriesNavModel([s], true);
    expect(m.single).toBe(true);
    expect(m.showOverall).toBe(false);
    expect(m.defaultTab).toBe("National Championship");
  });

  it("single excluded series never shows (excl.)", () => {
    const s = series("Lone Regatta", { included_in_overall: false });
    const m = seriesNavModel([s], false);
    expect(m.showOverall).toBe(false);
    expect(m.showExcl(s)).toBe(false);
    expect(m.defaultTab).toBe("Lone Regatta");
  });

  it("ignores the overall payload for a single series (it would only repeat it)", () => {
    // Even when the overall championship technically has rows, a lone series
    // is shown directly — no redundant Overall tab.
    const s = series("Only");
    expect(seriesNavModel([s], true).showOverall).toBe(false);
    expect(seriesNavModel([s], false).showOverall).toBe(false);
  });
});

describe("seriesNavModel — multi-series year (unchanged behaviour)", () => {
  it("two series: Overall tab shown and the default when the overall has rows", () => {
    const list = [series("Spring"), series("Summer")];
    const m = seriesNavModel(list, true);
    expect(m.single).toBe(false);
    expect(m.showOverall).toBe(true);
    expect(m.defaultTab).toBe("overall");
    expect(m.showExcl(list[0])).toBe(false);
  });

  it("three or more series: same as two", () => {
    const list = [series("Spring"), series("Summer"), series("Autumn")];
    const m = seriesNavModel(list, true);
    expect(m.showOverall).toBe(true);
    expect(m.defaultTab).toBe("overall");
  });

  it("series excluded from the overall championship keep the (excl.) label", () => {
    const list = [series("Spring"), series("Regatta", { included_in_overall: false })];
    const m = seriesNavModel(list, true);
    expect(m.showExcl(list[0])).toBe(false);
    expect(m.showExcl(list[1])).toBe(true);
  });

  it("multi-series year with no overall rows hides the Overall tab and defaults to the first series", () => {
    const list = [series("A", { included_in_overall: false }), series("B", { included_in_overall: false })];
    const m = seriesNavModel(list, false);
    expect(m.showOverall).toBe(false);
    expect(m.defaultTab).toBe("A");
  });
});

describe("seriesNavModel — edge cases", () => {
  it("no series: no Overall tab, safe default", () => {
    const m = seriesNavModel([], false);
    expect(m.single).toBe(false);
    expect(m.showOverall).toBe(false);
    expect(m.defaultTab).toBe("overall");
  });

  it("tolerates null/undefined input", () => {
    expect(seriesNavModel(null, false).showOverall).toBe(false);
    expect(seriesNavModel(undefined, true).showOverall).toBe(false);
    expect(seriesNavModel(null, true).defaultTab).toBe("overall");
  });

  it("different classes resolve independently (one series vs several)", () => {
    const singleClass = seriesNavModel([series("Regatta")], true);
    const multiClass = seriesNavModel([series("S1"), series("S2")], true);
    expect(singleClass.showOverall).toBe(false);
    expect(singleClass.defaultTab).toBe("Regatta");
    expect(multiClass.showOverall).toBe(true);
    expect(multiClass.defaultTab).toBe("overall");
  });

  it("switching between a single-series year and a multi-series year flips the model", () => {
    const singleYear = seriesNavModel([series("Regatta")], true);
    const multiYear = seriesNavModel([series("Spring"), series("Summer")], true);
    expect(singleYear.showOverall).toBe(false);
    expect(multiYear.showOverall).toBe(true);
    // The landing tab follows the model: series id for the lone year,
    // "overall" for the multi-series year.
    expect(singleYear.defaultTab).toBe("Regatta");
    expect(multiYear.defaultTab).toBe("overall");
  });
});
