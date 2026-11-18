import { describe, expect, it } from 'vitest';
import { Pool } from './pool';

describe('Pool', () => {
  it('reuses parked objects and creates only when empty', () => {
    const disposed: number[] = [];
    let n = 0;
    const pool = new Pool(
      () => ({ id: ++n, visible: true }),
      (o) => {
        o.visible = false;
      },
      (o) => disposed.push(o.id),
    );
    const a = pool.take();
    const b = pool.take();
    pool.give(a);
    expect(a.visible).toBe(false);
    expect(pool.take()).toBe(a);
    for (let i = 0; i < 100; i++) pool.give(pool.take());
    expect(pool.created).toBe(3);
    pool.give(b);
    pool.destroy();
    expect(disposed.sort()).toEqual([2, 3]);
    expect(pool.idle).toBe(0);
  });
});
