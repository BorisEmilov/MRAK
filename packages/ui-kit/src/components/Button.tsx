/**
 * Button. Shows its cost and known consequence (UX pattern 2); when disabled it stays focusable
 * (aria-disabled) and its tooltip explains why (pattern 5). `irreversible` marks actions that the
 * caller must confirm with ConfirmModal (pattern 3).
 */
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import type { IconName } from '../icons/names';
import { useUiStrings } from '../strings';
import { CostList, type CostEntry } from './Cost';
import { IconGlyph } from './Icon';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  /** Decorative icon before the text. */
  icon?: IconName | undefined;
  cost?: readonly CostEntry[];
  /** Known consequence; pass `null` when the consequence is unknown (it is then said so). */
  consequence?: ReactNode;
  /** Shows the consequence under the label instead of only in the tooltip. */
  showConsequence?: boolean;
  irreversible?: boolean;
  /** Disables the button; the reason is shown in its tooltip. */
  disabledReason?: string;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  cost,
  consequence,
  showConsequence = false,
  irreversible = false,
  disabledReason,
  loading = false,
  className,
  onClick,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const { text } = useUiStrings();
  const disabled = disabledReason !== undefined;
  const consequenceText = consequence === null ? text('ui.consequence-unknown') : consequence;
  const hasDetails = cost !== undefined || consequence !== undefined || disabled || irreversible;

  const button = (
    <button
      {...rest}
      type={type}
      className={['mrak-button', className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      aria-disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (disabled || loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {icon && (
        <IconGlyph
          name={icon}
          size={20}
          tone={variant === 'primary' || variant === 'danger' ? 'inherit' : 'auto'}
        />
      )}
      {irreversible && <IconGlyph name="ui.irreversible" size={16} tone="inherit" />}
      <span className="mrak-button-body">
        <span>{children}</span>
        {showConsequence && consequenceText !== undefined && (
          <span className="mrak-button-consequence">{consequenceText}</span>
        )}
      </span>
      {cost && cost.length > 0 && <CostList cost={cost} />}
    </button>
  );

  if (!hasDetails) return button;
  return (
    <Tooltip
      title={children}
      description={disabled ? text('ui.disabled-because', { reason: disabledReason }) : undefined}
      extra={
        consequenceText !== undefined || irreversible ? (
          <>
            {consequenceText !== undefined && !showConsequence && (
              <>
                {text('ui.consequence')}: {consequenceText}
              </>
            )}
            {irreversible && <> {text('ui.irreversible')}</>}
          </>
        ) : undefined
      }
    >
      {button}
    </Tooltip>
  );
}
