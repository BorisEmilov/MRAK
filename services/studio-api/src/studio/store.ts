/** Studio content store (docs/systems/studio.md → Data): entries + revisions, memory or Postgres. */
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

export const STATUSES = ['draft', 'reviewed', 'published'] as const;
export type Status = (typeof STATUSES)[number];

export interface Entry {
  collection: string;
  entityId: string;
  file: string;
  position: number;
  body: unknown;
  publishedBody: unknown;
  status: Status;
  version: number;
  deleted: boolean;
  updatedBy: string;
  updatedAt: Date;
}

export interface Revision {
  id: string;
  collection: string;
  entityId: string;
  version: number;
  body: unknown;
  status: Status;
  deleted: boolean;
  author: string;
  note: string | null;
  createdAt: Date;
}

export interface ContentStore {
  all(): Promise<Entry[]>;
  get(collection: string, entityId: string): Promise<Entry | null>;
  /** Saves the entry and appends its revision atomically. */
  save(entry: Entry, note: string | null): Promise<void>;
  history(collection: string, entityId: string): Promise<Revision[]>;
}

export const revisionOf = (e: Entry, note: string | null): Revision => ({
  id: randomUUID(),
  collection: e.collection,
  entityId: e.entityId,
  version: e.version,
  body: e.body,
  status: e.status,
  deleted: e.deleted,
  author: e.updatedBy,
  note,
  createdAt: e.updatedAt,
});

const key = (c: string, id: string) => `${c}\u0000${id}`;
const clone = <T>(v: T): T => structuredClone(v);

export class MemoryContentStore implements ContentStore {
  private readonly entries = new Map<string, Entry>();
  private readonly revisions: Revision[] = [];
  all(): Promise<Entry[]> {
    return Promise.resolve([...this.entries.values()].map(clone));
  }
  get(c: string, id: string): Promise<Entry | null> {
    const e = this.entries.get(key(c, id));
    return Promise.resolve(e ? clone(e) : null);
  }
  save(entry: Entry, note: string | null): Promise<void> {
    this.entries.set(key(entry.collection, entry.entityId), clone(entry));
    this.revisions.push(revisionOf(clone(entry), note));
    return Promise.resolve();
  }
  history(c: string, id: string): Promise<Revision[]> {
    return Promise.resolve(
      this.revisions
        .filter((r) => r.collection === c && r.entityId === id)
        .sort((a, b) => b.version - a.version)
        .map(clone),
    );
  }
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export class PrismaContentStore implements ContentStore {
  constructor(private readonly db: PrismaClient) {}
  async all(): Promise<Entry[]> {
    return (await this.db.contentEntry.findMany()) as Entry[];
  }
  async get(collection: string, entityId: string): Promise<Entry | null> {
    return (await this.db.contentEntry.findUnique({
      where: { collection_entityId: { collection, entityId } },
    })) as Entry | null;
  }
  async save(e: Entry, note: string | null): Promise<void> {
    const data = {
      ...e,
      body: json(e.body),
      publishedBody: e.publishedBody === null ? Prisma.DbNull : json(e.publishedBody),
    };
    const r = revisionOf(e, note);
    await this.db.$transaction([
      this.db.contentEntry.upsert({
        where: { collection_entityId: { collection: e.collection, entityId: e.entityId } },
        create: data,
        update: data,
      }),
      this.db.contentRevision.create({ data: { ...r, body: json(r.body) } }),
    ]);
  }
  async history(collection: string, entityId: string): Promise<Revision[]> {
    return (await this.db.contentRevision.findMany({
      where: { collection, entityId },
      orderBy: { version: 'desc' },
      take: 200,
    })) as Revision[];
  }
}
