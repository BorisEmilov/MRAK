/** Inventory/equipment slot: icon, quantity, empty/selected/disabled states, tooltip with details. */
import type { MouseEvent, ReactNode } from 'react';
import type { IconName } from '../icons/names';
import { useUiStrings } from '../strings';
import { CostList, type CostEntry } from './Cost';
import { IconGlyph } from './Icon';
import { Tooltip } from './Tooltip';

export interface ItemSlotProps {
  /** Empty slot when omitted. */
  item?: { icon: IconName; label: string; description?: ReactNode; quantity?: number };
  /** Shown when empty (e.g. "Amulet slot"); defaults to "Empty slot". */
  emptyLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  /** Using the item costs this. */
  cost?: readonly CostEntry[];
  consequence?: ReactNode;
  disabledReason?: string;
  /** Makes the slot a button. */
  onSelect?: () => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
}

export function ItemSlot({
  item,
  emptyLabel,
  size = 'md',
  selected = false,
  cost,
  consequence,
  disabledReason,
  onSelect,
  onContextMenu,
}: ItemSlotProps) {
  const { text } = useUiStrings();
  const label = item
    ? item.quantity !== undefined && item.quantity > 1
      ? `${item.label}, ${text('ui.quantity', { n: item.quantity })}`
      : item.label
    : (emptyLabel ?? text('ui.empty-slot'));
  const disabled = disabledReason !== undefined;
  const content = (
    <>
      <IconGlyph
        name={item?.icon ?? 'ui.inventory'}
        size={size === 'lg' ? 48 : size === 'sm' ? 24 : 32}
        tone={item ? 'inherit' : 'muted'}
      />
      {item?.quantity !== undefined && item.quantity > 1 && (
        <span className="mrak-slot-qty" aria-hidden="true">
          {item.quantity}
        </span>
      )}
    </>
  );
  const common = {
    className: 'mrak-slot mrak-focusable',
    'data-size': size,
    'data-empty': item ? undefined : 'true',
    'data-selected': selected || undefined,
    onContextMenu,
  };
  const extra =
    cost || consequence !== undefined || disabled ? (
      <>
        {cost && <CostList cost={cost} />}
        {consequence !== undefined && (
          <span>
            {' '}
            {text('ui.consequence')}: {consequence ?? text('ui.consequence-unknown')}
          </span>
        )}
        {disabled && <span> {text('ui.disabled-because', { reason: disabledReason })}</span>}
      </>
    ) : undefined;

  return (
    <Tooltip title={label} description={item?.description} extra={extra}>
      {onSelect ? (
        <button
          type="button"
          {...common}
          aria-label={label}
          aria-pressed={selected}
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) onSelect();
          }}
        >
          {content}
        </button>
      ) : (
        <span {...common} role="img" aria-label={label} tabIndex={0}>
          {content}
        </span>
      )}
    </Tooltip>
  );
}
