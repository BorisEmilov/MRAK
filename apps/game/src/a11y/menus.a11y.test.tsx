// @vitest-environment jsdom
/**
 * Accessibility audit of the menus, HUD and overlays (docs/ui/accessibility.md → Audits):
 * axe-core must report no serious or critical violations. Colour contrast is verified on the
 * tokens (ui-kit tokens.test.ts) and in Storybook, since jsdom has no layout or colours.
 */
import { InputProvider, ToastProvider, UiKitProvider } from '@mrak/ui-kit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../i18n/t';
import { uiStringsForTests } from './test-strings';
import { TypedEventBus } from '../events/EventBus';
import { loadContentDatabase } from '../host/content';
import { GameHost } from '../host/GameHost';
import { resolveBindings } from '../input/bindings';
import { wirePresentation } from '../onboarding/controller';
import { AppProvider } from '../state/AppContext';
import { createUiStore, type MenuPanel } from '../state/ui-store';
import { MemoryBackend, SaveStore } from '../storage/save-store';
import { Hud } from '../ui/hud/Hud';
import { MainMenu } from '../ui/menu/MainMenu';
import { GlossaryModal } from '../ui/onboarding/GlossaryModal';
import { HintCard } from '../ui/onboarding/HintCard';
import { PauseOverlay } from '../ui/PauseOverlay';

const content = loadContentDatabase();

// jsdom has no layout: scrolling is a no-op.
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
});

async function setup() {
  const store = createUiStore();
  const bus = new TypedEventBus();
  const saves = await SaveStore.open(new MemoryBackend());
  const host = new GameHost({
    content,
    saves,
    store,
    bus,
    seed: () => 1834,
    now: () => new Date('2026-11-16T10:00:00Z'),
  });
  const presentation = wirePresentation(host, bus, store);
  const wrap = (ui: ReactNode) => (
    <AppProvider value={{ host, bus, store, presentation }}>
      <UiKitProvider strings={uiStringsForTests}>
        <InputProvider bindings={resolveBindings({})}>
          <ToastProvider>
            <div className="app mrak-root">
              <div className="ui-layer">{ui}</div>
            </div>
          </ToastProvider>
        </InputProvider>
      </UiKitProvider>
    </AppProvider>
  );
  return { store, bus, host, wrap };
}

async function audit(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`);
}

describe('menus pass axe (no serious/critical violations)', () => {
  it.each<MenuPanel>(['main', 'load', 'options', 'achievements', 'account', 'credits'])(
    'main menu: %s panel',
    async (panel) => {
      const { store, wrap } = await setup();
      store.setState({ screen: 'menu', menuPanel: panel });
      render(wrap(<MainMenu />));
      expect(await audit()).toEqual([]);
    },
  );

  it('every options tab', async () => {
    const { store, wrap } = await setup();
    store.setState({ screen: 'menu', menuPanel: 'options' });
    render(wrap(<MainMenu />));
    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab);
      expect(await audit()).toEqual([]);
    }
  });

  it('pause menu and save view', async () => {
    const { store, host, wrap } = await setup();
    host.newGame();
    store.setState({ pauseMenuOpen: true });
    host.setPaused('menu', true);
    render(wrap(<PauseOverlay />));
    expect(await audit()).toEqual([]);
  });

  it('glossary modal with search', async () => {
    const { store, wrap } = await setup();
    store.setState({ glossary: { open: true, term: 'karakondzhul' } });
    render(wrap(<GlossaryModal />));
    expect(screen.getByRole('dialog', { name: t('glossary.title') })).toBeDefined();
    expect(screen.getByText(t('glossary.karakondzhul.term'))).toBeDefined();
    expect(await audit()).toEqual([]);
  });

  it('HUD and the first hint', async () => {
    const { store, host, bus, wrap } = await setup();
    host.newGame();
    bus.emit('world:interaction', { action: 'talk', targetKey: 'villager.radka.name' });
    await Promise.resolve(); // hints are chosen once the triggers of the moment are in
    expect(store.getState().hint?.id).toBe('prologue-move');
    render(
      wrap(
        <>
          <Hud />
          <HintCard />
        </>,
      ),
    );
    expect(store.getState().hint).not.toBeNull();
    expect(
      screen.getByRole('img', { name: new RegExp(`^${t('resource.sanity.name')}:`) }).textContent,
    ).not.toMatch(/\d/);
    expect(await audit()).toEqual([]);
  });
});
