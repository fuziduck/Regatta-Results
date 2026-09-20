import {
  shouldWrapBoatName,
  wrapBoatName,
  BOAT_NAME_WRAP_LIMIT,
  miniGroupForRace,
  miniSeriesNote,
  raceLabel,
  clockToIso,
  clockValueOf,
  raceClock,
  outcomeLabel,
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

describe("clockToIso / clockValueOf (officer-typed finish times)", () => {
  it("anchors a typed time of day to the race date in the device's own clock", () => {
    // Same convention as a finish-button tap, so elapsed maths agrees with the start.
    expect(clockToIso("2026-05-02", "13:45:00")).toBe(new Date("2026-05-02T13:45:00").toISOString());
    expect(clockToIso("2026-05-02", "9:05")).toBe(new Date("2026-05-02T09:05:00").toISOString());
  });

  it("refuses input it cannot read rather than inventing a time", () => {
    expect(clockToIso("2026-05-02", "")).toBeNull();
    expect(clockToIso("2026-05-02", "half two")).toBeNull();
    expect(clockToIso("", "13:45")).toBeNull();
  });

  it("round-trips a recorded finish back into a time input value", () => {
    expect(clockValueOf(clockToIso("2026-05-02", "13:45:07"))).toBe("13:45:07");
    expect(clockValueOf(null)).toBe("");
    expect(clockValueOf("not-a-date")).toBe("");
  });
});

describe("raceClock (the officer's race clock)", () => {
  const at = (h, m, s = 0) => Date.parse(`2026-05-02T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}Z`);
  const race = { date: "2026-05-02", start_time: "10:00", start_tz_offset_minutes: 0 };
  const MIN = 60 * 1000;

  it("says so when no start is recorded — there is nothing to measure from", () => {
    expect(raceClock({}, at(10, 0))).toMatchObject({ state: "none", ms: null });
  });

  it("counts down to a start that is still ahead, never with a minus sign", () => {
    expect(raceClock(race, at(9, 30))).toMatchObject({ state: "before", label: "Starts in", ms: 30 * MIN });
  });

  it("runs from the gun once it has been fired", () => {
    const clock = raceClock({ ...race, actual_start: "2026-05-02T10:00:00Z" }, at(10, 25, 46));
    expect(clock).toMatchObject({ state: "gun", label: "Race timer", ms: 25 * MIN + 46000 });
    // fmtClock is device-local, so the note is asserted by shape, not by hour.
    expect(clock.note).toMatch(/^Started \d\d:\d\d:\d\d$/);
  });

  it("calls a gun-less number what it is: time since the planned start", () => {
    const clock = raceClock(race, at(10, 25, 46));
    expect(clock).toMatchObject({ state: "scheduled", label: "Since planned start", ms: 25 * MIN + 46000 });
    expect(clock.note).toContain("Not started");
  });

  it("tones every state, so the console never falls back to an unstyled number", () => {
    const states = [
      raceClock({}, at(10, 0)),
      raceClock(race, at(9, 30)),
      raceClock({ ...race, actual_start: "2026-05-02T10:00:00Z" }, at(10, 25)),
      raceClock(race, at(10, 25)),
    ];
    expect(states.map((c) => c.state)).toEqual(["none", "before", "gun", "scheduled"]);
    states.forEach((c) => expect(c.tone).toMatch(/^text-/));
  });
});

describe("outcomeLabel", () => {
  it("says what picking FINISHED does, and leaves every other code alone", () => {
    expect(outcomeLabel("FINISHED")).toBe("FINISHED — clear penalty");
    expect(outcomeLabel("DNF")).toBe("DNF");
  });
});
