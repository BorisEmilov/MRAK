/** WAI-ARIA tabs: arrow keys / Home / End move and select, roving tabindex. */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { IconName } from '../icons/names';
import { IconGlyph } from './Icon';

export interface TabItem {
  id: string;
  label: string;
  icon?: IconName;
  content: ReactNode;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  /** Accessible name of the tab list. */
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
}

export function Tabs({ tabs, label, value, defaultValue, onChange }: TabsProps) {
  const base = useId();
  const [inner, setInner] = useState(defaultValue ?? tabs[0]?.id ?? '');
  const selected = value ?? inner;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string, focus = false): void => {
    if (value === undefined) setInner(id);
    onChange?.(id);
    if (focus) refs.current.get(id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = tabs.findIndex((t) => t.id === selected);
    const last = tabs.length - 1;
    const target =
      e.key === 'ArrowRight'
        ? i === last
          ? 0
          : i + 1
        : e.key === 'ArrowLeft'
          ? i === 0
            ? last
            : i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    const tab = tabs[target];
    if (target < 0 || !tab) return;
    e.preventDefault();
    select(tab.id, true);
  };

  return (
    <div className="mrak-tabs">
      <div className="mrak-tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            className="mrak-tab"
            aria-selected={t.id === selected}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={t.id === selected ? 0 : -1}
            onClick={() => {
              select(t.id);
            }}
          >
            {t.icon && <IconGlyph name={t.icon} size={20} tone="inherit" />}
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== selected}
          tabIndex={0}
        >
          {t.id === selected && t.content}
        </div>
      ))}
    </div>
  );
}
