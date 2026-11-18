/**
 * Online UI (docs/systems/save-system.md → Cloud, ADR 0009): sync status, save conflicts, the
 * guest → account upload offer, account invitations, cloud saves on the load screen and the
 * Turnstile widget. Everything is optional: without online services nothing renders.
 */
import { ApiError, createStoreClient, type CloudSaveInfo } from '@mrak/api-client';
import type { LocaleKey } from '@mrak/content';
import { Icon, Modal, type IconName } from '@mrak/ui-kit';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/t';
import { downloadFullPack } from '../../online/full-game';
import { declineMigration, migrateGuest, neverInvite } from '../../online/wire';
import { useApp, useUi } from '../../state/hooks';
import type { CloudStatus, SyncConflict } from '../../storage/cloud-sync';
import type { SaveEntry } from '../../storage/save-store';
import { formatDate, formatPlaytime, formatTime } from '../format';
import { realTime } from '../menu/SaveLabels';

const localStorageSafe = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const STATUS: Record<Exclude<CloudStatus, 'disabled'>, { icon: IconName; key: LocaleKey }> = {
  'signed-out': { icon: 'ui.locked', key: 'cloud.status.signed-out' },
  synced: { icon: 'ui.check', key: 'cloud.status.synced' },
  pending: { icon: 'ui.sync-pending', key: 'cloud.status.pending' },
  offline: { icon: 'ui.sync-offline', key: 'cloud.status.offline' },
  conflict: { icon: 'ui.sync-conflict', key: 'cloud.status.conflict' },
  error: { icon: 'ui.warning', key: 'cloud.status.error' },
};

/** Icon + label of the cloud save state; a conflict opens the resolution dialog. */
export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const status = useUi((s) => s.cloud.status);
  const { store } = useApp();
  if (status === 'disabled') return null;
  const s = STATUS[status];
  const label = t(s.key);
  const body = (
    <>
      <Icon name={s.icon} size={20} decorative />
      {compact ? <span className="mrak-sr-only">{label}</span> : <span>{label}</span>}
    </>
  );
  return status === 'conflict' ? (
    <button
      type="button"
      className={`sync-status ${status}`}
      title={t('cloud.resolve')}
      onClick={() => {
        store.setState({ conflictOpen: true });
      }}
    >
      {body}
    </button>
  ) : (
    <span className={`sync-status ${status}`} role="status" aria-live="polite" title={label}>
      {body}
    </span>
  );
}

function SaveSummary({
  title,
  meta,
}: {
  title: string;
  meta: Pick<SaveEntry, 'gameDate' | 'zone' | 'playtimeMs' | 'savedAt' | 'thumbnail'>;
}) {
  const { host } = useApp();
  const zone = meta.zone ? host.content.find('zones', meta.zone) : undefined;
  const zoneName = zone ? t(zone.nameKey as LocaleKey) : '';
  return (
    <div className="conflict-side">
      <h3>{title}</h3>
      {meta.thumbnail ? (
        <img
          className="save-thumb"
          src={meta.thumbnail}
          alt={t('load.thumbnail-alt', { zone: zoneName })}
          width={192}
          height={108}
        />
      ) : (
        <span className="save-thumb save-thumb-empty">{t('load.no-thumbnail')}</span>
      )}
      <dl>
        <dt>{t('cloud.in-game')}</dt>
        <dd>
          {formatDate(meta.gameDate)} · {formatTime(meta.gameDate.minute)}
        </dd>
        <dt>{t('cloud.zone')}</dt>
        <dd>{zoneName || '—'}</dd>
        <dt>{t('cloud.playtime')}</dt>
        <dd>{formatPlaytime(meta.playtimeMs)}</dd>
        <dt>{t('cloud.saved')}</dt>
        <dd>{realTime(meta.savedAt)}</dd>
      </dl>
    </div>
  );
}

