/** Resource with icon, value, optional cap and a short "+n / −n" badge when it changes. */
import { useEffect, useState, type ReactNode } from 'react';
import type { IconName } from '../icons/names';
import { useUiStrings } from '../strings';
import { IconGlyph } from './Icon';
import { Tooltip } from './Tooltip';

export const DELTA_VISIBLE_MS = 1800;

export interface ResourceCounterProps {
  icon: IconName;
  label: string;
  description?: ReactNode;
  value: number;
  max?: number;
  /** Highlights the value as low (with the word in `lowLabel`, never colour alone). */
  low?: boolean;
  lowLabel?: string;
}

export function ResourceCounter({
  icon,
  label,
  description,
  value,
  max,
  low = false,
  lowLabel,
}: ResourceCounterProps) {
  const { text } = useUiStrings();
  // Derived from the previous value during render (no effect needed to detect the change).
  const [prev, setPrev] = useState(value);
  const [delta, setDelta] = useState<{ amount: number; key: number } | null>(null);
  if (prev !== value) {
    setPrev(value);
    setDelta((d) => ({ amount: value - prev, key: (d?.key ?? 0) + 1 }));
  }

  useEffect(() => {
    if (!delta) return undefined;
    const timer = window.setTimeout(() => {
      setDelta(null);
    }, DELTA_VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [delta]);

  const amount = max === undefined ? String(value) : text('ui.of-max', { value, max });
  const name = `${label}: ${amount}${low && lowLabel ? ` (${lowLabel})` : ''}`;

  return (
    <Tooltip title={label} description={description}>
      <span
        className="mrak-counter mrak-focusable"
        role="img"
        aria-label={name}
        tabIndex={0}
        data-low={low || undefined}
      >
        <IconGlyph name={icon} size={24} />
        <span className="mrak-counter-value" aria-hidden="true">
          {value}
        </span>
        {max !== undefined && (
          <span className="mrak-counter-max" aria-hidden="true">
            / {max}
          </span>
        )}
        {delta && delta.amount !== 0 && (
          <span
            key={delta.key}
            className="mrak-delta"
            data-sign={delta.amount > 0 ? '+' : '-'}
            aria-hidden="true"
          >
            {delta.amount > 0 ? '+' : '−'}
            {Math.abs(delta.amount)}
          </span>
        )}
      </span>
    </Tooltip>
  );
}
