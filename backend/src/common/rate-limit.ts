/** Fixed-window in-memory rate limiter (single instance, MVP; see README limitations). */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(private readonly limit: number, private readonly windowMs = 60_000, private readonly now = () => Date.now()) {}

  /** Returns true if the call is allowed (and counts it). */
  take(key: string): boolean {
    const t = this.now();
    const cur = this.hits.get(key);
    if (!cur || t - cur.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: t, count: 1 });
      this.prune(t);
      return true;
    }
    if (cur.count >= this.limit) return false;
    cur.count += 1;
    return true;
  }

  private prune(t: number): void {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) if (t - v.windowStart >= this.windowMs) this.hits.delete(k);
  }
}
