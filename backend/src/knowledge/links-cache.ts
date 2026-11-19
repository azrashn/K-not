/** Small in-memory LRU with a time limit, for page <-> video link lookups.
 *  Single instance, no persistence: a restart only costs one recomputation. */
export class TtlLru<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();
  constructor(
    private readonly max = 200,
    private readonly ttlMs = 10 * 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/** Playback time is bucketed so a scrubbing video does not make one request per millisecond. */
export const TIME_BUCKET_MS = 5_000;
export const bucketTime = (ms: number) => Math.floor(ms / TIME_BUCKET_MS) * TIME_BUCKET_MS;
