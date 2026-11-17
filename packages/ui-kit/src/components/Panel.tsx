import { useId, type ReactNode } from 'react';
import type { IconName } from '../icons/names';
import { IconGlyph } from './Icon';

export interface PanelProps {
  title?: ReactNode;
  /** Decorative: the title names the panel. */
  icon?: IconName;
  /** Buttons shown at the right of the title (e.g. a close IconButton). */
  actions?: ReactNode;
  variant?: 'earth' | 'parchment';
  /** Heading level of the title (default 2). */
  level?: 2 | 3;
  className?: string;
  children?: ReactNode;
}

/** Engraved frame: double rule, faint hatching, corner diamonds. */
export function Panel({
  title,
  icon,
  actions,
  variant = 'earth',
  level = 2,
  className,
  children,
}: PanelProps) {
  const id = useId();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      className={['mrak-panel mrak-root', className].filter(Boolean).join(' ')}
      data-variant={variant}
      aria-labelledby={title !== undefined ? id : undefined}
    >
      {(title !== undefined || actions !== undefined) && (
        <div className="mrak-panel-header">
          {icon && <IconGlyph name={icon} size={32} />}
          {title !== undefined && (
            <Heading id={id} className="mrak-panel-title mrak-display">
              {title}
            </Heading>
          )}
          {actions !== undefined && <div className="mrak-panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
