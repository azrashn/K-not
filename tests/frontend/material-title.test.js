import { describe, it, expect } from "vitest";
import { displayTitle } from "../../src/lib/material-title.js";

describe("displayTitle", () => {
  it("dosya uzantısını gizler", () => {
    expect(displayTitle("1.1 Introduction (reposted) - What is the Internet.mp4")).toBe(
      "1.1 Introduction (reposted) - What is the Internet",
    );
    expect(displayTitle("Chapter_3.pdf")).toBe("Chapter_3");
  });
  it("uzantı olmayan adı bozmaz, boşlukları sadeleştirir", () => {
    expect(displayTitle("Ders  notu 1.5")).toBe("Ders notu 1.5");
    expect(displayTitle(null)).toBe("");
  });
});
