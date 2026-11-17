/**
 * Runs an Ink story against the game (docs/systems/dialogue.md → Implementation): Ink reads the
 * WorldState only through the whitelisted external functions, and every write is a core command
 * (validated by core). Choices go through the core `dialogueChoice` command (requirements, sin
 * blocking and takeover). Ink keeps no state between conversations.
 */
import type { ChoiceNature } from '@mrak/content-schema';
import { CHOICE_NATURES } from '@mrak/content-schema';
import { choiceStatus, effectiveStat, itemCount, progressionRules } from '@mrak/core';
import { Story } from 'inkjs';
import type { GameHost } from '../host/GameHost';

export interface DialogueLine {
  text: string;
  shake: boolean;
  whisper: boolean;
  sfx: string | null;
  /** "guardian" or a villager id; null = the story's speaker. */
  speaker: string | null;
}

export interface DialogueChoice {
  index: number;
  text: string;
  tags: string[];
  nature: ChoiceNature | null;
  /** The unmet `requires:` tag, or null. */
  requirement: string | null;
  /** The sin forbidding it (V5), or null. */
  blockedBy: string | null;
  virtue: boolean;
  sin: boolean;
}

export interface DialogueStep {
  lines: DialogueLine[];
  choices: DialogueChoice[];
  ended: boolean;
}

function lineOf(text: string, tags: readonly string[]): DialogueLine {
  const value = (prefix: string) =>
    tags.find((t) => t.startsWith(`${prefix}:`))?.slice(prefix.length + 1) ?? null;
  return {
    text: text.trim(),
    shake: tags.includes('shake'),
    whisper: tags.includes('whisper'),
    sfx: value('sfx'),
    speaker: value('speaker'),
  };
}

let serials = 0;

export class DialogueRunner {
  private readonly story: Story;
  /** Distinct per conversation (React key). */
  readonly serial = ++serials;

  constructor(
    private readonly host: GameHost,
    readonly storyId: string,
    json: string,
  ) {
    this.story = new Story(json);
    this.bind();
  }

  private write(effects: unknown[]): void {
    const r = this.host.dispatch({
      type: 'applyEffects',
      effects: effects as never,
      source: `dialogue:${this.storyId}`,
    });
    if (!r.ok) console.warn(`[dialogue] ${this.storyId}: ${r.reason}`);
  }

  private bind(): void {
    const host = this.host;
    const snap = () => host.snapshot();
    const s = this.story;
    s.BindExternalFunction('get_flag', (id: string) => snap()?.flags[id] === true, true);
    s.BindExternalFunction(
      'get_stat',
      (id: string) => {
        const state = snap();
        return state && host.content.hasStat(id) ? effectiveStat(state, host.content, id) : 0;
      },
      true,
    );
    s.BindExternalFunction(
      'has_item',
      (id: string, qty: number) => {
        const state = snap();
        return state !== null && itemCount(state, id) >= qty;
      },
      true,
    );
    s.BindExternalFunction(
      'skill_level',
      (id: string) => snap()?.guardian.skills[id]?.rank ?? 0,
      true,
    );
    // Visible status only: a hidden possession is never a status.
    s.BindExternalFunction(
      'villager_state',
      (id: string) => snap()?.villagers[id]?.status ?? 'dead',
      true,
    );
    s.BindExternalFunction('set_flag', (id: string) => {
      this.write([{ setFlag: id }]);
    });
    s.BindExternalFunction('add_stat', (id: string, value: number) => {
      this.write([{ addStat: id, value }]);
    });
    s.BindExternalFunction('give_item', (id: string, qty: number) => {
      this.write([{ giveItem: id, qty }]);
    });
    s.BindExternalFunction('record_decision', (id: string, choice: string) => {
      const r = host.dispatch({ type: 'recordDecision', id, choice });
      if (!r.ok) console.warn(`[dialogue] ${this.storyId}: ${r.reason}`);
    });
  }

  /** Continues until choices or the end. */
  next(): DialogueStep {
    const lines: DialogueLine[] = [];
    while (this.story.canContinue) {
      const text = this.story.Continue() ?? '';
      if (text.trim() !== '') lines.push(lineOf(text, this.story.currentTags ?? []));
    }
    return { lines, choices: this.choices(), ended: this.story.currentChoices.length === 0 };
  }

  /** Current choices with their nature, requirement and sin status (recomputed from the state). */
  choices(): DialogueChoice[] {
    const state = this.host.snapshot();
    const rules = progressionRules(this.host.content);
    return this.story.currentChoices.map((c, index) => {
      const tags = c.tags ?? [];
      const status = state
        ? choiceStatus(state, this.host.content, rules, tags)
        : { requirement: null, blockedBy: null, sin: false };
      const virtueId = state?.guardian.virtue;
      return {
        index,
        text: c.text,
        tags,
        nature: CHOICE_NATURES.find((n) => tags.includes(n)) ?? null,
        requirement: status.requirement,
        blockedBy: status.blockedBy,
        virtue: virtueId != null && tags.includes(`virtue:${virtueId}`),
        sin: status.sin,
      };
    });
  }

  /**
   * Chooses through core. Returns the index actually taken (the sin may take over) and whether
   * the sin spoke; null when core refused.
   */
  choose(index: number): { chosen: number; sinSpoke: boolean } | null {
    const options = this.story.currentChoices.map((c) => c.tags ?? []);
    const r = this.host.dispatch({
      type: 'dialogueChoice',
      story: this.storyId,
      options,
      wanted: index,
    });
    if (!r.ok) return null;
    const made = r.events.find((e) => e.type === 'dialogue/choiceMade');
    const chosen = made?.type === 'dialogue/choiceMade' ? made.payload.index : index;
    this.story.ChooseChoiceIndex(chosen);
    return { chosen, sinSpoke: r.events.some((e) => e.type === 'sin/tookOver') };
  }
}
