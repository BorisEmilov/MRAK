/**
 * Emergency switches (docs/runbooks/abuse.md): turn features off at runtime, without deploying.
 * State lives in the Redis hash `mrak:switches` (field = switch, value "off"/"on"), read at most
 * every 5 s per instance. Defaults come from KILL_SWITCHES (comma list of switches that start
 * off). If Redis is unreachable the last known state (or the defaults) stays in force.
 */
import type { Redis } from 'ioredis';

export const SWITCHES = [
  'registration',
  'cloud-saves',
  'telemetry',
  'emails',
  'purchases',
] as const;
export type SwitchName = (typeof SWITCHES)[number];

export const SWITCH_KEY = 'mrak:switches';
export const SWITCH_CACHE_MS = 5000;

export interface Switches {
  enabled(name: SwitchName): Promise<boolean>;
}

export function parseDisabled(csv = ''): Set<SwitchName> {
  const out = new Set<SwitchName>();
  for (const s of csv
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (!(SWITCHES as readonly string[]).includes(s))
      throw new Error(`KILL_SWITCHES: unknown "${s}"`);
    out.add(s as SwitchName);
  }
  return out;
}

/** Fixed state (tests, no Redis). */
export class StaticSwitches implements Switches {
  constructor(readonly disabled = new Set<SwitchName>()) {}
  enabled(name: SwitchName): Promise<boolean> {
    return Promise.resolve(!this.disabled.has(name));
  }
}

export class RedisSwitches implements Switches {
  private state = new Map<SwitchName, boolean>();
  private readAt = -Infinity;
  private pending: Promise<void> | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly defaults: Set<SwitchName>,
    private readonly clock: () => number = Date.now,
  ) {
    for (const s of SWITCHES) this.state.set(s, !defaults.has(s));
  }

  async enabled(name: SwitchName): Promise<boolean> {
    if (this.clock() - this.readAt >= SWITCH_CACHE_MS) {
      this.pending ??= this.refresh().finally(() => {
        this.pending = null;
      });
      await this.pending;
    }
    return this.state.get(name) ?? true;
  }

  private async refresh(): Promise<void> {
    try {
      const raw = await this.redis.hgetall(SWITCH_KEY);
      for (const s of SWITCHES) {
        const v = raw[s];
        this.state.set(s, v === undefined ? !this.defaults.has(s) : v !== 'off');
      }
    } catch {
      // keep the last known state
    }
    this.readAt = this.clock();
  }
}
