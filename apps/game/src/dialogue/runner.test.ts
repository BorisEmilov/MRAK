/**
 * Acceptance (docs/systems/dialogue.md, quests.md → Implementation) with the real content and
 * stories: a choice sets a flag and the flag changes a zone; the two rival routes block each other.
 */
import { describe, expect, it } from 'vitest';
import { TypedEventBus } from '../events/EventBus';
import { loadContentDatabase } from '../host/content';
import { GameHost } from '../host/GameHost';
import { createUiStore } from '../state/ui-store';
import { MemoryBackend, SaveStore } from '../storage/save-store';
import { DialogueRunner } from './runner';
import { STORIES } from './stories';

const content = loadContentDatabase();

async function host() {
  const store = createUiStore();
  const h = new GameHost({
    content,
    saves: await SaveStore.open(new MemoryBackend()),
    store,
    bus: new TypedEventBus(),
    seed: () => 7,
  });
  h.newGame({
    startMinute: 10 * 60,
    guardian: {
      calling: 'znaharka',
      tree: 'folk-healer',
      bonus: 'cunning',
      virtue: 'loyalty',
      sin: 'pride',
    },
  });
  return h;
}
const pick = (r: DialogueRunner, text: RegExp) => {
  const c = r.choices().find((x) => text.test(x.text));
  if (!c)
    throw new Error(
      `no choice ${String(text)}: ${r
        .choices()
        .map((x) => x.text)
        .join(' | ')}`,
    );
  return r.choose(c.index);
};

describe('dialogue', () => {
  it('every story runs from the top to its first choices', async () => {
    const h = await host();
    for (const [id, json] of Object.entries(STORIES)) {
      const step = new DialogueRunner(h, id, json).next();
      expect(step.lines.length, id).toBeGreaterThan(0);
      expect(step.choices.length, id).toBeGreaterThan(0);
    }
  });

  it('a choice sets a flag and the flag changes the forest', async () => {
    const h = await host();
    h.dispatch({ type: 'applyEffects', effects: [{ takeItem: 'salt', qty: 99 }] });
    const r = new DialogueRunner(h, 'forest-spirit', STORIES['forest-spirit'] ?? '');
    const first = r.next();
    expect(first.lines.some((l) => l.whisper)).toBe(true);
    expect(first.choices.map((c) => c.nature)).toEqual(['empathy', 'threat', 'occult']);
    // The salt circle needs salt: shown, with its requirement, and refused by core.
    const salt = first.choices.find((c) => c.nature === 'occult');
    expect(salt?.requirement).toBe('requires:item:salt:1');
    expect(r.choose(salt?.index ?? 0)).toBeNull();
    pick(r, /Ask who she is/);
    r.next();
    expect(h.snapshot()?.flags['forest-spirit-heard']).toBe(true);
    expect(h.snapshot()?.quests['the-forests-oath']?.status).toBe('active');
    expect(h.zoneVariant('samodivi-forest')).toBe('wild');
    pick(r, /Say the grove will burn/);
    const end = r.next();
    expect(end.ended).toBe(true);
    expect(h.snapshot()?.flags['forest-hostile']).toBe(true);
    expect(h.zoneVariant('samodivi-forest')).toBe('hostile');
    expect(
      h.snapshot()?.decisions.some((d) => d.id === 'forest-oath' && d.choice === 'threatened'),
    ).toBe(true);
    // Breaking with the forest fails its oath.
    expect(h.snapshot()?.quests['the-forests-oath']?.status).toBe('failed');
  });

  it("the forest's oath and clearing the grove exclude each other", async () => {
    const h = await host();
    const forest = new DialogueRunner(h, 'forest-spirit', STORIES['forest-spirit'] ?? '');
    forest.next();
    pick(forest, /Ask who she is/);
    forest.next();
    pick(forest, /Promise it\. The grove stays/);
    forest.next();
    expect(h.zoneVariant('samodivi-forest')).toBe('allied');
    expect(h.snapshot()?.quests['the-forests-oath']).toEqual({ status: 'active', stage: 'keep' });
    const dimo = new DialogueRunner(h, 'chorbadzhi-dimo', STORIES['chorbadzhi-dimo'] ?? '');
    dimo.next();
    pick(dimo, /Ask about the forest/);
    dimo.next();
    pick(dimo, /Agree to clear the grove/);
    dimo.next();
    expect(h.snapshot()?.flags['grove-agreed']).toBe(true);
    expect(h.snapshot()?.quests['clear-the-grove']).toBeUndefined();
  });
});
