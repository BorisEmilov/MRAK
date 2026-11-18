/**
 * What the server knows of the game content: achievement and Bloodline node ids with their tier.
 * Read once at startup from packages/content/data (copied into the image), so a client cannot
 * record ids that do not exist or "full" ids without the entitlement.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export type Tier = 'demo' | 'full';

export interface Catalog {
  achievement(id: string): { tier: Tier } | undefined;
  node(id: string): { tier: Tier; cost: number } | undefined;
}

const Entry = z.object({
  id: z.string(),
  tier: z.enum(['demo', 'full']),
  cost: z.number().int().min(0).optional(),
});

function readAll(dir: string): z.infer<typeof Entry>[] {
  return (
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CONTENT_DATA_DIR is deploy config, not request data
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- files listed from that directory
      .flatMap((f) => z.array(Entry).parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))))
  );
}

export function loadCatalog(dataDir: string): Catalog {
  const achievements = new Map(readAll(join(dataDir, 'achievements')).map((a) => [a.id, a]));
  const nodes = new Map(readAll(join(dataDir, 'bloodline-nodes')).map((n) => [n.id, n]));
  return {
    achievement: (id) => {
      const a = achievements.get(id);
      return a && { tier: a.tier };
    },
    node: (id) => {
      const n = nodes.get(id);
      return n && { tier: n.tier, cost: n.cost ?? 0 };
    },
  };
}
