// @vitest-environment jsdom
/**
 * Guardian progression UI (docs/systems/progression.md, UI tasks 13–16): every tab of the
 * character panel and the journal passes axe; a talent is previewed and bought from the keyboard;
 * the talk dialog marks virtue and sin tones and blocks the forbidden ones; the new-game form
 * creates the guardian; a check shows its dice and explains them.
 */
import { InputProvider, ToastProvider, UiKitProvider } from '@mrak/ui-kit';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TypedEventBus } from '../events/EventBus';
import { loadContentDatabase } from '../host/content';
import { GameHost } from '../host/GameHost';
import { t } from '../i18n/t';
import { resolveBindings } from '../input/bindings';
import { wirePresentation } from '../onboarding/controller';
import { AppProvider } from '../state/AppContext';
import { createUiStore, type CharacterTab, type JournalTab } from '../state/ui-store';
import { MemoryBackend, SaveStore } from '../storage/save-store';
import { CharacterPanel } from '../ui/character/CharacterPanel';
import { CheckResultView } from '../ui/character/CheckResultView';
import { GuardianForm } from '../ui/character/GuardianForm';
import { TalkDialog } from '../ui/character/TalkDialog';
import { JournalPanel } from '../ui/journal/JournalPanel';
import { uiStringsForTests } from './test-strings';

const content = loadContentDatabase();
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
});

async function setup(ui: ReactNode, guardian = true) {
  const store = createUiStore();
  const bus = new TypedEventBus();
  const saves = await SaveStore.open(new MemoryBackend());
  const host = new GameHost({ content, saves, store, bus, seed: () => 1834 });
  const presentation = wirePresentation(host, bus, store);
  host.newGame({
    startMinute: 9 * 60,
    ...(guardian
      ? {
          guardian: {
            calling: 'priests-acolyte',
            tree: 'exorcist',
            bonus: 'wits',
            virtue: 'mercy',
            sin: 'wrath',
          },
        }
      : {}),
  });
  host.dispatch({
    type: 'applyEffects',
    effects: [{ addStat: 'revelation', value: 40 }, { addDebt: 'aga-loan' }],
  });
  store.setState({ snapshot: host.snapshot() });
  render(
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

describe('character panel', () => {
  it.each(['sheet', 'talents', 'gear', 'debt'] as const)(
    'the %s tab passes axe and pauses the game',
    async (tab: CharacterTab) => {
      const { host, store } = await setup(<CharacterPanel />);
      act(() => {
        store.setState({ character: tab });
      });
      expect(screen.getByRole('dialog', { name: t('character.title') })).toBeDefined();
      expect(host.isPausedFor('panel')).toBe(true);
      expect(await audit()).toEqual([]);
    },
  );

  it('previews a talent (cost, Revelation after) and buys it from the keyboard', async () => {
    const { host, store, refresh } = await setup(<CharacterPanel />);
    act(() => {
      store.setState({ character: 'talents' });
    });
    const grid = screen.getByRole('grid', { name: t('tree.exorcist.name') });
    const first = within(grid).getAllByRole('button')[0];
    if (!first) throw new Error('no node');
    act(() => {
      first.focus();
    });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    const preview = screen.getByRole('button', {
      name: new RegExp(`^${t('talents.confirm', { name: t('talent.grit.name') })}`),
    });
    const rev = host.snapshot()?.stats['revelation'] ?? 0;
    expect(screen.getByText(`${String(rev)} → ${String(rev - 5)}`)).toBeDefined();
    fireEvent.click(preview);
    refresh();
    expect(host.snapshot()?.guardian.talents).toEqual(['exorcist/B1']);
  });

  it('the dark tree warns about its price and stays locked without a pact', async () => {
    const { store } = await setup(<CharacterPanel />);
    act(() => {
      store.setState({ character: 'talents' });
    });
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(t('tree.servant-of-the-horned-one.name')) }),
    );
    expect(screen.getByText(t('talents.dark-warning'))).toBeDefined();
    expect(screen.getByText(t('talents.dark-locked'))).toBeDefined();
  });
});

describe('journal', () => {
  it.each(['clues', 'demons', 'bestiary', 'recipes', 'people', 'revelation', 'notes'] as const)(
    'the %s tab passes axe',
    async (tab: JournalTab) => {
      const { store } = await setup(<JournalPanel />);
      act(() => {
        store.setState({ journal: tab });
      });
      expect(screen.getByRole('dialog', { name: t('journal.title') })).toBeDefined();
      expect(await audit()).toEqual([]);
    },
  );

  it('writes a note and marks it for the heir', async () => {
    const { host, store, refresh } = await setup(<JournalPanel />);
    act(() => {
      store.setState({ journal: 'notes' });
    });
    fireEvent.change(screen.getByLabelText(t('journal.note-label')), {
      target: { value: 'The well is wrong.' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('journal.note-write') }));
    refresh();
    fireEvent.click(screen.getByRole('checkbox'));
    refresh();
    expect(host.snapshot()?.journal.heir).toEqual(['note:1']);
  });
});

describe('talking in a tone', () => {
  it('marks virtue and sin tones, blocks the ones the sin forbids, and passes axe', async () => {
    const { host, store } = await setup(<TalkDialog />);
    host.dispatch({
      type: 'applyEffects',
      effects: [
        { setStat: 'corruption', value: 80 },
        { setStat: 'faith', value: 10 },
      ],
    });
    act(() => {
      store.setState({ talking: 'baba-neda', snapshot: host.snapshot() });
    });
    expect(
      screen.getByRole('dialog', { name: t('talk.title', { name: t('villager.baba-neda.name') }) }),
    ).toBeDefined();
    expect(screen.getByText(t('talk.by-virtue', { virtue: t('virtue.mercy.name') }))).toBeDefined();
    expect(screen.getByText(t('talk.by-sin', { sin: t('sin.wrath.name') }))).toBeDefined();
    // Wrath forbids patience: "Listen, and let them speak" is blocked.
    const listen = screen.getByRole('button', { name: new RegExp(t('talk-tone.listen')) });
    expect(listen.getAttribute('aria-disabled')).toBe('true');
    expect(await audit()).toEqual([]);
  });
});

describe('new guardian', () => {
  it('the form passes axe and creates the chosen guardian', async () => {
    let chosen: unknown = null;
    await setup(
      <GuardianForm
        content={content}
        onSubmit={(c) => {
          chosen = c;
        }}
      />,
      false,
    );
    expect(await audit()).toEqual([]);
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(t('calling.znaharka.name')) }));
    fireEvent.click(screen.getByRole('button', { name: t('creation.begin') }));
    expect(chosen).toMatchObject({
      calling: 'znaharka',
      tree: 'folk-healer',
      virtue: 'compassion',
    });
  });
});

describe('check result', () => {
  it('shows the dice, the verdict and why', async () => {
    const { host } = await setup(<CheckResultView />);
    act(() => {
      host.dispatch({ type: 'rollCheck', skill: 'lore', difficulty: 'average' });
    });
    const card = screen.getByRole('status', {
      name: t('check.title', { skill: t('skill.lore.name') }),
    });
    expect(within(card).getByText(t('check.why'))).toBeDefined();
    expect(within(card).getByText(t('attribute.wits.name'))).toBeDefined();
    expect(await audit()).toEqual([]);
  });
});
