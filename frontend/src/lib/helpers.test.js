import {
  shouldWrapBoatName,
  wrapBoatName,
  BOAT_NAME_WRAP_LIMIT,
  miniGroupForRace,
  miniSeriesNote,
  raceLabel,
} from "./helpers";

describe("shouldWrapBoatName (14-character threshold on the name itself)", () => {
  it("treats names under 14 characters as single-line", () => {
    expect(BOAT_NAME_WRAP_LIMIT).toBe(14);
    expect(shouldWrapBoatName("Bluebell")).toBe(false); // 8
    expect(shouldWrapBoatName("Sea Breeze")).toBe(false); // 10
    expect(shouldWrapBoatName("A")).toBe(false);
    expect(shouldWrapBoatName("")).toBe(false);
  });

  it("keeps exactly 14 characters on one line", () => {
    expect(shouldWrapBoatName("ABCDEFGHIJKLMN")).toBe(false); // 14
    expect(shouldWrapBoatName("Fourteen Chars")).toBe(false); // 14
  });

  it("wraps 15+ characters with spaces", () => {
    expect(shouldWrapBoatName("The Flying Fish")).toBe(true); // 15
    expect(shouldWrapBoatName("The Very Fast Boat")).toBe(true); // 18
    expect(shouldWrapBoatName("Bluebell Number Two")).toBe(true);
  });

  it("wraps long names with only one or two spaces", () => {
    expect(shouldWrapBoatName("Longname One")).toBe(false); // 12 chars
    expect(shouldWrapBoatName("Longname OneTwo")).toBe(true); // 15
    expect(shouldWrapBoatName("AB CDEFGHIJKLMNOP")).toBe(true); // 16, one space
  });

  it("wraps long names with no spaces (breaking only if the column forces it)", () => {
    expect(shouldWrapBoatName("ABCDEFGHIJKLMNO")).toBe(true); // 15, no spaces
  });

  it("handles non-string input defensively", () => {
    expect(shouldWrapBoatName(null)).toBe(false);
    expect(shouldWrapBoatName(undefined)).toBe(false);
    expect(shouldWrapBoatName(42)).toBe(false);
  });
});

describe("wrapBoatName (break at the last space within the 14-character head)", () => {
  it("leaves short names (<=14 chars) untouched", () => {
    expect(wrapBoatName("Bluebell")).toBe("Bluebell");
    expect(wrapBoatName("ABCDEFGHIJKLMN")).toBe("ABCDEFGHIJKLMN");
    expect(wrapBoatName("Sea Breeze")).toBe("Sea Breeze");
  });

  it("wraps 'The Flying Fish' as 'The Flying\\nFish' (the spec example)", () => {
    expect(wrapBoatName("The Flying Fish")).toBe("The Flying\nFish");
  });

  it("wraps longer multi-word names at a suitable space", () => {
    expect(wrapBoatName("The Very Fast Boat")).toBe("The Very Fast\nBoat");
    expect(wrapBoatName("Repeat Offender")).toBe("Repeat\nOffender");
    expect(wrapBoatName("Longname OneTwo")).toBe("Longname\nOneTwo");
  });

  it("does not split a word mid-way (break is always at a space)", () => {
    const out = wrapBoatName("The Very Fast Boat");
    expect(out.split("\n").every((line) => line === "" || !line.startsWith(" ") && !line.endsWith(" "))).toBe(true);
    expect(out).not.toContain("\u00AD"); // no soft hyphens
  });

  it("leaves names with no usable space unchanged (overflow-wrap handles them)", () => {
    expect(wrapBoatName("ABCDEFGHIJKLMNO")).toBe("ABCDEFGHIJKLMNO"); // 15, no spaces
    expect(wrapBoatName("Supercalifragilistic")).toBe("Supercalifragilistic");
  });

  it("handles non-string input defensively", () => {
    expect(wrapBoatName(null)).toBeNull();
    expect(wrapBoatName(undefined)).toBeUndefined();
    expect(wrapBoatName(42)).toBe(42);
  });
});

