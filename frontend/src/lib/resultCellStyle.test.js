import { fmtScore, raceCellStyle, podiumPlace, PODIUM_FILLS, DISCARD_TEXT, PENALTY_TEXT } from "./resultCellStyle";

describe("fmtScore", () => {
  it("formats a plain finishing position without a code suffix", () => {
    expect(fmtScore({ points: 2, code: "FINISHED", discarded: false })).toBe("2");
    expect(fmtScore({ points: 1.5, code: "FINISHED", discarded: false })).toBe("1.5");
  });

  it("appends the code for non-finish results", () => {
    expect(fmtScore({ points: 4, code: "DNC", discarded: false })).toBe("4 DNC");
    expect(fmtScore({ points: 2.5, code: "OOD", discarded: false })).toBe("2.5 OOD");
  });

  it("does not append the synthetic MINI code (the header names the day)", () => {
    expect(fmtScore({ points: 3.5, code: "MINI", discarded: false })).toBe("3.5");
  });

  it("wraps discarded results in brackets whatever their code", () => {
    expect(fmtScore({ points: 4, code: "DNC", discarded: true })).toBe("(4 DNC)");
    expect(fmtScore({ points: 2.5, code: "OOD", discarded: true })).toBe("(2.5 OOD)");
    expect(fmtScore({ points: 1, code: "FINISHED", discarded: true })).toBe("(1)");
    expect(fmtScore({ points: 3.5, code: "MINI", discarded: true })).toBe("(3.5)");
  });
});

describe("raceCellStyle — discard highlighting is kept for every code", () => {
  it("applies the grey italic discard style to discarded non-numerical results too", () => {
    for (const code of ["DNC", "DNS", "DNF", "RET", "DSQ", "OOD", "MINI", "UFD", "TLE"]) {
      const style = raceCellStyle({ points: 4, code, discarded: true });
      expect(style.textColor).toEqual(DISCARD_TEXT);
      expect(style.fontStyle).toBe("italic");
      expect(style.fillColor).toBeNull();
    }
  });

  it("applies the same discard style to a discarded numerical position", () => {
    const style = raceCellStyle({ points: 7, code: "FINISHED", discarded: true });
    expect(style.textColor).toEqual(DISCARD_TEXT);
    expect(style.fontStyle).toBe("italic");
  });
});

describe("podiumPlace (shared by PDF export and web tables)", () => {
  it("returns the place for counting 1st/2nd/3rd finishing positions", () => {
    expect(podiumPlace({ points: 1, code: "FINISHED", discarded: false })).toBe(1);
    expect(podiumPlace({ points: 2, code: "FINISHED", discarded: false })).toBe(2);
    expect(podiumPlace({ points: 3, code: "FINISHED", discarded: false })).toBe(3);
  });

  it("returns null when the result is discarded (discard always wins)", () => {
    expect(podiumPlace({ points: 1, code: "FINISHED", discarded: true })).toBeNull();
  });

  it("returns null for non-position results", () => {
    for (const s of [
      { points: 1, code: "DNC", discarded: false },
      { points: 2, code: "OOD", discarded: false },
      { points: 3, code: "MINI", discarded: false },
      { points: 1, code: "DPI", discarded: false },
      { points: 3, code: "SCP", discarded: false },
      { points: 1.5, code: "FINISHED", discarded: false }, // tied-place split
      { points: 4, code: "FINISHED", discarded: false },
      null,
      undefined,
      "R3",
    ]) {
      expect(podiumPlace(s)).toBeNull();
    }
  });
});


describe("raceCellStyle — podium highlighting", () => {
  it("highlights genuine 1st/2nd/3rd finishing positions with bold medal fills", () => {
    for (const pts of [1, 2, 3]) {
      const style = raceCellStyle({ points: pts, code: "FINISHED", discarded: false });
      expect(style.fillColor).toEqual(PODIUM_FILLS[pts]);
      expect(style.fontStyle).toBe("bold");
      expect(style.textColor).not.toBeNull();
    }
  });

  it("never applies podium colours to non-position results", () => {
    const nonPodium = [
      { points: 1, code: "DNC", discarded: false },
      { points: 2, code: "DNS", discarded: false },
      { points: 3, code: "DNF", discarded: false },
      { points: 1, code: "DSQ", discarded: false },
      { points: 2, code: "RET", discarded: false },
      { points: 1, code: "OOD", discarded: false },
      { points: 3, code: "MINI", discarded: false },
      { points: 2, code: "DPI", discarded: false },
      { points: 1, code: "RDG", discarded: false },
      { points: 3, code: "SCP", discarded: false },
      { points: 2, code: "ZFP", discarded: false },
      { points: 1.5, code: "FINISHED", discarded: false }, // tied-place split
      { points: 4, code: "FINISHED", discarded: false },
      { points: 0, code: "FINISHED", discarded: false },
    ];
    for (const s of nonPodium) {
      const style = raceCellStyle(s);
      expect(style.fillColor).toBeNull();
      expect(style.fontStyle).toBeNull();
    }
  });
});

describe("raceCellStyle — discard beats podium", () => {
  it("a discarded 1st/2nd/3rd uses the discard style, never the podium fill", () => {
    for (const pts of [1, 2, 3]) {
      const style = raceCellStyle({ points: pts, code: "FINISHED", discarded: true });
      expect(style.textColor).toEqual(DISCARD_TEXT);
      expect(style.fontStyle).toBe("italic");
      expect(style.fillColor).toBeNull();
    }
  });
});

describe("raceCellStyle — penalty codes stay red", () => {
  it("keeps the red text for counting non-finish codes", () => {
    for (const code of ["DNC", "DNF", "RET", "DSQ", "UFD", "OCS", "ZFP", "BFD"]) {
      const style = raceCellStyle({ points: 4, code, discarded: false });
      expect(style.textColor).toEqual(PENALTY_TEXT);
      expect(style.fillColor).toBeNull();
    }
  });

  it("does not red-flag duty, redress, manual points or combined days", () => {
    for (const code of ["OOD", "DPI", "RDG", "MINI", "TLE", "DNE"]) {
      const style = raceCellStyle({ points: 4, code, discarded: false });
      expect(style.textColor).toBeNull();
      expect(style.fillColor).toBeNull();
    }
  });
});

describe("raceCellStyle — empty cells", () => {
  it("returns neutral styles for empty/TBC/header cells", () => {
    for (const raw of [null, undefined, "", "R3"]) {
      const style = raceCellStyle(raw);
      expect(style.textColor).toBeNull();
      expect(style.fontStyle).toBeNull();
      expect(style.fillColor).toBeNull();
    }
  });
});
