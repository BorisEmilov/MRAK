import {
  createStoreClient,
  type AccountSession,
  type AccountUser,
  type Entitlement,
} from '@mrak/api-client';
import { symbolHref } from '@mrak/ui-kit';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
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

function Section({
  id,
  title,
  icon,
  children,
  danger = false,
}: {
  id: string;
  title: string;
  icon: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section className={danger ? 'card danger-zone' : 'card'} aria-labelledby={id}>
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

function AccountPage({ config, props }: IslandProps) {
  const t = useT();
  const api = account(config.apiUrl);
  const defs = (props['achievements'] ?? []) as AchievementDef[];
  const [user, setUser] = useState<AccountUser | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [unlocked, setUnlocked] = useState<Map<string, number>>(new Map());
  const [msg, setMsg] = useState<Record<string, { text: string; bad: boolean } | null>>({});
  const [newPassword, setNewPassword] = useState('');
  const [owned, setOwned] = useState<Entitlement[]>([]);
  const say = (where: string, text: string | null, bad = false): void => {
    setMsg((m) => ({ ...m, [where]: text === null ? null : { text, bad } }));
  };

  const load = useCallback(async () => {
    setUser(await api.me());
    setSessions(await api.sessions());
    setOwned(
      await createStoreClient(api)
        .entitlements()
        .catch(() => []),
    );
    try {
      const res = await api.request('/v1/achievements');
      const body = (await res.json()) as { achievements: { id: string; at: number }[] };
      setUnlocked(new Map(body.achievements.map((a) => [a.id, a.at])));
    } catch {
      setUnlocked(new Map()); // unverified accounts have no synced achievements yet
    }
  }, [api]);

  useEffect(() => {
    void api.resume().then(async (ok) => {
      if (!ok) {
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
  const count = defs.filter((d) => unlocked.has(d.id)).length;

  return (
    <div className="account-grid">
      <Section id="profile" title={t('site.account.profile')} icon="ui.character">
        <p>{t('site.account.email', { email: user.email })}</p>
        <p>{user.emailVerified ? t('site.account.verified') : t('site.account.unverified')}</p>
        <form
          className="form row"
          onSubmit={(e: SyntheticEvent<HTMLFormElement>) => {
            e.preventDefault();
            const name = field(e.currentTarget, 'displayName').trim();
            busy('profile', async () => {
              setUser(await api.updateMe({ displayName: name || null }));
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
        <p className="row">
          <a className="mrak-button" data-variant="primary" href={config.playUrl}>
            {t('site.home.play')}
          </a>
          <button
            type="button"
            className="mrak-button"
            onClick={() => {
              void api.logout().finally(() => {
                window.location.assign('/');
              });
            }}
          >
            {t('site.account.logout')}
          </button>
        </p>
      </Section>

      <Section id="achievements" title={t('site.account.achievements')} icon="ui.achievements">
        <div className="progress">
          <p>{t('site.account.achievements-count', { have: count, total: defs.length })}</p>
          <progress
            value={count}
            max={Math.max(defs.length, 1)}
            aria-label={t('site.account.achievements')}
          />
        </div>
        <ul className="list" data-testid="achievements">
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
              window.location.assign('/login/');
            });
          }}
        >
          {t('site.account.sign-out-all')}
        </button>
        <Notice text={msg['sessions']?.text ?? null} bad={msg['sessions']?.bad ?? false} />
      </Section>

      <Section id="purchases" title={t('site.account.purchases')} icon="resource.coin">
        {owned.length === 0 ? (
          <p className="muted">{t('site.account.no-purchases')}</p>
        ) : (
          <ul className="list" data-testid="purchases">
            {owned.map((e) => (
              <li key={`${e.sku}:${e.purchasedAt}`}>
                {t(`site.store.sku.${e.sku}`)} · {new Date(e.purchasedAt).toLocaleDateString('en')}{' '}
                · {t(`site.store.status.${e.status}`)}
              </li>
            ))}
          </ul>
        )}
        {owned.some((e) => e.sku === 'collector' && e.status === 'active') && (
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
}

export default function Account(p: IslandProps) {
  return (
    <StringsProvider strings={p.strings}>
      <AccountPage {...p} />
    </StringsProvider>
  );
}
