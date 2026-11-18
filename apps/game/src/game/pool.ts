/**
 * Object pool (docs/systems/performance.md → Pooling): reuses game objects instead of creating
 * and destroying them while playing; only `destroy()` frees them (scene shutdown).
 */
export class Pool<T> {
  private readonly free: T[] = [];
  created = 0;

  constructor(
    private readonly make: () => T,
    private readonly park: (item: T) => void,
    private readonly dispose: (item: T) => void,
  ) {}

  take(): T {
    const item = this.free.pop();
    if (item !== undefined) return item;
    this.created++;
    return this.make();
  }

  give(item: T): void {
    this.park(item);
    this.free.push(item);
  }

  get idle(): number {
    return this.free.length;
  }

  destroy(): void {
    for (const item of this.free) this.dispose(item);
    this.free.length = 0;
  }
}
