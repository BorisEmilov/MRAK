import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TypedEventBus } from './events/EventBus';
import { ContentLoadError, loadContentDatabase } from './host/content';
import { fetchPacks } from './host/packs';
import { GameHost } from './host/GameHost';
import { hasWebGL } from './platform';
import { AppProvider } from './state/AppContext';
import { createUiStore } from './state/ui-store';
import { loadOptions } from './storage/options';
import { absorbEmergency } from './storage/emergency';
import { checkPersistence, requestPersistence } from './storage/persistence';
import { openBackend, SaveStore } from './storage/save-store';
import '@mrak/ui-kit/styles.css';
import './styles.css';
import { wirePresentation } from './onboarding/controller';
import { createAccountClient, createOnlineClient } from '@mrak/api-client';
import { AccountSync, openOutbox } from './storage/account-sync';

function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

async function bootstrap(): Promise<void> {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Missing #root element');

  const store = createUiStore(loadOptions(localStorageOrUndefined()));
  const bus = new TypedEventBus();

  if (!hasWebGL()) store.setState({ screen: 'error', error: { kind: 'webgl' } });

  // Live content packs (signed, data only): only when the build names a CDN and its key.
  const env = import.meta.env as Record<string, string | undefined>;
  const cdn = env['VITE_CONTENT_CDN'];
  const packKey = env['VITE_PACK_PUBLIC_KEY'];
  const packs =
    cdn && packKey
      ? await fetchPacks(cdn, packKey).catch((err: unknown) => {
          console.warn('[packs] unavailable:', err);
          return [];
        })
      : [];

  let content;
  try {
    content = loadContentDatabase(packs);
  } catch (err) {
    store.setState({
      screen: 'error',
      error: {
        kind: 'content',
        detail: err instanceof ContentLoadError ? err.message : String(err),
      },
    });
  }

  const local = localStorageOrUndefined();
  const storageApi = typeof navigator.storage === 'undefined' ? undefined : navigator.storage;
  const saves = await SaveStore.open(await openBackend(typeof indexedDB !== 'undefined'));
  // Account progress: queued on this device, sent when there is an account and a connection.
  const apiUrl = env['VITE_API_URL'];
  // Access token in memory only; the refresh token is an HttpOnly cookie (ADR 0007).
  const accountClient = apiUrl ? createAccountClient({ baseUrl: apiUrl }) : null;
  const account = new AccountSync({
    outbox: await openOutbox(typeof indexedDB !== 'undefined'),
    client:
      apiUrl && accountClient
        ? createOnlineClient({ baseUrl: apiUrl, accessToken: accountClient.accessToken })
        : null,
  });
  window.addEventListener('online', () => void account.flush());
  void (accountClient?.resume() ?? Promise.resolve(false))
    .catch(() => false)
    .then(() => account.flush());
  // A backup written while the tab was closing becomes the newest autosave.
  try {
    if (await absorbEmergency(local, saves)) console.info('[save] recovered the last session');
  } catch (err) {
    console.warn('[save] emergency backup could not be recovered', err);
  }
  void checkPersistence(storageApi).then((storagePersistence) => {
    store.setState({ storagePersistence });
  });

  // Without content the host is never used: the error screen is shown instead.
  const host = content
    ? new GameHost({
        content,
        saves,
        store,
        bus,
        emergency: local,
        profile: local,
        account,
        ...(env['VITE_API_URL']
          ? {
              seasons: async () => {
                const res = await fetch(`${env['VITE_API_URL'] ?? ''}/v1/seasonal`);
                return res.ok ? ((await res.json()) as unknown) : null;
              },
            }
          : {}),
        requestPersistence: () => requestPersistence(storageApi),
      })
    : null;

  const presentation = host ? wirePresentation(host, bus, store) : null;

  // Closing or hiding the tab: synchronous backup + autosave (see save-system.md).
  if (host) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') host.suspend();
    });
    window.addEventListener('pagehide', () => {
      host.suspend();
    });
  }

  bus.on('load:progress', ({ progress }) => {
    if (store.getState().screen === 'booting') store.setState({ screen: 'loading' });
    store.setState({ loadProgress: progress });
  });
  bus.on('load:complete', () => {
    // Measured by Lighthouse / WebPageTest as "time to menu" (user timing).
    performance.mark('mrak:menu-ready');
    store.setState({ screen: 'menu', loadProgress: 1 });
    void host?.refreshSaves();
  });
  bus.on('world:zoneLoading', ({ loading }) => {
    store.setState({ zoneLoading: loading });
  });

  createRoot(rootEl).render(
    <StrictMode>
      {host && presentation ? (
        <AppProvider value={{ host, bus, store, presentation }}>
          <App />
        </AppProvider>
      ) : (
        <App.Fatal store={store} />
      )}
    </StrictMode>,
  );
  document.getElementById('boot-splash')?.remove();
}

void bootstrap();
