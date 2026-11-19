/**
 * Player hub (docs/ui/player-hub.md): who the guardian is, where the chronicle stands and the way
 * back into it; account settings live in tabs below.
 */
import {
  createStoreClient,
  type AccountSession,
  type AccountUser,
  type Entitlement,
} from '@mrak/api-client';
import { symbolHref } from '@mrak/ui-kit';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { writePlayer, type Edition } from './session';
import {
  account,
  errorKey,
  Notice,
  PasswordStrength,
  StringsProvider,
  useT,
  type IslandProps,
} from './shared';

interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  hidden: boolean;
}

interface SaveMeta {
  savedAt: string;
  gameDate: { year: number; month: number; day: number; minute: number };
  zone: string | null;
  generation: number;
  playtimeMs: number;
}
interface SaveInfo {
  slot: string;
  meta: SaveMeta;
}

interface GuardianView {
  nameKey: string | null;
  calling: string | null;
  attributes: [string, number][];
  stats: [string, number][];
  deeds: [string, number][];
  talents: number;
  bloodline: number;
}

const ATTRIBUTES = ['vigor', 'agility', 'wits', 'cunning', 'presence', 'resolve'];
const STATS = ['sanity', 'faith', 'revelation'];
const DEEDS = ['chapters', 'mysteries', 'buildings', 'routes'];
const TABS = ['overview', 'achievements', 'purchases', 'security', 'privacy'] as const;
type Tab = (typeof TABS)[number];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The serving guardian from a save's JSON; defensive: anything missing is left out. */
export function readGuardian(data: string): GuardianView | null {
  let state: Record<string, unknown>;
  try {
    state = rec(rec(JSON.parse(data))['state']);
  } catch {
    return null;
  }
  const guardian = rec(state['guardian']);
  const lineage = rec(state['lineage']);
  const people = rec(state['village'])['people'];
  const id = lineage['guardian'];
  const person = Array.isArray(people)
    ? (people as unknown[]).map(rec).find((p) => p['id'] === id)
    : undefined;
  const attrs = rec(guardian['attributes']);
  const stats = rec(state['stats']);
  const deeds = rec(lineage['deeds']);
  const pick = (keys: string[], from: Record<string, unknown>): [string, number][] =>
    keys.flatMap((k) => {
      const v = num(from[k]);
      return v === null ? [] : [[k, v] as [string, number]];
    });
  const calling = guardian['callingId'] ?? person?.['calling'];
  return {
    nameKey: typeof person?.['nameKey'] === 'string' ? person['nameKey'] : null,
    calling: typeof calling === 'string' ? calling : null,
    attributes: pick(ATTRIBUTES, attrs),
    stats: pick(STATS, stats),
    deeds: pick(DEEDS, deeds),
    talents: Array.isArray(guardian['talents']) ? guardian['talents'].length : 0,
    bloodline: Array.isArray(lineage['bloodline']) ? lineage['bloodline'].length : 0,
  };
}

function editionOf(owned: Entitlement[]): Edition {
  const active = new Set(owned.filter((e) => e.status === 'active').map((e) => e.sku));
  if (active.has('collector')) return 'collector';
  if (active.has('full-game')) return 'full-game';
  return 'demo';
}

function Section({
  id,
  title,
  icon,
  children,
  danger = false,
  className = '',
}: {
  id: string;
  title: string;
  icon: string;
  children: ReactNode;
  danger?: boolean;
  className?: string;
}) {
  return (
    <section
      className={`card ${danger ? 'danger-zone' : ''} ${className}`.trim()}
      aria-labelledby={id}
    >
      <h2 id={id}>
        <svg className="icon" aria-hidden="true">
          <use href={symbolHref(icon as Parameters<typeof symbolHref>[0])} />
        </svg>{' '}
        {title}
      </h2>
      {children}
    </section>
  );
}

