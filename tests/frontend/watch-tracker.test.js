import { expect, test } from "vitest";
import { createWatchTracker, mergeObserved } from "../../src/lib/watch-tracker";
const sample = (tracker, seconds, wallMs, extra = {}) =>
  tracker.sample({
    seconds,
    wallMs,
    rate: 1,
    playing: true,
    seeking: false,
    visible: true,
    ...extra,
  });

test("continuous playback is credited and seeking is not", () => {
  const tracker = createWatchTracker();
  sample(tracker, 0, 0);
  sample(tracker, 0.5, 500);
  sample(tracker, 1, 1000);
  tracker.reset();
  sample(tracker, 20, 1500);
  sample(tracker, 20.5, 2000);
  expect(tracker.drain()).toEqual([
    { start_ms: 0, end_ms: 1000 },
    { start_ms: 20000, end_ms: 20500 },
  ]);
  expect(tracker.drain()).toEqual([]);
});
test("implicit jumps, pause, hidden tabs and suspended timers never fill gaps", () => {
  const tracker = createWatchTracker();
  sample(tracker, 0, 0);
  sample(tracker, 50, 500);
  sample(tracker, 50.5, 1000, { visible: false });
  sample(tracker, 51, 1500);
  sample(tracker, 51.5, 2000, { playing: false });
  sample(tracker, 52, 2500);
  sample(tracker, 60, 10500);
  expect(tracker.drain()).toEqual([]);
});
test("playback rate is applied only across a continuous rate segment", () => {
  const tracker = createWatchTracker();
  sample(tracker, 0, 0);
  sample(tracker, 1, 500, { rate: 2 });
  sample(tracker, 2, 1000, { rate: 2 });
  expect(tracker.drain()).toEqual([{ start_ms: 1000, end_ms: 2000 }]);
});
test("replayed ranges do not double count or mutate the original snapshots", () => {
  const original = [{ start_ms: 0, end_ms: 1000 }];
  expect(mergeObserved([...original, { start_ms: 500, end_ms: 1500 }])).toEqual(
    [{ start_ms: 0, end_ms: 1500 }],
  );
  expect(original[0].end_ms).toBe(1000);
});
test("pause/ended final sample closes a real span, never includes paused time", () => {
  const t = createWatchTracker();
  sample(t, 0, 0);
  sample(t, 0.5, 500);
  sample(t, 0.75, 750, { playing: false, closing: true });
  sample(t, 0.75, 5000, { playing: false, closing: true });
  sample(t, 10, 5500, { playing: false, seeking: true, closing: true });
  expect(t.drain()).toEqual([{ start_ms: 0, end_ms: 750 }]);
});
