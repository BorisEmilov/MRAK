// @vitest-environment jsdom
/**
 * Village panel (docs/systems/villagers.md → Presentation): passes axe in both tabs, assigns
 * tasks from the keyboard (the drag-and-drop alternative) and explains refusals.
 */
import { InputProvider, ToastProvider, UiKitProvider } from '@mrak/ui-kit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { TypedEventBus } from '../events/EventBus';
import { loadContentDatabase } from '../host/content';
import { GameHost } from '../host/GameHost';
import { t } from '../i18n/t';
import { resolveBindings } from '../input/bindings';
import { wirePresentation } from '../onboarding/controller';
import { AppProvider } from '../state/AppContext';
import { createUiStore } from '../state/ui-store';
import { MemoryBackend, SaveStore } from '../storage/save-store';
import { VillagePanel } from '../ui/village/VillagePanel';
import { uiStringsForTests } from './test-strings';

const content = loadContentDatabase();
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
});

async function setup() {
  const store = createUiStore();
  const bus = new TypedEventBus();
  const saves = await SaveStore.open(new MemoryBackend());
  const host = new GameHost({ content, saves, store, bus, seed: () => 1834 });
  const presentation = wirePresentation(host, bus, store);
  host.newGame({ startMinute: 9 * 60 });
  store.setState({ villageOpen: true });
  render(
    <AppProvider value={{ host, bus, store, presentation }}>
      <UiKitProvider strings={uiStringsForTests}>
        <InputProvider bindings={resolveBindings({})}>
          <ToastProvider>
            <div className="app mrak-root">
              <div className="ui-layer">
                <VillagePanel />
              </div>
            </div>
          </ToastProvider>
        </InputProvider>
      </UiKitProvider>
    </AppProvider>,
  );
  return { store, host };
}

async function audit(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`);
}

describe('village panel', () => {
  it('shows the eight villagers, pauses the game, and passes axe', async () => {
    const { host } = await setup();
    expect(screen.getByRole('dialog', { name: t('village.title') })).toBeDefined();
    expect(screen.getAllByRole('article')).toHaveLength(8);
    expect(host.isPausedFor('panel')).toBe(true);
    // Needs are words, never numbers.
    const fear = screen.getAllByRole('img', { name: new RegExp(`^${t('village.need.fear')}:`) });
    expect(fear[0]?.getAttribute('aria-label')).not.toMatch(/\d/);
    expect(await audit()).toEqual([]);
  });

  it('assigns a task from the slot list and shows refusals', async () => {
    const { host } = await setup();
    const day = screen.getByLabelText(new RegExp(`^.*${t('village.slot.day')}`), {
      selector: '#task-krastyo-day',
    });
    fireEvent.change(day, { target: { value: 'firewood' } });
    expect(host.snapshot()?.villagers['krastyo']?.tasks.day).toBe('firewood');

    host.dispatch({
      type: 'applyEffects',
      effects: [{ setStat: 'fear', villager: 'todor', value: 95 }],
    });
    const night = document.querySelector<HTMLSelectElement>('#task-todor-night');
    if (!night) throw new Error('no night slot');
    fireEvent.change(night, { target: { value: 'watch' } });
    expect(screen.getByRole('alert').textContent).toBe(
      t('village.reason.afraid', { name: t('villager.todor.name') }),
    );
  });

  it('filters and the relationship graph', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: t('village.filter.dead') }));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: t('village.tab.relations') }));
    expect(screen.getByRole('group', { name: /Relationship graph/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('villager.velika.name') }));
    expect(
      screen.getByText(t('village.graph.ties-of', { name: t('villager.velika.name') })),
    ).toBeDefined();
    expect(await audit()).toEqual([]);
  });
});
