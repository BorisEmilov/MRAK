/**
 * Seeded randomness. All game randomness must go through IRandom so that simulations, tests and
 * replays are reproducible. Each system draws from its own named stream, so consuming numbers in
 * one system never shifts the sequence of another.
 */
export interface IRandom {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniformly chosen element; throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Internal 32-bit state, for saving. */
  getState(): number;
  setState(state: number): void;
}

/** Mulberry32: small, fast, deterministic 32-bit PRNG. */
export function createRandom(seed: number): IRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Invalid range [${String(min)}, ${String(max)}]`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('pick() from an empty array');
      return items[int(0, items.length - 1)] as T;
    },
    getState: () => state,
    setState(s: number): void {
      state = s >>> 0;
    },
  };
}

/** FNV-1a 32-bit hash, used to derive independent stream seeds. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Named RNG streams of the game (docs/systems/world-state.md). */
export const STREAM_NAMES = ['director', 'checks', 'night', 'villagers', 'loot'] as const;
export type StreamName = (typeof STREAM_NAMES)[number];

export interface RandomStreamsState {
  seed: number;
  streams: Record<string, number>;
}

/**
 * A master seed and one derived, independent stream per system. Streams are created lazily and
 * their states are serializable, so a saved game resumes the exact same sequences.
 */
export class RandomStreams {
  readonly seed: number;
  private readonly streams = new Map<string, IRandom>();

  constructor(seed: number, states: Readonly<Record<string, number>> = {}) {
    this.seed = seed >>> 0;
    for (const [name, state] of Object.entries(states)) {
      const rng = createRandom(0);
      rng.setState(state);
      this.streams.set(name, rng);
    }
  }

  /** The seed a stream starts from: independent of the other streams. */
  static deriveSeed(seed: number, name: string): number {
    return hash32(`${String(seed >>> 0)}:${name}`);
  }

  get(name: StreamName | (string & {})): IRandom {
    let rng = this.streams.get(name);
    if (!rng) {
      rng = createRandom(RandomStreams.deriveSeed(this.seed, name));
      this.streams.set(name, rng);
    }
    return rng;
  }

  serialize(): RandomStreamsState {
    const streams: Record<string, number> = {};
    for (const name of [...this.streams.keys()].sort()) {
      streams[name] = this.streams.get(name)?.getState() ?? 0;
    }
    return { seed: this.seed, streams };
  }

  /** Rewinds every stream to a previously serialized state (used to roll back a failed command). */
  restore(state: RandomStreamsState): void {
    if (state.seed >>> 0 !== this.seed)
      throw new RangeError('cannot restore streams of another seed');
    this.streams.clear();
    for (const [name, value] of Object.entries(state.streams)) {
      const rng = createRandom(0);
      rng.setState(value);
      this.streams.set(name, rng);
    }
  }

  static deserialize(state: RandomStreamsState): RandomStreams {
    return new RandomStreams(state.seed, state.streams);
  }
}
