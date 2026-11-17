/**
 * ProgressMeter. `qualitative` meters (sanity) never show or announce numbers: only a word for
 * the band the value falls in (docs/systems/sanity.md: the player must not count sanity).
 */
import type { IconName } from '../icons/names';
import { bandOf, type MeterBand } from './meter';
import { IconGlyph } from './Icon';
import { Tooltip } from './Tooltip';

export interface ProgressMeterProps {
  label: string;
  description?: string;
  value: number;
  max: number;
  icon?: IconName;
  tone?: 'gold' | 'danger' | 'faith';
  /** Show words instead of numbers. */
  qualitative?: readonly MeterBand[];
  /** Shown/announced value text for numeric meters (default "value / max"). */
  valueText?: string;
}

export function ProgressMeter({
  label,
  description,
  value,
  max,
  icon,
  tone = 'gold',
  qualitative,
  valueText,
}: ProgressMeterProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const shown = qualitative
    ? (bandOf(ratio, qualitative)?.label ?? '')
    : (valueText ?? `${String(Math.round(value))} / ${String(max)}`);

  const a11y = qualitative
    ? ({ role: 'img', 'aria-label': `${label}: ${shown}` } as const)
    : ({
        role: 'meter',
        'aria-label': label,
        'aria-valuenow': value,
        'aria-valuemin': 0,
        'aria-valuemax': max,
        'aria-valuetext': shown,
      } as const);

  return (
    <Tooltip title={label} description={description}>
      <div
        className="mrak-meter mrak-focusable"
        data-tone={tone}
        data-qualitative={qualitative ? 'true' : undefined}
        tabIndex={0}
        {...a11y}
      >
        {icon && <IconGlyph name={icon} size={24} />}
        <div className="mrak-meter-body" aria-hidden="true">
          <div className="mrak-meter-label">
            <span>{label}</span>
            <span>{shown}</span>
          </div>
          <div className="mrak-meter-track">
            {/* Qualitative meters show the band, not the exact value. */}
            <div
              className="mrak-meter-fill"
              style={{
                width: `${String(qualitative ? (bandOf(ratio, qualitative)?.upTo ?? ratio) * 100 : ratio * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>
    </Tooltip>
  );
}
