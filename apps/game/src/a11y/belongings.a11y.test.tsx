// @vitest-environment jsdom
/**
 * Belongings panel (docs/systems/inventory.md, alchemy.md, collection.md, photography.md): every
 * tab passes axe; the pack shows details and compares; the store moves items without dragging;
 * the mortar grinds from the keyboard and writes the journal.
 */
import { InputProvider, ToastProvider, UiKitProvider } from '@mrak/ui-kit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { TypedEventBus } from '../events/EventBus';
import { loadContentDatabase } from '../host/content';
import { GameHost } from '../host/GameHost';
import { t } from '../i18n/t';
import { resolveBindings } from '../input/bindings';
import { wirePresentation } from '../onboarding/controller';
import { AppProvider } from '../state/AppContext';
import { createUiStore, type BelongingsTab } from '../state/ui-store';
import { MemoryBackend, SaveStore } from '../storage/save-store';
import { BelongingsPanel } from '../ui/items/BelongingsPanel';
import { itemCount } from '@mrak/core';
import { uiStringsForTests } from './test-strings';

const content = loadContentDatabase();
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
});

async function setup(tab: BelongingsTab) {
  const store = createUiStore();
  const bus = new TypedEventBus();
  const saves = await SaveStore.open(new MemoryBackend());
  const host = new GameHost({ content, saves, store, bus, seed: () => 1834 });
  const presentation = wirePresentation(host, bus, store);
  host.newGame({ startMinute: 9 * 60 });
  host.dispatch({
    type: 'applyEffects',
    effects: [
      { giveItem: 'rag-doll', qty: 1 },
      { giveItem: 'juniper', qty: 2, to: 'storage' },
      { giveItem: 'daguerreotype-camera', qty: 1 },
      { giveItem: 'photographic-plate', qty: 2 },
    ],
  });
  host.dispatch({ type: 'takePhotograph', subject: { zone: 'village', poi: 'well' } });
  store.setState({ belongings: tab, snapshot: host.snapshot() });
  render(
    <AppProvider value={{ host, bus, store, presentation }}>
      <UiKitProvider strings={uiStringsForTests}>
        <InputProvider bindings={resolveBindings({})}>
          <ToastProvider>
            <div className="app mrak-root">
              <div className="ui-layer">
                <BelongingsPanel />
              </div>
            </div>
          </ToastProvider>
        </InputProvider>
      </UiKitProvider>
    </AppProvider>,
  );
  const refresh = (): void => {
    act(() => {
      store.setState({ snapshot: host.snapshot() });
    });
  };
  return { store, host, refresh };
}

async function audit(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`);
}

describe('belongings panel', () => {
  it.each(['pack', 'store', 'mortar', 'cabinet', 'collection', 'album'] as const)(
    'the %s tab passes axe and pauses the game',
    async (tab) => {
      const { host } = await setup(tab);
      expect(screen.getByRole('dialog', { name: t('items.title') })).toBeDefined();
      expect(host.isPausedFor('panel')).toBe(true);
      expect(await audit()).toEqual([]);
    },
  );

  it('selecting an item shows it; Compare pins it and compares with the next', async () => {
    await setup('pack');
    const [oil] = screen.getAllByRole('button', {
      name: new RegExp(`^${t('item.lamp-oil.name')}`),
    });
    if (!oil) throw new Error('no oil slot');
    fireEvent.click(oil);
    expect(screen.getByRole('heading', { name: t('item.lamp-oil.name') })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('items.action.compare') }));
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`^${t('item.rag-doll.name')}`) }),
    );
    expect(
      screen.getByRole('table', {
        name: t('items.compare.title', { a: t('item.lamp-oil.name'), b: t('item.rag-doll.name') }),
      }),
    ).toBeDefined();
  });

  it('moves from the store to the pack with buttons (no dragging needed)', async () => {
    const { host, refresh } = await setup('store');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t('item.juniper.name')}`) }));
    fireEvent.click(screen.getByRole('button', { name: t('items.action.take-all') }));
    refresh();
    const s = host.snapshot();
    if (!s) throw new Error('no snapshot');
    expect(itemCount(s, 'juniper', 'pack')).toBe(2);
  });

  it('grinds in the mortar from the keyboard and writes the journal', async () => {
    const { host, refresh } = await setup('mortar');
    fireEvent.click(
      screen.getByRole('button', { name: t('items.mortar.add', { item: t('item.juniper.name') }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('items.mortar.grind') }));
    refresh();
    expect(screen.getByRole('status').textContent).toContain(t('items.mortar.hint.missing'));
    expect(host.snapshot()?.alchemy.attempts).toHaveLength(1);
    expect(screen.getByRole('heading', { name: t('items.mortar.journal') })).toBeDefined();
  });

  it('the album shows the plate with its hidden layer', async () => {
    await setup('album');
    expect(screen.getByText(t('photo-layer.well-symbol.name'))).toBeDefined();
  });
});
