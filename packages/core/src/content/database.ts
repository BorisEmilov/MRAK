/**
 * ContentDatabase: read-only, indexed access to an already-validated content pack.
 * Validation happens in @mrak/content-schema (`validatePack`); this class only indexes.
 */
import type {
  CollectionName,
  ContentPack,
  EntityOf,
  Registry,
  StatDecl,
} from '@mrak/content-schema';

export class ContentError extends Error {
  override readonly name = 'ContentError';
}

export interface ContentInfo {
  /** Pack version from the manifest (e.g. "0.1.0"). */
  version: string;
  /** Pack hash from the manifest, if known. */
  hash?: string | undefined;
}

export class ContentDatabase {
  readonly info: ContentInfo;
  private readonly indexes = new Map<CollectionName, ReadonlyMap<string, unknown>>();
  private readonly lists = new Map<CollectionName, readonly unknown[]>();
  private readonly stats: ReadonlyMap<string, StatDecl>;
  private readonly flags: ReadonlySet<string>;
  private readonly clueOwner: Map<string, string>;
  private readonly texts: Readonly<Record<string, string>>;
  readonly registry: Registry;

  constructor(pack: ContentPack, info: ContentInfo = { version: '0.0.0' }) {
    this.info = info;
    this.registry = pack.registry;
    for (const [name, value] of Object.entries(pack)) {
      if (name === 'registry' || name === 'locales' || !Array.isArray(value)) continue;
      const list = value as { id: string }[];
      this.lists.set(name as CollectionName, list);
      this.indexes.set(name as CollectionName, new Map(list.map((e) => [e.id, e])));
    }
    this.stats = new Map(pack.registry.stats.map((s) => [s.id, s]));
    this.flags = new Set(pack.registry.flags.map((f) => f.id));
    this.clueOwner = new Map(
      pack.mysteries.flatMap((m) => m.clues.map((c) => [c.id, m.id] as const)),
    );
    this.texts = pack.locales.en;
  }

  /**
   * Adds a generated mystery (Endless Chronicle) unless one with its id exists. Generated ids are
   * namespaced (`gen-…`), so authored content never collides with them.
   */
  registerMystery(mystery: EntityOf<'mysteries'>): void {
    if (this.has('mysteries', mystery.id)) return;
    const list = [...this.all('mysteries'), mystery];
    this.lists.set('mysteries', list);
    this.indexes.set('mysteries', new Map(list.map((e) => [e.id, e])));
    for (const c of mystery.clues) this.clueOwner.set(c.id, mystery.id);
  }

  /** Adds a newcomer villager of the endless years (ids `gen-v-…`), unless it exists. */
  registerVillager(villager: EntityOf<'villagers'>): void {
    if (this.has('villagers', villager.id)) return;
    const list = [...this.all('villagers'), villager];
    this.lists.set('villagers', list);
    this.indexes.set('villagers', new Map(list.map((e) => [e.id, e])));
  }

  find<C extends CollectionName>(collection: C, id: string): EntityOf<C> | undefined {
    return this.indexes.get(collection)?.get(id) as EntityOf<C> | undefined;
  }

  get<C extends CollectionName>(collection: C, id: string): EntityOf<C> {
    const entity = this.find(collection, id);
    if (!entity) throw new ContentError(`unknown ${collection} "${id}"`);
    return entity;
  }

  has(collection: CollectionName, id: string): boolean {
    return this.indexes.get(collection)?.has(id) ?? false;
  }

  all<C extends CollectionName>(collection: C): readonly EntityOf<C>[] {
    return (this.lists.get(collection) ?? []) as readonly EntityOf<C>[];
  }

  statDecl(id: string): StatDecl {
    const decl = this.stats.get(id);
    if (!decl) throw new ContentError(`undeclared stat "${id}"`);
    return decl;
  }

  hasStat(id: string): boolean {
    return this.stats.has(id);
  }

  assertFlag(id: string): void {
    if (!this.flags.has(id)) throw new ContentError(`undeclared flag "${id}"`);
  }

  /** The mystery a clue belongs to. */
  mysteryOfClue(clueId: string): string {
    const owner = this.clueOwner.get(clueId);
    if (!owner) throw new ContentError(`unknown clue "${clueId}"`);
    return owner;
  }

  /** English text for a localization key (the key itself if missing, so it is visible in QA). */
  text(key: string): string {
    return this.texts[key] ?? key;
  }
}
