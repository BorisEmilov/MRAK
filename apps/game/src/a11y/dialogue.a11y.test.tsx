// @vitest-environment jsdom
/**
 * Dialogue and quest log UI (docs/systems/dialogue.md, quests.md → Implementation): the
 * conversation passes axe; text can be skipped; choices show their nature and blocked ones their
 * requirement; choosing changes the world; the quest log lists the started quest.
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
import { createUiStore } from '../state/ui-store';
import { MemoryBackend, SaveStore } from '../storage/save-store';
import { DialoguePanel } from '../ui/dialogue/DialoguePanel';
import { JournalPanel } from '../ui/journal/JournalPanel';
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
  const host = new GameHost({ content, saves, store, bus, seed: () => 3 });
  const presentation = wirePresentation(host, bus, store);
  host.newGame({
    startMinute: 10 * 60,
    guardian: {
      calling: 'znaharka',
      tree: 'folk-healer',
      bonus: 'cunning',
      virtue: 'loyalty',
      sin: 'pride',
    },
  });
  host.dispatch({ type: 'applyEffects', effects: [{ takeItem: 'salt', qty: 99 }] });
  store.setState({ snapshot: host.snapshot() });
  render(
    <AppProvider value={{ host, bus, store, presentation }}>
      <UiKitProvider strings={uiStringsForTests}>
        <InputProvider bindings={resolveBindings({})}>
          <ToastProvider>
            <div className="app mrak-root">
              <div className="ui-layer">
                <DialoguePanel />
                <JournalPanel />
              </div>
            </div>
          </ToastProvider>
        </InputProvider>
      </UiKitProvider>
    </AppProvider>,
  );
  return { host, store };
}

async function audit(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 100)).join(' | ')}`);
}

/** Clicks through the lines (skip, then continue) until the choices show. */
function toChoices(): void {
  for (let i = 0; i < 20 && !screen.queryByRole('list', { name: t('dialogue.choices') }); i++)
    fireEvent.click(screen.getByRole('button', { name: /Show all|Continue/ }));
}

describe('dialogue panel', () => {
  it('speaks the forest spirit: skippable text, natures, a blocked choice, and the forest changes', async () => {
    const { host, store } = await setup();
    act(() => {
      store.setState({ dialogue: { story: 'forest-spirit', villager: null } });
    });
    expect(screen.getByRole('dialog', { name: t('dialogue.speaker.forest-spirit') })).toBeDefined();
    expect(host.isPausedFor('dialogue')).toBe(true);
    toChoices();
    expect(await audit()).toEqual([]);
    const salt = screen.getByRole('button', { name: /Draw a circle of salt/ });
    expect(salt.getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByText(t('dialogue.requires.item', { qty: '1', item: t('item.salt.name') })),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Ask who she is/ }));
    toChoices();
    fireEvent.click(screen.getByRole('button', { name: /Promise it\. The grove stays/ }));
    expect(host.zoneVariant('samodivi-forest')).toBe('allied');
    act(() => {
      store.setState({ dialogue: null, journal: 'quests', snapshot: host.snapshot() });
    });
    expect(screen.getByText(t('quest.the-forests-oath.name'))).toBeDefined();
    expect(await audit()).toEqual([]);
  });
});