function ConflictChoice({ conflict }: { conflict: SyncConflict }) {
  const { online, host } = useApp();
  const [busy, setBusy] = useState(false);
  const choose = (keep: 'local' | 'cloud'): void => {
    if (!online) return;
    setBusy(true);
    void online.saves
      .resolve(conflict.slot, keep)
      .then(() => host.refreshSaves())
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <section className="conflict" aria-label={t(`save.${conflict.slot}` as LocaleKey)}>
      <h3>{t(`save.${conflict.slot}` as LocaleKey)}</h3>
      <div className="conflict-sides">
        <SaveSummary title={t('cloud.this-device')} meta={conflict.local} />
        {conflict.cloud ? (
          <SaveSummary title={t('cloud.account')} meta={conflict.cloud.meta} />
        ) : (
          <p className="muted">{t('cloud.deleted-in-cloud')}</p>
        )}
      </div>
      <p className="muted">
        <Icon name="ui.irreversible" size={16} decorative /> {t('cloud.choice-warning')}
      </p>
      <div className="row">
        <button
          type="button"
          className="mrak-button"
          disabled={busy}
          onClick={() => {
            choose('local');
          }}
        >
          {t('cloud.keep-device')}
        </button>
        <button
          type="button"
          className="mrak-button"
          disabled={busy || !conflict.cloud}
          onClick={() => {
            choose('cloud');
          }}
        >
          {t('cloud.keep-cloud')}
        </button>
      </div>
    </section>
  );
}

/** Both versions side by side; the player chooses. Nothing is replaced before that. */
export function ConflictDialog() {
  const conflicts = useUi((s) => s.cloud.conflicts);
  const open = useUi((s) => s.conflictOpen);
  const screen = useUi((s) => s.screen);
  const { store } = useApp();
  const close = (): void => {
    store.setState({ conflictOpen: false });
  };
  // On the menu a new conflict asks right away; in the world only the status icon shows it.
  useEffect(() => {
    if (conflicts.length > 0 && screen === 'menu') store.setState({ conflictOpen: true });
    if (conflicts.length === 0) store.setState({ conflictOpen: false });
  }, [conflicts.length, screen, store]);
  return (
    <Modal
      open={open && conflicts.length > 0}
      title={t('cloud.conflict-title')}
      onClose={close}
      size="lg"
    >
      <p>{t('cloud.conflict-intro')}</p>
      {conflicts.map((c) => (
        <ConflictChoice key={c.slot} conflict={c} />
      ))}
    </Modal>
  );
}

/** After signing in on a device with guest progress: upload it (nothing is lost). */
export function MigrationDialog() {
  const offer = useUi((s) => s.migrationOffer);
  const saves = useUi((s) => s.saves.length);
  const achievements = useUi((s) => s.profile.achievements.length);
  const { online, host, store } = useApp();
  const [busy, setBusy] = useState(false);
  if (!online) return null;
  return (
    <Modal
      open={offer}
      title={t('cloud.migrate-title')}
      onClose={() => {
        declineMigration(online, store, localStorageSafe());
      }}
      footer={
        <>
          <button
            type="button"
            className="mrak-button"
            data-variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void migrateGuest(online, host, store, localStorageSafe()).finally(() => {
                setBusy(false);
              });
            }}
          >
            {t('cloud.migrate-upload')}
          </button>
          <button
            type="button"
            className="mrak-button"
            disabled={busy}
            onClick={() => {
              declineMigration(online, store, localStorageSafe());
            }}
          >
            {t('cloud.migrate-later')}
          </button>
        </>
      }
    >
      <p>{t('cloud.migrate-body', { saves, achievements })}</p>
      <p className="muted">{t('cloud.migrate-safe')}</p>
    </Modal>
  );
}

const SITE_URL =
  (import.meta.env as Record<string, string | undefined>)['VITE_SITE_URL'] ?? 'https://mrak.game';

/**
 * End of the free demo (docs/systems/store.md): what the full game adds, the purchase on the
 * website, then the download of the full pack. The save is kept: after the reload, Continue
 * resumes it with the full content.
 */
