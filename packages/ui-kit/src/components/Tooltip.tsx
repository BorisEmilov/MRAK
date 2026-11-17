/**
 * Tooltip (WCAG 1.4.13): opens on hover (after a short delay) and on keyboard focus, stays open
 * while the pointer is over it, closes with Escape. The visual bubble is aria-hidden; screen
 * readers get the description through `aria-describedby` on the trigger. The trigger is wrapped in
 * a `display: contents` span that owns the ref and the events, so any element works as a trigger.
 */
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export const TOOLTIP_DELAY_MS = 350;
const GAP = 8;

export interface TooltipProps {
  /** Shown in bold; the trigger must already carry this as its accessible name. */
  title: ReactNode;
  description?: ReactNode;
  /** Extra block (cost, consequence, disabled reason), also announced. */
  extra?: ReactNode;
  /** A single element that accepts DOM props and a ref. */
  children: ReactElement<TriggerProps>;
}

interface TriggerProps {
  'aria-describedby'?: string | undefined;
}

function place(anchor: DOMRect, bubble: DOMRect): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = anchor.top - bubble.height - GAP;
  if (top < GAP) top = Math.min(anchor.bottom + GAP, vh - bubble.height - GAP);
  let left = anchor.left + anchor.width / 2 - bubble.width / 2;
  left = Math.max(GAP, Math.min(left, vw - bubble.width - GAP));
  return { left, top };
}

export function Tooltip({ title, description, extra, children }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement | null>(null);
  const bubble = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const clear = (): void => {
    window.clearTimeout(timer.current);
  };
  const show = useCallback((delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOpen(true);
    }, delay);
  }, []);
  const hide = useCallback((delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOpen(false);
      setPos(null);
    }, delay);
  }, []);

  useEffect(() => clear, []);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    // The anchor is `display: contents` (no box): measure the trigger inside it.
    const target = anchor.current.firstElementChild ?? anchor.current;
    const next = place(target.getBoundingClientRect(), bubble.current.getBoundingClientRect());
    setPos((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') hide(0);
    };
    const onScroll = (): void => {
      hide(0);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, hide]);

  const describedBy = [
    children.props['aria-describedby'],
    description !== undefined || extra !== undefined ? id : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  const trigger = cloneElement(children, { 'aria-describedby': describedBy || undefined });

  return (
    <>
      <span
        ref={anchor}
        className="mrak-tooltip-anchor"
        onPointerEnter={(e: PointerEvent<HTMLSpanElement>) => {
          if (e.pointerType !== 'touch') show(TOOLTIP_DELAY_MS);
        }}
        onPointerLeave={() => {
          hide(120);
        }}
        onFocus={() => {
          show(0);
        }}
        onBlur={() => {
          hide(0);
        }}
      >
        {trigger}
      </span>
      {(description !== undefined || extra !== undefined) && (
        <span id={id} className="mrak-sr-only">
          {description}
          {description !== undefined && extra !== undefined ? ' ' : null}
          {extra}
        </span>
      )}
      {open &&
        createPortal(
          <div
            ref={bubble}
            className="mrak-tooltip mrak-root"
            aria-hidden="true"
            data-testid="tooltip"
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
            onPointerEnter={clear}
            onPointerLeave={() => {
              hide(120);
            }}
          >
            <span className="mrak-tooltip-title">{title}</span>
            {description !== undefined && <span className="mrak-tooltip-desc">{description}</span>}
            {extra !== undefined && <span className="mrak-tooltip-extra">{extra}</span>}
          </div>,
          document.body,
        )}
    </>
  );
}
