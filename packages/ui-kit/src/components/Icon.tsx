/**
 * Icon from the single SVG sprite. Every icon is either labelled — focusable, with a tooltip that
 * shows its name and description — or explicitly `decorative`, which is allowed only next to a
 * visible text label (docs/ui/design-system.md → UX patterns 1).
 */
import type { ReactNode } from 'react';
import { ICON_INFO, type IconName } from '../icons/names';
import { symbolHref } from '../icons/sprite';
import { Tooltip } from './Tooltip';

export type IconTone = 'auto' | 'inherit' | 'danger' | 'good' | 'bad' | 'info' | 'muted';
export type IconSize = 16 | 20 | 24 | 32 | 48;

interface BaseProps {
  name: IconName;
  size?: IconSize;
  tone?: IconTone;
  className?: string | undefined;
}

export type IconProps = BaseProps &
  (
    | { decorative: true; label?: never; description?: never }
    | { decorative?: false; label: string; description?: ReactNode }
  );

function toneOf(name: IconName, tone: IconTone): string | undefined {
  if (tone === 'inherit') return undefined;
  if (tone !== 'auto') return tone;
  return ICON_INFO[name].category;
}

/** The bare SVG (always aria-hidden). */
export function IconGlyph({ name, size = 24, tone = 'auto', className }: BaseProps) {
  return (
    <span
      className={['mrak-icon', className].filter(Boolean).join(' ')}
      data-tone={toneOf(name, tone)}
      style={{ width: `${String(size / 16)}rem`, height: `${String(size / 16)}rem` }}
      aria-hidden="true"
    >
      <svg focusable="false">
        <use href={symbolHref(name)} />
      </svg>
    </span>
  );
}

export function Icon(props: IconProps) {
  const { name, size, tone, className } = props;
  const glyph = (
    <IconGlyph name={name} size={size ?? 24} tone={tone ?? 'auto'} className={className} />
  );
  if (props.decorative) return glyph;
  return (
    <Tooltip title={props.label} description={props.description}>
      <span
        className="mrak-icon-trigger mrak-focusable"
        role="img"
        aria-label={props.label}
        tabIndex={0}
      >
        {glyph}
      </span>
    </Tooltip>
  );
}
