import type { IconName } from '../icons/names';
import { useUiStrings } from '../strings';
import { IconGlyph } from './Icon';

/** One resource spent (or gained, with a negative amount) by an action. */
export interface CostEntry {
  icon: IconName;
  /** Resource name, e.g. "Lamp oil" (spoken and shown in tooltips). */
  label: string;
  amount: number;
}

/** "−2 [oil] −1 [faith]" with a spoken equivalent. */
export function CostList({ cost }: { cost: readonly CostEntry[] }) {
  const { text } = useUiStrings();
  return (
    <span className="mrak-cost">
      <span className="mrak-sr-only">{text('ui.cost')}:</span>
      {cost.map((c) => (
        <span key={`${c.icon}-${c.label}`} className="mrak-cost-item">
          <span aria-hidden="true">
            {c.amount > 0 ? '−' : '+'}
            {Math.abs(c.amount)}
          </span>
          <IconGlyph name={c.icon} size={16} />
          <span className="mrak-sr-only">
            {Math.abs(c.amount)} {c.label}
          </span>
        </span>
      ))}
    </span>
  );
}
