/** Villager/guardian portrait in an engraved oval, with state badges (each with a tooltip). */
import type { ReactNode } from 'react';
import type { IconName } from '../icons/names';
import { Icon } from './Icon';

export interface PortraitState {
  icon: IconName;
  label: string;
  description?: ReactNode;
}

export interface PortraitProps {
  name: string;
  /** Image URL; without one, a monogram is drawn. */
  src?: string;
  /** Short role/epithet under the name. */
  caption?: string;
  states?: readonly PortraitState[];
  dead?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
}

function monogram(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function Portrait({
  name,
  src,
  caption,
  states = [],
  dead = false,
  size = 'md',
  showName = true,
}: PortraitProps) {
  return (
    <figure
      className="mrak-portrait"
      data-size={size}
      data-dead={dead || undefined}
      style={{ margin: 0 }}
    >
      <div className="mrak-portrait-frame" role="img" aria-label={name}>
        {src ? (
          <img src={src} alt="" />
        ) : (
          <span className="mrak-portrait-monogram" aria-hidden="true">
            {monogram(name)}
          </span>
        )}
      </div>
      {showName && (
        <figcaption className="mrak-portrait-name">
          {name}
          {caption && (
            <>
              <br />
              <span className="mrak-portrait-caption">{caption}</span>
            </>
          )}
        </figcaption>
      )}
      {states.length > 0 && (
        <div className="mrak-portrait-states">
          {states.map((s) => (
            <Icon
              key={s.icon}
              name={s.icon}
              label={s.label}
              description={s.description}
              size={20}
            />
          ))}
        </div>
      )}
    </figure>
  );
}
