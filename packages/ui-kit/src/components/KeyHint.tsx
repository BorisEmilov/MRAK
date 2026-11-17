/**
 * KeyHint: shows the key (or gamepad button) bound to an action, for the device the player used
 * last. Keyboard names come from the kit strings; PlayStation shapes are spoken by name.
 */
import { padGlyph, type Binding } from '../input/devices';
import { useInput } from '../input/context';
import { keyLabel } from '../input/keys';
import { useUiStrings } from '../strings';

export interface KeyHintProps {
  /** Action id looked up in the InputProvider bindings… */
  action?: string;
  /** …or an explicit binding. */
  binding?: Binding;
  /** What the key does ("Talk"); shown after the key. */
  label?: string;
}

export function KeyHint({ action, binding, label }: KeyHintProps) {
  const { text } = useUiStrings();
  const { mode, padType, bindings } = useInput();
  const b = binding ?? (action !== undefined ? bindings[action] : undefined);
  if (!b) return null;

  let keys: { glyph: string; spoken?: string | undefined; pad?: string | undefined }[];
  if (mode === 'gamepad' && b.pad) {
    const g = padGlyph(b.pad, padType);
    keys = [{ glyph: g.glyph, spoken: g.spoken ? text(g.spoken) : undefined, pad: b.pad }];
  } else {
    keys = b.keys.slice(0, 2).map((code) => ({ glyph: keyLabel(code, text) }));
  }

  return (
    <span className="mrak-keyhint">
      {keys.map((k, i) => (
        <span key={`${k.glyph}-${String(i)}`}>
          {i > 0 && <span className="mrak-keyhint-label"> {text('ui.or')} </span>}
          <kbd className="mrak-key" data-pad={k.pad}>
            {k.spoken ? (
              <>
                <span aria-hidden="true">{k.glyph}</span>
                <span className="mrak-sr-only">{k.spoken}</span>
              </>
            ) : (
              k.glyph
            )}
          </kbd>
        </span>
      ))}
      {label && <span className="mrak-keyhint-label">{label}</span>}
    </span>
  );
}
