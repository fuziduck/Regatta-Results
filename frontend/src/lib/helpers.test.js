import { shouldWrapBoatName, wrapBoatName, BOAT_NAME_WRAP_LIMIT } from "./helpers";

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
