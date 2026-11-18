import { InputProvider, ToastProvider, UiKitProvider } from '@mrak/ui-kit';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { GameCanvas } from './game/GameCanvas';
import { uiStrings } from './i18n/ui-strings';
import { actionFor, resolveBindings } from './input/bindings';
import { useApp, useUi } from './state/hooks';
import { panelOpen, type UiStore } from './state/ui-store';
import { AudioHint } from './ui/AudioHint';
import { Captions } from './ui/Captions';
import { ErrorScreen } from './ui/ErrorScreen';
import { Hud } from './ui/hud/Hud';
import { ChapterPanel } from './ui/hud/ChapterPanel';
import { NightPanel } from './ui/hud/NightPanel';
import { LoadingOverlay } from './ui/LoadingOverlay';
import { MainMenu } from './ui/menu/MainMenu';
import { GlossaryModal } from './ui/onboarding/GlossaryModal';
import { MapPanel } from './ui/map/MapPanel';
import { BelongingsPanel } from './ui/items/BelongingsPanel';
import { CharacterPanel } from './ui/character/CharacterPanel';
import { CheckResultView } from './ui/character/CheckResultView';
import { GuardianCreation } from './ui/character/GuardianCreation';
import { HeirChoice } from './ui/character/HeirChoice';
import { PactDialog } from './ui/character/PactDialog';
import { ExorcismPanel } from './ui/character/ExorcismPanel';
import { TalkDialog } from './ui/character/TalkDialog';
import { JournalPanel } from './ui/journal/JournalPanel';
import { DeductionBoard } from './ui/journal/DeductionBoard';
import { DialoguePanel } from './ui/dialogue/DialoguePanel';
import { VillagePanel } from './ui/village/VillagePanel';
import { HintCard } from './ui/onboarding/HintCard';
import { PauseOverlay } from './ui/PauseOverlay';
import { SaveIndicator } from './ui/SaveIndicator';
import { ConflictDialog, DemoEnd, MigrationDialog, SyncStatus } from './ui/online/OnlineUi';
import { Whispers } from './ui/Whispers';

// Development-only tool: the import is dropped from production builds.
const DebugConsole = import.meta.env.DEV ? lazy(() => import('./ui/debug/DebugConsole')) : null;

function useGlobalKeys(): void {
  const { host, store } = useApp();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const state = store.getState();
      if (e.key === 'F1' && import.meta.env.DEV) {
        e.preventDefault();
        store.setState({ debugOpen: !state.debugOpen });
        return;
      }
      // Typing in a field or rebinding a key: never steal the keystroke.
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest('input, select, textarea, [aria-pressed="true"].rebind')
      )
        return;
      const action = actionFor(resolveBindings(state.options.keyBindings), e.code);
      if (action === 'glossary') {
        e.preventDefault();
        store.setState({ glossary: { open: !state.glossary.open } });
        return;
      }
      if (state.screen !== 'playing' || state.glossary.open) return;
      if (host.isPausedFor('focus')) {
        host.setPaused('focus', false);
        return;
      }
      if (action === 'show-hud') {
        e.preventDefault();
        store.setState({ hudWake: state.hudWake + 1 });
      } else if (action === 'quick-save') {
        // Quick save (by day only); also stops the browser from reloading the page.
        e.preventDefault();
        if (!e.repeat) void host.saveManual('quick');
      } else if (action === 'pause') {
        const open = !state.pauseMenuOpen;
        store.setState({ pauseMenuOpen: open });
        host.setPaused('menu', open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [host, store]);
}

/** Text scale, colour-blind palette and reduced motion live on <html> so portals inherit them. */
function useRootAttributes(): void {
  const textScale = useUi((s) => s.options.textScale);
  const colorblind = useUi((s) => s.options.colorblind);
  const reduceMotion = useUi((s) => s.options.reduceMotion);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--mrak-text-scale', String(textScale));
    root.dataset['mrakColorblind'] = colorblind;
    if (reduceMotion === 'system') delete root.dataset['mrakReduceMotion'];
    else root.dataset['mrakReduceMotion'] = String(reduceMotion === 'on');
  }, [textScale, colorblind, reduceMotion]);
}

export function App() {
  const screen = useUi((s) => s.screen);
  const debugOpen = useUi((s) => s.debugOpen);
  // Menus over the world take the gamepad; in the world the scene reads it.
  const menuOverWorld = useUi((s) => panelOpen(s) || s.glossary.open);
  const keyBindings = useUi((s) => s.options.keyBindings);
  const bindings = useMemo(() => resolveBindings(keyBindings), [keyBindings]);
  useGlobalKeys();
  useRootAttributes();

  return (
    <UiKitProvider strings={uiStrings}>
      <InputProvider bindings={bindings} gamepadNavigation={screen !== 'playing' || menuOverWorld}>
        <ToastProvider>
          <div className="app mrak-root">
            {screen !== 'error' && <GameCanvas />}
            <div className="ui-layer">
              {(screen === 'booting' || screen === 'loading') && <LoadingOverlay />}
              {screen === 'menu' && <MainMenu />}
              {screen === 'playing' && (
                <>
                  <Hud />
                  <NightPanel />
                  <ChapterPanel />
                  <Captions />
                  <Whispers />
                  <HintCard />
                  <MapPanel />
                  <VillagePanel />
                  <BelongingsPanel />
                  <CharacterPanel />
                  <JournalPanel />
                  <DeductionBoard />
                  <TalkDialog />
                  <DialoguePanel />
                  <PactDialog />
                  <ExorcismPanel />
                  <CheckResultView />
                  <HeirChoice />
                  <GuardianCreation />
                  <PauseOverlay />
                  <SaveIndicator />
                  <div className="hud-sync">
                    <SyncStatus compact />
                  </div>
                </>
              )}
              {screen === 'error' && <ErrorScreen />}
              <AudioHint />
              <GlossaryModal />
              <ConflictDialog />
              <MigrationDialog />
              <DemoEnd />
              {DebugConsole && debugOpen && (
                <Suspense fallback={null}>
                  <DebugConsole />
                </Suspense>
              )}
            </div>
          </div>
        </ToastProvider>
      </InputProvider>
    </UiKitProvider>
  );
}

/** Shown when the app cannot even start (no content, no WebGL before the host exists). */
App.Fatal = function Fatal({ store }: { store: UiStore }) {
  const error = useStore(store, (s) => s.error);
  return (
    <div className="app mrak-root">
      <div className="ui-layer">
        <ErrorScreen error={error} />
      </div>
    </div>
  );
};
