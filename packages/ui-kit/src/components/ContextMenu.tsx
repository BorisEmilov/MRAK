/**
 * ContextMenu: opens on right click, long-press (touch), the Menu key, Shift+F10 or gamepad Y.
 * Items show icon, cost and known consequence; disabled items say why. Arrow keys move, Enter
 * activates, Escape/Tab close and return focus. Every action must also exist elsewhere in the UI
 * (UX pattern 6) — this is a shortcut, never the only way.
 */
import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { IconName } from '../icons/names';
import { useUiStrings } from '../strings';
import { CostList, type CostEntry } from './Cost';
import { IconGlyph } from './Icon';

export const LONG_PRESS_MS = 500;

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: IconName;
  cost?: readonly CostEntry[];
  /** Known consequence; `null` = unknown (said so). */
  consequence?: ReactNode;
  disabledReason?: string;
  /** Irreversible: the caller confirms in onSelect (ConfirmModal). */
  danger?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  /** Accessible name of the menu ("Actions for Radka"). */
  label: string;
  items: readonly ContextMenuItem[];
  children: ReactElement<TriggerProps>;
}

interface TriggerProps {
  'aria-haspopup'?: 'menu';
  'aria-expanded'?: boolean;
}

export function ContextMenu({ label, items, children }: ContextMenuProps) {
  const { text } = useUiStrings();
  const id = useId();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const menu = useRef<HTMLUListElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const press = useRef<number | undefined>(undefined);

  const open = (x: number, y: number, from: HTMLElement): void => {
    opener.current = from;
    setPos(null);
    setAt({ x, y });
  };
  const close = (refocus = true): void => {
    setAt(null);
    if (refocus) opener.current?.focus();
  };

  useLayoutEffect(() => {
    if (!at || !menu.current) return;
    const r = menu.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)),
    });
    menu.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return undefined;
    const onDown = (e: globalThis.PointerEvent): void => {
      if (menu.current && !menu.current.contains(e.target as Node)) close(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [at]);

  const trigger = cloneElement(children, { 'aria-haspopup': 'menu', 'aria-expanded': at !== null });
  const triggerElement = (e: {
    target: EventTarget | null;
    currentTarget: HTMLElement;
  }): HTMLElement => (e.currentTarget.firstElementChild as HTMLElement | null) ?? e.currentTarget;
  const cancelPress = (): void => {
    window.clearTimeout(press.current);
  };

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>): void => {
    const list = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number): void => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close();
  };

  return (
    <>
      <span
        className="mrak-tooltip-anchor"
        onContextMenu={(e: MouseEvent<HTMLSpanElement>) => {
          e.preventDefault();
          open(e.clientX, e.clientY, triggerElement(e));
        }}
        onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault();
            const el = triggerElement(e);
            const r = el.getBoundingClientRect();
            open(r.left, r.bottom, el);
          }
        }}
        onPointerDown={(e: PointerEvent<HTMLSpanElement>) => {
          if (e.pointerType !== 'touch') return;
          const el = triggerElement(e);
          const { clientX, clientY } = e;
          press.current = window.setTimeout(() => {
            open(clientX, clientY, el);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
      >
        {trigger}
      </span>
      {at &&
        createPortal(
          <ul
            ref={menu}
            id={id}
            className="mrak-menu mrak-root"
            role="menu"
            aria-label={label}
            style={pos ?? { left: -9999, top: -9999 }}
            onKeyDown={onMenuKey}
          >
            {items.map((item) => {
              const disabled = item.disabledReason !== undefined;
              const detail = disabled
                ? text('ui.disabled-because', { reason: item.disabledReason ?? '' })
                : item.consequence === null
                  ? text('ui.consequence-unknown')
                  : item.consequence;
              const detailId = `${id}-${item.id}`;
              return (
                <li key={item.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="mrak-menuitem"
                    tabIndex={-1}
                    aria-disabled={disabled || undefined}
                    aria-describedby={detail !== undefined ? detailId : undefined}
                    data-danger={item.danger || undefined}
                    onClick={() => {
                      if (disabled) return;
                      close();
                      item.onSelect();
                    }}
                  >
                    {item.icon && (
                      <IconGlyph
                        name={item.icon}
                        size={24}
                        tone={item.danger ? 'danger' : 'auto'}
                      />
                    )}
                    {item.danger && <IconGlyph name="ui.irreversible" size={16} tone="danger" />}
                    <span className="mrak-menuitem-body">
                      <span>{item.label}</span>
                      {detail !== undefined && (
                        <span id={detailId} className="mrak-menuitem-detail">
                          {detail}
                        </span>
                      )}
                    </span>
                    {item.cost && <CostList cost={item.cost} />}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
