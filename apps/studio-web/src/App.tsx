/** MRAK Studio (docs/systems/studio.md): browse, edit, review, publish, analyse and export. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type Analysis,
  type Entry,
  type EntrySummary,
  type JsonSchema,
} from './api';
import { makeDefault, type FormCtx } from './schema';
import { Field } from './SchemaForm';
import { TelemetryPanel } from './TelemetryPanel';
import { AnalysisPanel, DependencyGraph, History, Mysteries, Villagers } from './views';

type Tab = 'edit' | 'graph' | 'villagers' | 'mysteries' | 'analysis' | 'telemetry';
const SCHEMA_FILE: Record<string, string> = { registry: 'flags', locales: 'locale' };

function message(err: unknown): string {
  if (err instanceof ApiError)
    return `${err.code}${err.details ? `: ${JSON.stringify(err.details).slice(0, 600)}` : ''}`;
  return String(err);
}

export function App() {
  const [collections, setCollections] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<Record<string, JsonSchema>>({});
  const [ids, setIds] = useState<Record<string, string[]>>({});
  const [collection, setCollection] = useState('events');
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [filter, setFilter] = useState('');
  const [entry, setEntry] = useState<Entry | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('edit');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [texts, setTexts] = useState<Record<string, string>>({});

  const run = useCallback(async (work: () => Promise<string | null>) => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await work();
      if (text) setNotice({ text, bad: false });
    } catch (err) {
      setNotice({ text: message(err), bad: true });
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshIds = useCallback(() => {
    void api.ids().then((r) => {
      setIds(r.ids);
      setTexts(r.texts);
    });
  }, []);
  useEffect(() => {
    void api.schemas().then((s) => {
      setCollections(s.collections);
      setSchemas(s.schemas);
    });
    refreshIds();
  }, [refreshIds]);
  const refreshList = useCallback(() => {
    void api.list(collection).then((r) => {
      setEntries(r.entries);
    });
  }, [collection]);
  useEffect(refreshList, [refreshList]);

  const open = useCallback(
    (c: string, id: string) => {
      void run(async () => {
        const e = await api.get(c, id);
        setCollection(c);
        setEntry(e);
        setDraft(structuredClone(e.body));
        setTab('edit');
        return null;
      });
    },
    [run],
  );

  const schemaFile = schemas[SCHEMA_FILE[collection] ?? collection];
  const ctx: FormCtx = useMemo(
    () => ({ defs: (schemaFile?.['$defs'] ?? {}) as Record<string, JsonSchema>, ids, texts }),
    [schemaFile, ids, texts],
  );
  /** The single-entity schema (files may hold one entity or an array of them). */
  const entitySchema: JsonSchema | null = useMemo(() => {
    if (!schemaFile) return null;
    if (collection === 'locales') return { type: 'string' };
    const anyOf = schemaFile['anyOf'] as JsonSchema[] | undefined;
    return anyOf?.[0] ?? schemaFile;
  }, [schemaFile, collection]);

  const visible = entries.filter((e) => e.entityId.includes(filter.trim()));
  const dirty = entry !== null && JSON.stringify(draft) !== JSON.stringify(entry.body);

  const save = () =>
    run(async () => {
      if (!entry) return null;
      const id = entry.entityId;
      const next = await api.put(collection, id, draft, entry.version || null);
      setEntry(next);
      setDraft(structuredClone(next.body));
      refreshList();
      refreshIds();
      return `Saved ${id} as draft v${String(next.version)}`;
    });
  const createNew = () => {
    const id = window.prompt(`New ${collection} id (kebab-case)`)?.trim();
    if (!id || !entitySchema) return;
    const body =
      collection === 'locales'
        ? ''
        : { ...(makeDefault(entitySchema, ctx) as Record<string, unknown>), id, tier: 'demo' };
    setEntry({
      collection,
      entityId: id,
      status: 'draft',
      version: 0,
      deleted: false,
      updatedBy: '',
      body: null,
      publishedBody: null,
      file: '',
    });
    setDraft(body);
    setTab('edit');
  };
  const setStatus = (status: 'reviewed' | 'published') =>
    run(async () => {
      if (!entry) return null;
      const next = await api.status(collection, entry.entityId, status);
      setEntry(next);
      refreshList();
      return `${entry.entityId} is ${status}`;
    });
  const loadAnalysis = () =>
    run(async () => {
      setAnalysis(await api.analysis());
      return null;
    });

  return (
    <div className="studio">
      <header>
        <strong>MRAK Studio</strong>
        <nav>
          {(['edit', 'graph', 'villagers', 'mysteries', 'analysis', 'telemetry'] as Tab[]).map(
            (t) => (
              <button
                key={t}
                type="button"
                className={tab === t ? 'on' : ''}
                onClick={() => {
                  setTab(t);
                  if (t !== 'edit' && t !== 'telemetry' && !analysis) void loadAnalysis();
                }}
              >
                {t}
              </button>
            ),
          )}
        </nav>
        <span className="spacer" />
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await api.import();
              refreshList();
              refreshIds();
              return `Imported: ${String(r.created)} new, ${String(r.updated)} updated, ${String(r.unchanged)} unchanged`;
            })
          }
        >
          Import from repo
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await api.export();
              return `Exported pack v${r.version} (hash ${r.hash.slice(0, 12)}…): ${String(r.written.length)} files written. Demo ${String(r.demo.bytes)} B, full ${String(r.full.bytes)} B. Reload the game to see it.`;
            })
          }
        >
          Export to game
        </button>
      </header>
      {notice && (
        <p className={notice.bad ? 'notice bad' : 'notice'} role={notice.bad ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
      <main>
        <aside>
          <select
            value={collection}
            onChange={(e) => {
              setCollection(e.target.value);
              setEntry(null);
            }}
          >
            {collections.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input
            placeholder="filter ids"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
          />
          <button type="button" onClick={createNew}>
            + New {collection}
          </button>
          <ul className="entries">
            {visible.slice(0, 500).map((e) => (
              <li key={e.entityId} className={entry?.entityId === e.entityId ? 'on' : ''}>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    open(collection, e.entityId);
                  }}
                >
                  {e.entityId}
                </button>
                <span className={`badge ${e.deleted ? 'deleted' : e.status}`}>
                  {e.deleted ? 'deleted' : e.status}
                </span>
              </li>
            ))}
          </ul>
        </aside>
        <section className="content">
          {tab === 'edit' &&
            (entry && entitySchema ? (
              <div className="editor">
                <div className="toolbar">
                  <h2>
                    {collection}/{entry.entityId}
                  </h2>
                  <span className={`badge ${entry.status}`}>{entry.status}</span>
                  <span className="muted">
                    v{entry.version} · {entry.updatedBy}
                  </span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !dirty}
                    onClick={() => void save()}
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    disabled={busy || dirty || entry.status !== 'draft' || entry.version === 0}
                    onClick={() => void setStatus('reviewed')}
                  >
                    Mark reviewed
                  </button>
                  <button
                    type="button"
                    disabled={busy || dirty || entry.status !== 'reviewed'}
                    onClick={() => void setStatus('published')}
                  >
                    Publish
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || entry.version === 0}
                    onClick={() =>
                      void run(async () => {
                        if (
                          !window.confirm(`Delete ${entry.entityId}? (takes effect when published)`)
                        )
                          return null;
                        setEntry(await api.remove(collection, entry.entityId));
                        refreshList();
                        return 'Marked deleted (draft)';
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
                <Field schema={entitySchema} value={draft} onChange={setDraft} ctx={ctx} />
                {entry.version > 0 && (
                  <History collection={collection} id={entry.entityId} version={entry.version} />
                )}
              </div>
            ) : (
              <p className="muted">
                Choose an entry, or create one. Import from the repo first if the list is empty.
              </p>
            ))}
          {tab === 'telemetry' && <TelemetryPanel />}
          {tab !== 'edit' && tab !== 'telemetry' && (
            <div className="toolbar">
              <button type="button" disabled={busy} onClick={() => void loadAnalysis()}>
                Refresh analysis
              </button>
            </div>
          )}
          {analysis && tab === 'graph' && <DependencyGraph analysis={analysis} onOpen={open} />}
          {analysis && tab === 'villagers' && <Villagers analysis={analysis} onOpen={open} />}
          {analysis && tab === 'mysteries' && <Mysteries analysis={analysis} onOpen={open} />}
          {analysis && tab === 'analysis' && <AnalysisPanel analysis={analysis} onOpen={open} />}
        </section>
      </main>
    </div>
  );
}