export function DemoEnd() {
  const open = useUi((s) => s.demoEnd);
  const account = useUi((s) => s.account);
  const { online, host, store } = useApp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<LocaleKey | null>(null);
  const close = (): void => {
    store.setState({ demoEnd: false });
  };
  const unlock = (): void => {
    if (!online) return;
    setBusy(true);
    setMessage(null);
    void downloadFullPack(createStoreClient(online.account))
      .then(async () => {
        await host.checkpoint('suspend');
        window.location.reload();
      })
      .catch((err: unknown) => {
        setMessage(
          err instanceof ApiError && err.status === 403
            ? 'store.not-owned'
            : 'store.download-failed',
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <Modal
      open={open}
      title={t('store.demo-end.title')}
      onClose={close}
      footer={
        <>
          <a
            className="mrak-button"
            data-variant="primary"
            href={`${SITE_URL}/buy/`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('store.buy')}
          </a>
          {online && account && (
            <button type="button" className="mrak-button" disabled={busy} onClick={unlock}>
              {t(busy ? 'store.downloading' : 'store.unlock')}
            </button>
          )}
          <button type="button" className="mrak-button" onClick={close}>
            {t('store.keep-demo')}
          </button>
        </>
      }
    >
      <p>{t('store.demo-end.body')}</p>
      <ul>
        <li>{t('store.value.callings')}</li>
        <li>{t('store.value.zones')}</li>
        <li>{t('store.value.trees')}</li>
        <li>{t('store.value.chronicle')}</li>
      </ul>
      <p className="muted">{t('store.value.fair')}</p>
      <p className="muted">{t(online && !account ? 'store.sign-in-first' : 'store.save-kept')}</p>
      {message && <p role="alert">{t(message)}</p>}
    </Modal>
  );
}

/** Non-intrusive card; never shown to signed-in players or after "don't show again". */
export function AccountInvite() {
  const invite = useUi((s) => s.accountInvite);
  const account = useUi((s) => s.account);
  const { online, store } = useApp();
  if (!online || !invite || account) return null;
  const dismiss = (): void => {
    store.setState({ accountInvite: null });
  };
  return (
    <aside className="account-invite mrak-panel" aria-labelledby="account-invite-title">
      <h3 id="account-invite-title">
        <Icon name="ui.cloud" size={20} decorative /> {t('cloud.invite-title')}
      </h3>
      <p>{t(invite === 'prologue' ? 'cloud.invite-prologue' : 'cloud.invite-achievement')}</p>
      <div className="row">
        <button
          type="button"
          className="mrak-button small"
          data-variant="primary"
          onClick={() => {
            store.setState({ accountInvite: null, menuPanel: 'account' });
          }}
        >
          {t('cloud.invite-create')}
        </button>
        <button type="button" className="mrak-button small" onClick={dismiss}>
          {t('cloud.invite-later')}
        </button>
        <button
          type="button"
          className="mrak-button small"
          onClick={() => {
            neverInvite(localStorageSafe());
            dismiss();
          }}
        >
          {t('cloud.invite-never')}
        </button>
      </div>
    </aside>
  );
}

/** Cloud saves this device does not have yet: download and continue. */
export function CloudSaves({ onLoad }: { onLoad: (entryId: string) => void }) {
  const { online, host } = useApp();
  const remote = useUi((s) => s.cloud.remote);
  const local = useUi((s) => s.saves);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void online?.saves.refreshRemote();
  }, [online]);
  if (!online) return null;
  const have = new Set(local.map((s) => s.checksum));
  const missing = remote.filter((r) => !have.has(r.checksum));
  if (missing.length === 0) return null;
  const download = (save: CloudSaveInfo): void => {
    setBusy(`${save.slot}:${String(save.version)}`);
    void online.saves
      .download(save.slot, { version: save.version })
      .then(async (r) => {
        await host.refreshSaves();
        if ('entry' in r) onLoad(r.entry.id);
      })
      .finally(() => {
        setBusy(null);
      });
  };
  return (
    <section aria-labelledby="cloud-saves-title">
      <h3 id="cloud-saves-title">
        <Icon name="ui.cloud" size={20} decorative /> {t('cloud.saves-title')}
      </h3>
      <ul className="save-list">
        {missing.map((s) => (
          <li key={`${s.slot}:${String(s.version)}`} className="save-card">
            <button
              type="button"
              className="save-entry"
              disabled={busy !== null}
              onClick={() => {
                download(s);
              }}
            >
              <span className="save-info">
                <strong>{t(`save.${s.slot}` as LocaleKey)}</strong>
                <span>
                  {formatDate(s.meta.gameDate)} · {formatTime(s.meta.gameDate.minute)}
                </span>
                <span className="muted">
                  {formatPlaytime(s.meta.playtimeMs)} ·{' '}
                  {t('load.saved-at', { when: realTime(s.meta.savedAt) })}
                </span>
              </span>
              <span>{t('cloud.download-play')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Cloudflare Turnstile (sign-up, recovery). Calls `onToken` with a single-use token. */
export function Turnstile({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  action: string;
  onToken: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget: string | null = null;
    let cancelled = false;
    const render = (): void => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widget = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        action,
        callback: (token: string) => {
          onToken(token);
        },
        'expired-callback': () => {
          onToken(null);
        },
      });
    };
    if (window.turnstile) render();
    else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
      if (!script) {
        script = document.createElement('script');
        script.src = TURNSTILE_SRC;
        script.async = true;
        document.head.append(script);
      }
      script.addEventListener('load', render);
    }
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, action, onToken]);
  return <div ref={ref} className="turnstile" />;
}
