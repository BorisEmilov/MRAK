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
import { createAccountClient, createOnlineClient, createSavesClient } from '@mrak/api-client';
import { HttpCloudSync, openSyncState } from './storage/cloud-sync';
import { wireOnline } from './online/wire';
import type { OnlineServices } from './state/context';
import { AccountSync, openOutbox } from './storage/account-sync';
import { checkFullGameEntitlement, loadCachedFullPack, wireDemoEnd } from './online/full-game';
import { createStoreClient } from '@mrak/api-client';
import { httpSender, TelemetryService, wireTelemetry } from './telemetry/telemetry';

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

  // The paid full pack, when this device downloaded it (docs/systems/store.md).
  const full = await loadCachedFullPack();
  let content;
  try {
    content = loadContentDatabase(packs, full);
    store.setState({
      fullGame: full !== null && content.info.version.includes(`+${full.packId}@`),
    });
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
  // Online (optional): account client, cloud saves and account progress (ADR 0007, phase 25).
  const apiUrl = env['VITE_API_URL'];
  const hasIdb = typeof indexedDB !== 'undefined';
  const accountClient = apiUrl ? createAccountClient({ baseUrl: apiUrl }) : null;
  const cloud = accountClient
    ? new HttpCloudSync({
        client: createSavesClient(accountClient),
        state: await openSyncState(hasIdb),
        userId: () => accountClient.user()?.id ?? null,
        online: () => navigator.onLine,
      })
    : null;
  const saves = await SaveStore.open(await openBackend(hasIdb), cloud ? { cloud } : {});
  cloud?.attach(saves);
  const account = new AccountSync({
    outbox: await openOutbox(hasIdb),
    client: accountClient ? createOnlineClient(accountClient) : null,
  });
  const online: OnlineServices | null =
    accountClient && cloud
      ? {
          account: accountClient,
          saves: cloud,
          progress: account,
          // Cloudflare's documented always-pass test key when none is configured (development).
          turnstileSiteKey: env['VITE_TURNSTILE_SITEKEY'] ?? '1x00000000000000000000AA',
        }
      : null;
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
  // E2E/debug hook (development builds only, like window.__mrakGame): commands go through core.
  if (import.meta.env.DEV) Reflect.set(window, '__mrak', { host, store });
  if (host && online) wireOnline(online, host, store, local);
  // Opt-in telemetry (docs/systems/telemetry.md): nothing leaves without the `telemetry` option.
  if (host && content && apiUrl) {
    const telemetry = new TelemetryService({
      send: httpSender(apiUrl),
      storage: local,
      consent: () => store.getState().options.telemetry,
      build: content.info.version.split('+')[0] ?? 'dev',
      demo: () => !store.getState().fullGame,
      sample: Math.min(1, Math.max(0, Number(env['VITE_TELEMETRY_SAMPLE'] ?? '1') || 0)),
    });
    wireTelemetry(telemetry, host, store);
  }
  if (host && content) {
    const rules = content.find('progression-rules', 'default');
    wireDemoEnd(host, store, rules?.demo?.nights ?? null);
  }
  // A refunded purchase: the cached pack is dropped (effective on the next start).
  if (online && full)
    online.account.onChange((user) => {
      if (user) void checkFullGameEntitlement(createStoreClient(online.account)).catch(() => false);
    });

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
        <AppProvider value={{ host, bus, store, presentation, online }}>
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
