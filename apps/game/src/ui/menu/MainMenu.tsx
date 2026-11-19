import { useEffect, useState } from 'react';
import { t } from '../../i18n/t';
import { SITE_URL } from '../../platform';
import { useApp, useUi } from '../../state/hooks';
import type { MenuPanel } from '../../state/ui-store';
import { AccountPanel } from './AccountPanel';
import { AchievementsPanel } from './AchievementsPanel';
import { LoadPanel } from './LoadPanel';
import { OptionsPanel } from './OptionsPanel';
import { RecoveryNotice, type LoadFailure } from './RecoveryNotice';
import { CreditsPanel } from './CreditsPanel';
import { GuardianForm } from '../character/GuardianForm';
import { IconButton } from '@mrak/ui-kit';
import { AccountInvite, SyncStatus } from '../online/OnlineUi';
import { clearPlayIntent, pendingPlayIntent } from './play-intent';

export function MainMenu() {
  const { host, store, online } = useApp();
  const panel = useUi((s) => s.menuPanel);
  const saves = useUi((s) => s.saves);
  const remote = useUi((s) => s.cloud.remote);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const open = (p: MenuPanel): void => {
    store.setState({ menuPanel: p });
  };
  const back = (): void => {
    open('main');
  };

  const run = (action: () => unknown): void => {
    setBusy(true);
    setProblem(null);
    setFailure(null);
    Promise.resolve(action())
      .then((result) => {
        // A save that cannot be opened: offer the newest intact one instead.
        if (result && typeof result === 'object' && 'ok' in result && result.ok === false)
          setFailure(result as LoadFailure);
      })
      .catch(() => {
        setProblem(t('menu.load-failed'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const startNew = (): void => {
    // A new chronicle opens with Stana's last days (docs/lore/prologue.md); the guardian is
    // chosen when the prologue ends.
    if (host.content.find('starts', 'prologue'))
      run(() => {
        host.newGame({ startId: 'prologue' });
      });
    // Choose the guardian first when the content has callings (progression.md C1).
    else if (host.content.all('callings').length > 0) open('new-game');
    else
      run(() => {
        host.newGame();
      });
  };

  // Deep link from the website's player hub (docs/ui/player-hub.md). `continue` resumes the
  // newest local save; on a device without one it first downloads the newest cloud save (as the
  // Load screen does). It waits for the lists and gives up quietly after a few seconds.
  useEffect(() => {
    const want = pendingPlayIntent();
    if (!want || busy || panel !== 'main') return undefined;
    const newestCloud = [...remote].sort((a, b) => b.meta.savedAt.localeCompare(a.meta.savedAt))[0];
    if (want === 'continue' && saves.length === 0 && !(online && newestCloud)) return undefined;
    const id = setTimeout(() => {
      if (pendingPlayIntent() !== want) return;
      clearPlayIntent();
      if (want === 'new') startNew();
      else if (saves.length > 0 || !online || !newestCloud) run(() => host.continueGame());
      else
        run(async () => {
          await online.saves.download(newestCloud.slot, { version: newestCloud.version });
          await host.refreshSaves();
          return host.continueGame();
        });
    }, 0);
    return () => {
      clearTimeout(id);
    };
  });
  useEffect(() => {
    const id = setTimeout(clearPlayIntent, 8000);
    return () => {
      clearTimeout(id);
    };
  }, []);

  return (
    <main className="menu-screen">
      <div className="panel menu">
        {panel === 'main' && (
          <>
            <div className="menu-sync">
              <SyncStatus />
            </div>
            <AccountInvite />
            <div className="menu-corner">
              <IconButton
                icon="ui.glossary"
                label={t('glossary.title')}
                description={t('glossary.open-hint')}
                variant="secondary"
                onClick={() => {
                  store.setState({ glossary: { open: true } });
                }}
              />
            </div>
            <h1 className="title mrak-display">{t('game.title')}</h1>
            <p className="subtitle">{t('game.subtitle')}</p>
            <nav className="menu-buttons" aria-label={t('menu.label')}>
              <button
                type="button"
                className="mrak-button"
                data-variant="primary"
                disabled={busy || saves.length === 0}
                title={saves.length === 0 ? t('menu.continue-none') : undefined}
                onClick={() => {
                  run(() => host.continueGame());
                }}
              >
                {t('menu.continue')}
              </button>
              <button
                type="button"
                className="mrak-button"
                data-variant="primary"
                disabled={busy}
                autoFocus={saves.length === 0}
                onClick={startNew}
              >
                {t('menu.new-game')}
              </button>
              {host.content.find('starts', 'prologue') &&
                host.content.all('callings').length > 0 && (
                  <button
                    type="button"
                    className="mrak-button"
                    disabled={busy}
                    onClick={() => {
                      open('new-game');
                    }}
                  >
                    {t('menu.skip-prologue')}
                  </button>
                )}
              <button
                type="button"
                className="mrak-button"
                onClick={() => {
                  open('load');
                }}
              >
                {t('menu.load')}
              </button>
              <button
                type="button"
                className="mrak-button"
                onClick={() => {
                  open('options');
                }}
              >
                {t('menu.options')}
              </button>
              <button
                type="button"
                className="mrak-button"
                onClick={() => {
                  open('achievements');
                }}
              >
                {t('menu.achievements')}
              </button>
              <button
                type="button"
                className="mrak-button"
                onClick={() => {
                  open('account');
                }}
              >
                {t('menu.account')}
              </button>
              <button
                type="button"
                className="mrak-button"
                onClick={() => {
                  open('credits');
                }}
              >
                {t('menu.credits')}
              </button>
              <a className="mrak-button" href={SITE_URL}>
                {t('menu.quit')}
              </a>
            </nav>
            {problem && <p role="alert">{problem}</p>}
            {failure && (
              <RecoveryNotice
                failure={failure}
                onLoad={(id) => {
                  run(() => host.load(id));
                }}
                onDismiss={() => {
                  setFailure(null);
                }}
              />
            )}
          </>
        )}
        {panel === 'new-game' && (
          <section className="new-game" aria-labelledby="new-game-title">
            <h2 id="new-game-title">{t('creation.title')}</h2>
            <p>{t('creation.intro')}</p>
            <GuardianForm
              content={host.content}
              busy={busy}
              onCancel={back}
              onSubmit={(guardian) => {
                run(() => {
                  host.newGame({ guardian });
                });
              }}
            />
          </section>
        )}
        {panel === 'load' && <LoadPanel onBack={back} />}
        {panel === 'options' && <OptionsPanel onBack={back} />}
        {panel === 'achievements' && <AchievementsPanel onBack={back} />}
        {panel === 'account' && <AccountPanel onBack={back} />}
        {panel === 'credits' && <CreditsPanel onBack={back} />}
      </div>
    </main>
  );
}
