/**
 * Remappable actions (docs/ui/accessibility.md → Key bindings). Keyboard keys are remappable; the
 * gamepad layout is fixed for now. Rebinding a key already used by another action swaps them, so
 * no action is ever left unreachable.
 */
import type { LocaleKey } from '@mrak/content';
import type { Binding, PadButton } from '@mrak/ui-kit';

export interface ActionDef {
  id: string;
  labelKey: LocaleKey;
  keys: readonly string[];
  pad?: PadButton;
}

export const ACTIONS = [
  { id: 'move-up', labelKey: 'action.move-up', keys: ['KeyW', 'ArrowUp'], pad: 'up' },
  { id: 'move-down', labelKey: 'action.move-down', keys: ['KeyS', 'ArrowDown'], pad: 'down' },
  { id: 'move-left', labelKey: 'action.move-left', keys: ['KeyA', 'ArrowLeft'], pad: 'left' },
  { id: 'move-right', labelKey: 'action.move-right', keys: ['KeyD', 'ArrowRight'], pad: 'right' },
  { id: 'run', labelKey: 'action.run', keys: ['ShiftLeft', 'ShiftRight'], pad: 'lt' },
  { id: 'interact', labelKey: 'action.interact', keys: ['KeyE', 'Space'], pad: 'a' },
  { id: 'lantern', labelKey: 'action.lantern', keys: ['KeyL'], pad: 'rb' },
  { id: 'map', labelKey: 'action.map', keys: ['KeyM'], pad: 'lb' },
  { id: 'village', labelKey: 'action.village', keys: ['KeyV'], pad: 'rt' },
  { id: 'actions', labelKey: 'action.actions', keys: ['KeyQ'], pad: 'y' },
  { id: 'journal', labelKey: 'action.journal', keys: ['KeyJ'], pad: 'view' },
  { id: 'inventory', labelKey: 'action.inventory', keys: ['KeyI'], pad: 'x' },
  { id: 'character', labelKey: 'action.character', keys: ['KeyC'], pad: 'b' },
  { id: 'photograph', labelKey: 'action.photograph', keys: ['KeyP'] },
  { id: 'glossary', labelKey: 'action.glossary', keys: ['F2'], pad: 'rs' },
  { id: 'show-hud', labelKey: 'action.show-hud', keys: ['Tab'], pad: 'ls' },
  { id: 'quick-save', labelKey: 'action.quick-save', keys: ['F5'] },
  { id: 'pause', labelKey: 'action.pause', keys: ['Escape'], pad: 'menu' },
] as const satisfies readonly ActionDef[];

export type ActionId = (typeof ACTIONS)[number]['id'];
/** Player overrides: action → keyboard codes. */
export type KeyOverrides = Partial<Record<ActionId, string[]>>;

/** Keys that can never be bound (browser/OS reserved or needed to leave the remap UI). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['F11', 'F12', 'MetaLeft', 'MetaRight']);

export function resolveBindings(overrides: KeyOverrides): Record<ActionId, Binding> {
  const out = {} as Record<ActionId, Binding>;
  for (const a of ACTIONS as readonly ActionDef[]) {
    const keys = overrides[a.id as ActionId] ?? a.keys;
    out[a.id as ActionId] = { keys, pad: a.pad };
  }
  return out;
}

/** Binds `code` as the primary key of `action`; another action using it gets this action's old key. */
export function rebind(overrides: KeyOverrides, action: ActionId, code: string): KeyOverrides {
  if (RESERVED_KEYS.has(code)) return overrides;
  const current = resolveBindings(overrides);
  const mine = [...current[action].keys];
  const previous = mine[0];
  const next: KeyOverrides = {
    ...overrides,
    [action]: [code, ...mine.slice(1).filter((k) => k !== code)],
  };
  for (const [other, binding] of Object.entries(current) as [ActionId, Binding][]) {
    if (other === action || !binding.keys.includes(code)) continue;
    const replaced = binding.keys
      .map((k) => (k === code ? previous : k))
      .filter((k): k is string => k !== undefined);
    next[other] = [...new Set(replaced)];
  }
  return next;
}

/** Which action a keyboard event triggers. */
export function actionFor(bindings: Record<ActionId, Binding>, code: string): ActionId | null {
  for (const [id, b] of Object.entries(bindings) as [ActionId, Binding][])
    if (b.keys.includes(code)) return id;
  return null;
}
