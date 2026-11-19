import { TtlLru, bucketTime } from "../../src/knowledge/links-cache";

describe("TtlLru", () => {
  test("expires after the time limit", () => {
    let now = 0;
    const c = new TtlLru<number>(10, 1000, () => now);
    c.set("a", 1);
    now = 999;
    expect(c.get("a")).toBe(1);
    now = 2000;
    expect(c.get("a")).toBeUndefined();
  });
  test("evicts the least recently used entry", () => {
    const c = new TtlLru<number>(2, 1000, () => 0);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.size).toBe(2);
  });
  test("buckets playback time", () => {
    expect(bucketTime(12_345)).toBe(10_000);
    expect(bucketTime(4_999)).toBe(0);
  });
});
