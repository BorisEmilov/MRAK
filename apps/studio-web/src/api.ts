/** studio-api client (same origin; Cloudflare Access cookie or loopback in development). */
export type Status = 'draft' | 'reviewed' | 'published';

export interface EntrySummary {
  collection: string;
  entityId: string;
  status: Status;
  version: number;
  deleted: boolean;
  updatedBy: string;
}
export interface Entry extends EntrySummary {
  body: unknown;
  publishedBody: unknown;
  file: string;
}
export interface Revision {
  version: number;
  status: Status;
  author: string;
  note: string | null;
  createdAt: string;
  deleted: boolean;
}
export interface Analysis {
  issues: { severity: string; code: string; message: string; file?: string }[];
  findings: {
    code: string;
    flag: string;
    message: string;
    entity?: { collection: string; id: string };
    readers?: { collection: string; id: string }[];
  }[];
  graph: {
    nodes: { id: string; collection: string; label: string }[];
    edges: { from: string; to: string; label: string; kind: 'flag' | 'ref' }[];
  };
  villagers: {
    id: string;
    name: string;
    home: unknown;
    work: unknown;
    relationships: { villager: string; affinity: number }[];
  }[];
  mysteries: {
    id: string;
    name: string;
    suspects: unknown;
    clues: { id: string; name: string; sources: unknown; supports: unknown; refutes: unknown }[];
  }[];
}
export type JsonSchema = Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: unknown,
  ) {
    super(code);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'error', body.details);
  return body as T;
}
const enc = encodeURIComponent;
const entry = (c: string, id: string) => `/v1/entries/${enc(c)}/${enc(id)}`;

export const api = {
  schemas: () =>
    call<{ collections: string[]; schemas: Record<string, JsonSchema> }>('/v1/schemas'),
  ids: () => call<{ ids: Record<string, string[]>; texts: Record<string, string> }>('/v1/ids'),
  list: (collection: string) =>
    call<{ entries: EntrySummary[] }>(`/v1/entries?collection=${enc(collection)}`),
  get: (c: string, id: string) => call<Entry>(entry(c, id)),
  put: (c: string, id: string, body: unknown, expectedVersion: number | null, note?: string) =>
    call<Entry>(entry(c, id), {
      method: 'PUT',
      body: JSON.stringify({ body, expectedVersion, note: note ?? null }),
    }),
  remove: (c: string, id: string) => call<Entry>(entry(c, id), { method: 'DELETE' }),
  status: (c: string, id: string, status: Status) =>
    call<Entry>(`${entry(c, id)}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  history: (c: string, id: string) => call<{ revisions: Revision[] }>(`${entry(c, id)}/history`),
  diff: (c: string, id: string, from: number, to: number) =>
    call<{ changes: { path: string; before: unknown; after: unknown }[] }>(
      `${entry(c, id)}/diff?from=${String(from)}&to=${String(to)}`,
    ),
  analysis: () => call<Analysis>('/v1/analysis'),
  import: () =>
    call<{ created: number; updated: number; unchanged: number }>('/v1/import', {
      method: 'POST',
    }),
  export: () =>
    call<{
      version: string;
      hash: string;
      written: string[];
      demo: { sha256: string; bytes: number };
      full: { sha256: string; bytes: number };
    }>('/v1/export', { method: 'POST' }),
};

export interface TelemetryDashboard {
  days: number;
  rows: number;
  installs: number;
  sessions: number;
  funnel: { step: string; installs: number }[];
  deaths: { zone: string; night: number; count: number }[];
  deathCauses: { zone: string; cause: string; count: number }[];
  routes: { from: string; to: string; count: number }[];
  nights: {
    night: number;
    runs: number;
    medianMinutes: number | null;
    meanMinutes: number | null;
    meanTension: number | null;
    meanSanity: number | null;
  }[];
  meanTension: number | null;
  decisions: { key: string; cause: string; count: number }[];
  mysteries: { key: string; cause: string; count: number }[];
  errors: { key: string; text: string; count: number; installs: number }[];
}
export const telemetry = (days: number) =>
  call<TelemetryDashboard>(`/v1/telemetry?days=${String(days)}`);
