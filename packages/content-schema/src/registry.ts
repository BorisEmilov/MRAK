import { z } from 'zod';
import { Id } from './primitives';

/**
 * flags.json — the registry of every flag, stat, engine rule and check context used by
 * content. Nothing may reference an undeclared one. Descriptions are developer-facing.
 */
export const FlagDecl = z.strictObject({
  id: Id,
  description: z.string().min(3),
});

export const StatScope = z.enum(['guardian', 'village', 'villager', 'world', 'profile']);

export const StatDecl = z
  .strictObject({
    id: Id,
    scope: StatScope,
    min: z.number(),
    max: z.number(),
    default: z.number(),
    description: z.string().min(3),
  })
  .refine((s) => s.min <= s.default && s.default <= s.max, {
    message: 'default must lie within [min, max]',
  });

export const RuleDecl = z.strictObject({
  id: Id,
  description: z.string().min(3),
  /** Parameter names the rule accepts. */
  params: z.array(z.string()).optional(),
});

export const ContextDecl = z.strictObject({
  id: Id,
  description: z.string().min(3),
});

export const Registry = z
  .strictObject({
    flags: z.array(FlagDecl),
    stats: z.array(StatDecl),
    rules: z.array(RuleDecl),
    contexts: z.array(ContextDecl),
  })
  .meta({ id: 'Registry' });
export type Registry = z.infer<typeof Registry>;
export type StatDecl = z.infer<typeof StatDecl>;