describe("miniGroupForRace (which mini series a race belongs to)", () => {
  const series = {
    mini_series: true,
    mini_series_groups: [
      { name: "Morning", race_numbers: [1, 2], discards: 0, scoring: "additional" },
      { name: "Afternoon", race_numbers: [3, 4], discards: 1, scoring: "combined" },
    ],
  };

  it("returns the group whose race_numbers include the race", () => {
    expect(miniGroupForRace(series, 1)).toEqual(series.mini_series_groups[0]);
    expect(miniGroupForRace(series, 2)).toEqual(series.mini_series_groups[0]);
    expect(miniGroupForRace(series, 3)).toEqual(series.mini_series_groups[1]);
    expect(miniGroupForRace(series, 4)).toEqual(series.mini_series_groups[1]);
  });

  it("returns null for a race outside any group", () => {
    expect(miniGroupForRace(series, 5)).toBeNull();
    expect(miniGroupForRace(series, 0)).toBeNull();
  });

  it("returns null when the series is not a mini series or has no groups", () => {
    expect(miniGroupForRace({ ...series, mini_series: false }, 1)).toBeNull();
    expect(miniGroupForRace({ ...series, mini_series_groups: [] }, 1)).toBeNull();
    expect(miniGroupForRace({ mini_series: true }, 1)).toBeNull();
  });

  it("is defensive about missing input", () => {
    expect(miniGroupForRace(null, 1)).toBeNull();
    expect(miniGroupForRace(undefined, 1)).toBeNull();
    expect(miniGroupForRace(series, undefined)).toBeNull();
  });

  it("tolerates a group with no race_numbers", () => {
    const s = { mini_series: true, mini_series_groups: [{ name: "Empty", race_numbers: [], scoring: "additional" }] };
    expect(miniGroupForRace(s, 1)).toBeNull();
  });
});

describe("raceLabel (R1A/R1B style labels for mini-series races)", () => {
  const series = {
    mini_series: true,
    mini_series_groups: [
      { name: "Morning", race_numbers: [1, 2], discards: 0, scoring: "additional" },
      { name: "Afternoon", race_numbers: [3, 4, 5], discards: 1, scoring: "combined" },
    ],
  };

  it("prefers the race's own mini_group_label stamp", () => {
    expect(raceLabel({ race_number: 3, mini_group_label: "R3A" }, series)).toBe("R3A");
    expect(raceLabel({ race_number: 4, mini_group_label: "R3B" }, series)).toBe("R3B");
    expect(raceLabel({ race_number: 5, mini_group_label: "R3C" }, series)).toBe("R3C");
  });

  it("derives the A/B/C label from the group config when there is no stamp", () => {
    expect(raceLabel({ race_number: 3 }, series)).toBe("R3A");
    expect(raceLabel({ race_number: 4 }, series)).toBe("R3B");
    expect(raceLabel({ race_number: 5 }, series)).toBe("R3C");
    expect(raceLabel({ race_number: 1 }, series)).toBe("R1A");
    expect(raceLabel({ race_number: 2 }, series)).toBe("R1B");
  });

  it("falls back to a plain R number for normal races", () => {
    expect(raceLabel({ race_number: 6 }, series)).toBe("R6");
    expect(raceLabel({ race_number: 6 }, null)).toBe("R6");
    expect(raceLabel({ race_number: 6 }, { mini_series: true })).toBe("R6");
  });

  it("keeps a single-race mini group as a plain R number", () => {
    const s = { mini_series: true, mini_series_groups: [{ name: "One", race_numbers: [2], scoring: "additional" }] };
    expect(raceLabel({ race_number: 2 }, s)).toBe("R2");
  });

  it("is defensive about missing input", () => {
    expect(raceLabel(null, series)).toBe("");
    expect(raceLabel(undefined, series)).toBe("");
    expect(raceLabel({}, series)).toBe("");
  });
});

describe("miniSeriesNote (officer-facing note on a mini-series race)", () => {
  it("tells the officer to score additional-mode races separately", () => {
    expect(miniSeriesNote({ name: "Morning", scoring: "additional" })).toBe("Mini series: Morning — score as separate races");
  });

  it("notes combined-mode races fold into one daily result", () => {
    expect(miniSeriesNote({ name: "Afternoon", scoring: "combined" })).toBe("Mini series: Afternoon — combined into one daily result");
  });

  it("defaults a missing scoring mode to additional", () => {
    expect(miniSeriesNote({ name: "Plain" })).toBe("Mini series: Plain — score as separate races");
  });

  it("omits the group name when it is empty", () => {
    expect(miniSeriesNote({ name: "", scoring: "additional" })).toBe("Mini series — score as separate races");
    expect(miniSeriesNote({ name: "", scoring: "combined" })).toBe("Mini series — combined into one daily result");
  });

  it("returns null for a non-mini-series race", () => {
    expect(miniSeriesNote(null)).toBeNull();
    expect(miniSeriesNote(undefined)).toBeNull();
  });
});
