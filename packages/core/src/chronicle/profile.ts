/**
 * The Bloodline profile (docs/systems/bloodline-tree.md): account-level, outside any save. Legacy
 * comes from ended generations; nodes are bought with it and apply to every later guardian.
 */
import { z } from 'zod';
import { Id } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { ChronicleError } from './common';

export const ProfileSchema = z.strictObject({
  legacy: z.strictObject({ available: z.int().min(0), lifetime: z.int().min(0) }),
  nodes: z.array(Id).max(200),
  /** Generations already rewarded ("person@day"), so a reload never pays twice. */
  awarded: z.array(z.string().max(80)).max(5000),
  /** Cosmetic titles from seasonal events (never power). */
  titles: z.array(z.string().max(120)).max(200).default([]),
  /** Unlocked achievements (account-level, never lost with a save). `at`: epoch ms. */
  achievements: z
    .array(z.strictObject({ id: Id, at: z.int().min(0) }))
    .max(1000)
    .default([]),
  /** Global stats across every chronicle (docs/systems/achievements.md → Account progress). */
  stats: z
    .strictObject({
      nights: z.int().min(0),
      exorcisms: z.int().min(0),
      routes: z.array(Id).max(200),
      endings: z.array(Id).max(200),
    })
    .default({ nights: 0, exorcisms: 0, routes: [], endings: [] }),
});
export type Profile = z.infer<typeof ProfileSchema>;

export function emptyProfile(): Profile {
  return {
    legacy: { available: 0, lifetime: 0 },
    nodes: [],
    awarded: [],
    titles: [],
    achievements: [],
    stats: { nights: 0, exorcisms: 0, routes: [], endings: [] },
  };
}

/** Adds a generation's Legacy once. */
export function awardLegacy(profile: Profile, key: string, amount: number): Profile {
  if (profile.awarded.includes(key) || amount <= 0) return profile;
  return {
    ...profile,
    legacy: {
      available: profile.legacy.available + amount,
      lifetime: profile.legacy.lifetime + amount,
    },
    awarded: [...profile.awarded, key],
  };
}

/** Adds a cosmetic title once. */
export function grantTitle(profile: Profile, title: string): Profile {
  return profile.titles.includes(title)
    ? profile
    : { ...profile, titles: [...profile.titles, title] };
}

/** Why a node cannot be bought (null: it can). */
export function nodeBlocked(
  profile: Profile,
  db: ContentDatabase,
  id: string,
): 'owned' | 'requires' | 'exclusive' | 'legacy' | null {
  const node = db.get('bloodline-nodes', id);
  if (profile.nodes.includes(id)) return 'owned';
  if (node.requires.some((r) => !profile.nodes.includes(r))) return 'requires';
  if (node.exclusiveWith.some((r) => profile.nodes.includes(r))) return 'exclusive';
  if (profile.legacy.available < node.cost) return 'legacy';
  return null;
}

export function buyNode(profile: Profile, db: ContentDatabase, id: string): Profile {
  const blocked = nodeBlocked(profile, db, id);
  if (blocked !== null) throw new ChronicleError(`cannot buy "${id}": ${blocked}`);
  return {
    ...profile,
    legacy: {
      ...profile.legacy,
      available: profile.legacy.available - db.get('bloodline-nodes', id).cost,
    },
    nodes: [...profile.nodes, id].sort(),
  };
}

/** Local guest data meets the account: union of nodes and awards, max of Legacy. */
export function mergeProfiles(a: Profile, b: Profile): Profile {
  const union = (x: readonly string[], y: readonly string[]): string[] =>
    [...new Set([...x, ...y])].sort();
  return {
    legacy: {
      available: Math.max(a.legacy.available, b.legacy.available),
      lifetime: Math.max(a.legacy.lifetime, b.legacy.lifetime),
    },
    nodes: union(a.nodes, b.nodes),
    awarded: union(a.awarded, b.awarded),
    titles: union(a.titles, b.titles),
    // The same achievement unlocked on two devices keeps the earliest time.
    achievements: [...a.achievements, ...b.achievements]
      .reduce<Profile['achievements']>((out, u) => {
        const i = out.findIndex((o) => o.id === u.id);
        if (i < 0) out.push(u);
        else if (u.at < (out[i]?.at ?? u.at)) out[i] = u;
        return out;
      }, [])
      .sort((x, y) => x.at - y.at || x.id.localeCompare(y.id)),
    stats: {
      nights: Math.max(a.stats.nights, b.stats.nights),
      exorcisms: Math.max(a.stats.exorcisms, b.stats.exorcisms),
      routes: union(a.stats.routes, b.stats.routes),
      endings: union(a.stats.endings, b.stats.endings),
    },
  };
}
