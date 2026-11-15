/** A bounded map with a time-to-live: least recently used entries go first, expired ones are never returned. */
export class TtlLru<V> {
  private readonly map = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() - e.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // Touch: most recently used goes last.
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  /** Time since the entry was written, or Infinity. Does not touch it. */
  age(key: string): number {
    const e = this.map.get(key);
    return e ? this.now() - e.at : Infinity;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { at: this.now(), value });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }

  get size(): number {
    return this.map.size;
  }
}