const field = (form: HTMLFormElement, name: string): string =>
  (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function AccountPage({ config, props }: IslandProps) {
  const t = useT();
  const api = account(config.apiUrl);
  const defs = (props['achievements'] ?? []) as AchievementDef[];
  const names = (props['names'] ?? {}) as Record<string, string>;
  const game = (key: string, fallback: string): string => names[key] ?? fallback;
  const [user, setUser] = useState<AccountUser | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [unlocked, setUnlocked] = useState<Map<string, number>>(new Map());
  const [msg, setMsg] = useState<Record<string, { text: string; bad: boolean } | null>>({});
  const [newPassword, setNewPassword] = useState('');
  const [owned, setOwned] = useState<Entitlement[]>([]);
  const [latest, setLatest] = useState<SaveInfo | null>(null);
  const [guardian, setGuardian] = useState<GuardianView | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const hash = window.location.hash.slice(1);
    return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : 'overview';
  });
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const say = (where: string, text: string | null, bad = false): void => {
    setMsg((m) => ({ ...m, [where]: text === null ? null : { text, bad } }));
  };

  const loadChronicle = useCallback(async () => {
    try {
      const res = await api.request('/v1/saves');
      const { saves } = (await res.json()) as { saves: SaveInfo[] };
      const newest = [...saves].sort((a, b) => b.meta.savedAt.localeCompare(a.meta.savedAt))[0];
      setLatest(newest ?? null);
      if (!newest) return;
      const one = await api.request(`/v1/saves/${encodeURIComponent(newest.slot)}`);
      const body = (await one.json()) as { data?: string };
      setGuardian(body.data ? readGuardian(body.data) : null);
    } catch {
      setLatest(null); // unverified accounts have no cloud saves yet
    }
  }, [api]);

  const load = useCallback(async () => {
    const me = await api.me();
    setUser(me);
    const ents = await createStoreClient(api)
      .entitlements()
      .catch(() => []);
    setOwned(ents);
    writePlayer({ name: me.displayName, edition: editionOf(ents) });
    setSessions(await api.sessions());
    try {
      const res = await api.request('/v1/achievements');
      const body = (await res.json()) as { achievements: { id: string; at: number }[] };
      setUnlocked(new Map(body.achievements.map((a) => [a.id, a.at])));
    } catch {
      setUnlocked(new Map());
    }
    await loadChronicle();
  }, [api, loadChronicle]);

  useEffect(() => {
    void api.resume().then(async (ok) => {
      if (!ok) {
        writePlayer(null);
        window.location.replace('/login/?next=/account/');
        return;
      }
      await load();
    });
  }, [api, load]);

  if (!user) return <p role="status">{t('site.common.working')}</p>;

  const busy = (where: string, work: () => Promise<void>): void => {
    say(where, null);
    work().catch((err: unknown) => {
      say(where, t(errorKey(err)), true);
    });
  };
  const logout = (): void => {
    writePlayer(null);
    void api.logout().finally(() => {
      window.location.assign('/');
    });
  };
  const edition = editionOf(owned);
  const count = defs.filter((d) => unlocked.has(d.id)).length;
  const recent = [...unlocked.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, at]) => ({ def: defs.find((d) => d.id === id), at }))
    .filter((r) => r.def);
  const play = (intent: 'continue' | 'new'): string => {
    const url = new URL(config.playUrl, window.location.href);
    url.searchParams.set('play', intent);
    return url.href;
  };
  const choose = (next: Tab): void => {
    setTab(next);
    history.replaceState(null, '', next === 'overview' ? ' ' : `#${next}`);
    tabRefs.current[next]?.focus();
  };
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = TABS.indexOf(tab);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    choose(TABS[(i + step + TABS.length) % TABS.length] ?? 'overview');
  };

  const meta = latest?.meta;
  const date = meta
    ? new Date(Date.UTC(meta.gameDate.year, meta.gameDate.month - 1, meta.gameDate.day))
    : null;
  const hours = meta ? Math.floor(meta.playtimeMs / 3_600_000) : 0;
  const minutes = meta ? Math.floor((meta.playtimeMs % 3_600_000) / 60_000) : 0;
  const guardianName = guardian?.nameKey ? game(guardian.nameKey, '') : '';
  const callingName = guardian?.calling
    ? game(`calling.${guardian.calling}.name`, guardian.calling)
    : '';

  const overview = (
    <div className="hub-grid">
      <Section id="chronicle" title={t('site.hub.chronicle')} icon="ui.save" className="hub-main">
        {meta && date ? (
          <>
            <p className="hub-lead">
              {t('site.hub.when', {
                date: date.toLocaleDateString('en', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                }),
                time: clock(meta.gameDate.minute),
              })}
            </p>
            <ul className="facts">
              {meta.zone && (
                <li>{t('site.hub.where', { place: game(`zone.${meta.zone}.name`, meta.zone) })}</li>
              )}
              <li>{t('site.hub.generation', { n: meta.generation })}</li>
              <li>{t('site.hub.playtime', { hours, minutes })}</li>
              <li>
                {t('site.hub.last-played', {
                  date: new Date(meta.savedAt).toLocaleString('en', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })}
              </li>
            </ul>
            <p className="row">
              <a className="mrak-button cta" data-variant="primary" href={play('continue')}>
                {t('site.hub.resume')}
              </a>
              <a className="mrak-button" href={play('new')}>
                {t('site.hub.new')}
              </a>
            </p>
          </>
        ) : (
          <>
            <p className="hub-lead">{t('site.hub.begin')}</p>
            <p className="muted">{t('site.hub.begin-text')}</p>
            <p className="row">
              <a className="mrak-button cta" data-variant="primary" href={play('new')}>
                {t('site.hub.new')}
              </a>
            </p>
          </>
        )}
      </Section>

      <Section id="guardian" title={t('site.hub.guardian')} icon="ui.character">
        {guardian ? (
          <>
            <p className="hub-lead">
              {guardianName}
              {guardianName && callingName ? ' · ' : ''}
              {callingName}
            </p>
            {guardian.attributes.length > 0 && (
              <>
                <h3>{t('site.hub.attributes')}</h3>
                <dl className="stat-grid" data-testid="attributes">
                  {guardian.attributes.map(([k, v]) => (
                    <div key={k}>
                      <dt>{game(`attribute.${k}.name`, k)}</dt>
                      <dd>
                        <span className="pips" aria-hidden="true">
                          {'●'.repeat(v)}
                          <span className="pips-off">{'○'.repeat(Math.max(0, 6 - v))}</span>
                        </span>{' '}
                        {v}/6
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {guardian.stats.length > 0 && (
              <>
                <h3>{t('site.hub.condition')}</h3>
                <dl className="stat-grid">
                  {guardian.stats.map(([k, v]) => (
                    <div key={k}>
                      <dt>{game(`stat.${k}.name`, k)}</dt>
                      <dd>{Math.round(v)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>{t('site.hub.talents')}</dt>
                    <dd>{guardian.talents}</dd>
                  </div>
                  <div>
                    <dt>{t('site.hub.bloodline')}</dt>
                    <dd>{guardian.bloodline}</dd>
                  </div>
                </dl>
              </>
            )}
            {guardian.deeds.length > 0 && (
              <>
                <h3>{t('site.hub.deeds')}</h3>
                <dl className="stat-grid">
                  {guardian.deeds.map(([k, v]) => (
                    <div key={k}>
                      <dt>{t(`site.hub.deed.${k}`)}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </>
        ) : (
          <p className="muted">{t('site.hub.guardian-none')}</p>
        )}
      </Section>

      <Section id="progress" title={t('site.hub.progress')} icon="ui.achievements">
        <div className="progress">
          <p>{t('site.account.achievements-count', { have: count, total: defs.length })}</p>
          <progress
            value={count}
            max={Math.max(defs.length, 1)}
            aria-label={t('site.account.achievements')}
          />
        </div>
        <h3>{t('site.hub.recent')}</h3>
        {recent.length === 0 ? (
          <p className="muted">{t('site.hub.none-yet')}</p>
        ) : (
          <ul className="list compact">
            {recent.map(({ def, at }) => (
              <li key={def?.id} className="achievement">
                <svg className="icon" aria-hidden="true">
                  <use href={symbolHref('ui.achievements')} />
                </svg>
                <span>
                  <strong>{def?.name}</strong>
                  <br />
                  <span className="muted">{new Date(at).toLocaleDateString('en')}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="link-button"
          onClick={() => {
            choose('achievements');
          }}
        >
          {t('site.hub.see-all')}
        </button>
      </Section>

      <Section id="edition" title={t('site.hub.edition-title')} icon="resource.coin">
        <p className="hub-lead">{t(`site.hub.edition.${edition}`)}</p>
        <p className="muted">
          {edition === 'demo' ? t('site.hub.demo-text') : t('site.hub.full-text')}
        </p>
        {edition === 'demo' && (
          <p className="row">
            <a className="mrak-button" data-variant="primary" href="/buy/">
              {t('site.hub.get-full')}
            </a>
          </p>
        )}
      </Section>
    </div>
  );

  const achievements = (
    <Section id="achievements" title={t('site.account.achievements')} icon="ui.achievements">
      <div className="progress">
        <p>{t('site.account.achievements-count', { have: count, total: defs.length })}</p>
        <progress
          value={count}
          max={Math.max(defs.length, 1)}
          aria-label={t('site.account.achievements')}
        />
      </div>
      <ul className="list achievements-grid" data-testid="achievements">
        {defs.map((d) => {
          const at = unlocked.get(d.id);
          const secret = d.hidden && at === undefined;
          return (
            <li key={d.id} className={at === undefined ? 'achievement locked' : 'achievement'}>
              <svg className="icon-lg" aria-hidden="true">
                <use href={symbolHref(at === undefined ? 'ui.locked' : 'ui.achievements')} />
              </svg>
              <span>
                <strong>{secret ? '???' : d.name}</strong>
                <br />
                <span className="muted">{secret ? t('site.account.hidden') : d.desc}</span>
                {at !== undefined && (
                  <>
                    <br />
                    <span className="muted">
                      {t('site.account.unlocked-on', {
                        date: new Date(at).toLocaleDateString('en'),
                      })}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );

  const purchases = (
    <Section id="purchases" title={t('site.account.purchases')} icon="resource.coin">
      {owned.length === 0 ? (
        <p className="muted">{t('site.account.no-purchases')}</p>
      ) : (
        <ul className="list" data-testid="purchases">
          {owned.map((e) => (
            <li key={`${e.sku}:${e.purchasedAt}`}>
              {t(`site.store.sku.${e.sku}`)} · {new Date(e.purchasedAt).toLocaleDateString('en')} ·{' '}
              {t(`site.store.status.${e.status}`)}
            </li>
          ))}
        </ul>
      )}
      {edition === 'collector' && (
        <form
          className="form row"
          onSubmit={(e: SyntheticEvent<HTMLFormElement>) => {
            e.preventDefault();
            const name = field(e.currentTarget, 'villager').trim();
            busy('purchases', async () => {
              await createStoreClient(api).collectorName(name);
              say('purchases', t('site.store.name-pending'));
            });
          }}
        >
          <label className="field">
            <span>{t('site.store.villager-name')}</span>
            <input name="villager" required minLength={2} maxLength={32} />
          </label>
          <button type="submit" className="mrak-button">
            {t('site.account.save')}
          </button>
        </form>
      )}
      <Notice text={msg['purchases']?.text ?? null} bad={msg['purchases']?.bad ?? false} />
    </Section>
  );

  const security = (
    <div className="hub-stack">
      <Section id="profile" title={t('site.account.profile')} icon="ui.character">
        <p>{t('site.account.email', { email: user.email })}</p>
        <p>{user.emailVerified ? t('site.account.verified') : t('site.account.unverified')}</p>
        <form
          className="form row"
          onSubmit={(e: SyntheticEvent<HTMLFormElement>) => {
            e.preventDefault();
            const name = field(e.currentTarget, 'displayName').trim();
            busy('profile', async () => {
              const me = await api.updateMe({ displayName: name || null });
              setUser(me);
              writePlayer({ name: me.displayName, edition });
              say('profile', t('site.account.saved'));
            });
          }}
        >
          <label className="field">
            <span>{t('site.form.display-name')}</span>
            <input
              name="displayName"
              defaultValue={user.displayName ?? ''}
              minLength={3}
              maxLength={24}
            />
          </label>
          <button type="submit" className="mrak-button">
            {t('site.account.save')}
          </button>
        </form>
        <Notice text={msg['profile']?.text ?? null} bad={msg['profile']?.bad ?? false} />
      </Section>

      <Section id="password" title={t('site.account.change-password')} icon="ui.locked">
        <form
          className="form"
          onSubmit={(e: SyntheticEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = e.currentTarget;
            const current = field(form, 'current');
            const next = field(form, 'password');
            form.reset();
            setNewPassword('');
            busy('password', async () => {
              await api.changePassword(current, next);
              writePlayer(null);
              window.location.assign('/login/?changed=1');
            });
          }}
        >
          <label className="field">
            <span>{t('site.form.current-password')}</span>
            <input
              type="password"
              name="current"
              required
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
          <label className="field">
            <span>{t('site.form.new-password')}</span>
            <input
              type="password"
              name="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              onChange={(e) => {
                setNewPassword(e.target.value);
              }}
            />
          </label>
          <PasswordStrength password={newPassword} inputs={[user.email]} />
          <p className="muted">{t('site.account.password-note')}</p>
          <button type="submit" className="mrak-button">
            {t('site.account.change-password')}
          </button>
        </form>
        <Notice text={msg['password']?.text ?? null} bad={msg['password']?.bad ?? false} />
      </Section>

      <Section id="sessions" title={t('site.account.sessions')} icon="ui.keyboard">
        <ul className="list" data-testid="sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              <span>
                {t(`site.account.platform.${s.platform}`)} ·{' '}
                {t('site.account.last-used', { date: new Date(s.lastUsedAt).toLocaleString('en') })}
                {s.current && <strong> · {t('site.account.this-session')}</strong>}
              </span>
              {!s.current && (
                <button
                  type="button"
                  className="mrak-button"
                  onClick={() => {
                    busy('sessions', async () => {
                      await api.revokeSession(s.id);
                      setSessions(await api.sessions());
                    });
                  }}
                >
                  {t('site.account.sign-out-one')}
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mrak-button"
          onClick={() => {
            busy('sessions', async () => {
              await api.logoutAll();
              writePlayer(null);
              window.location.assign('/login/');
            });
          }}
        >
          {t('site.account.sign-out-all')}
        </button>
        <Notice text={msg['sessions']?.text ?? null} bad={msg['sessions']?.bad ?? false} />
      </Section>
    </div>
  );

  const privacy = (
    <div className="hub-stack">
      <Section id="data" title={t('site.account.data')} icon="ui.save">
        <p>{t('site.account.export-text')}</p>
        <button
          type="button"
          className="mrak-button"
          onClick={() => {
            busy('data', async () => {
              const data = await api.exportData();
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = 'mrak-account.json';
              a.click();
              URL.revokeObjectURL(url);
            });
          }}
        >
          {t('site.account.export')}
        </button>
        <Notice text={msg['data']?.text ?? null} bad={msg['data']?.bad ?? false} />
      </Section>

      <Section id="delete" title={t('site.account.delete')} icon="ui.irreversible" danger>
        <p>{t('site.account.delete-text')}</p>
        <form
          className="form"
          onSubmit={(e: SyntheticEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = e.currentTarget;
            const password = field(form, 'password');
            form.reset();
            busy('delete', async () => {
              await api.deleteAccount(password);
              writePlayer(null);
              window.location.assign('/?deleted=1');
            });
          }}
        >
          <label className="field">
            <span>{t('site.form.password')}</span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
          <label className="field">
            <span>{t('site.account.delete-confirm')}</span>
            <input name="confirm" required pattern="DELETE" autoComplete="off" />
          </label>
          <button type="submit" className="mrak-button" data-variant="danger">
            {t('site.account.delete')}
          </button>
        </form>
        <Notice text={msg['delete']?.text ?? null} bad={msg['delete']?.bad ?? false} />
      </Section>
    </div>
  );

  const panels: Record<Tab, ReactNode> = {
    overview,
    achievements,
    purchases,
    security,
    privacy,
  };

  return (
    <div className="hub">
      <header className="hub-header">
        <div>
          <h1>
            {user.displayName
              ? t('site.hub.welcome', { name: user.displayName })
              : t('site.hub.welcome-anon')}
          </h1>
          <p>
            <span className="badge" data-edition={edition}>
              {t(`site.hub.edition.${edition}`)}
            </span>
            {!user.emailVerified && <span className="muted"> {t('site.account.unverified')}</span>}
          </p>
        </div>
        <button type="button" className="mrak-button" onClick={logout}>
          {t('site.account.logout')}
        </button>
      </header>

      <div className="tabs" role="tablist" aria-label={t('site.hub.tabs')} onKeyDown={onTabKey}>
        {TABS.map((id) => (
          <button
            key={id}
            ref={(el) => {
              tabRefs.current[id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => {
              choose(id);
            }}
          >
            {t(`site.hub.tab.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {panels[tab]}
      </div>
    </div>
  );
}

export default function Account(p: IslandProps) {
  return (
    <StringsProvider strings={p.strings}>
      <AccountPage {...p} />
    </StringsProvider>
  );
}
