import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { IconName } from '../icons/names';
import { useUiStrings } from '../strings';
import type { ButtonVariant } from './Button';
import { IconGlyph, type IconSize } from './Icon';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'disabled' | 'aria-label' | 'children'
> {
  icon: IconName;
  /** Required: accessible name and tooltip title. */
  label: string;
  description?: ReactNode;
  variant?: ButtonVariant;
  iconSize?: IconSize;
  /** Toggle buttons. */
  pressed?: boolean;
  disabledReason?: string;
}

/** Icon-only button: always has a label and a tooltip (UX pattern 1). */
export function IconButton({
  icon,
  label,
  description,
  variant = 'ghost',
  iconSize = 24,
  pressed,
  disabledReason,
  className,
  onClick,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const { text } = useUiStrings();
  const disabled = disabledReason !== undefined;
  return (
    <Tooltip
      title={label}
      description={description}
      extra={disabled ? text('ui.disabled-because', { reason: disabledReason }) : undefined}
    >
      <button
        {...rest}
        type={type}
        className={['mrak-button mrak-icon-button', className].filter(Boolean).join(' ')}
        data-variant={variant}
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          if (disabled) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
      >
        <IconGlyph name={icon} size={iconSize} tone="inherit" />
      </button>
    </Tooltip>
  );
}
