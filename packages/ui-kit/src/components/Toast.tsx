/**
 * Toasts: short, polite announcements; an optional action (Undo — UX pattern 4). Timers pause
 * while a toast is hovered or focused, so the action is always reachable.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUiStrings } from '../strings';
import { Button } from './Button';
import { IconGlyph } from './Icon';
import { IconButton } from './IconButton';
import {
  TOAST_DURATION_MS,
  ToastContext,
  UNDO_DURATION_MS,
  type ToastItem,
  type ToastOptions,
} from './toast-context';

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { text } = useUiStrings();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(
    toast.durationMs ?? (toast.action ? UNDO_DURATION_MS : TOAST_DURATION_MS),
  );

  useEffect(() => {
    if (paused) return undefined;
    const started = Date.now();
    const timer = window.setTimeout(onDismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, onDismiss]);

  return (
    <div
      className="mrak-toast"
      data-tone={toast.tone ?? 'neutral'}
      onPointerEnter={() => {
        setPaused(true);
      }}
      onPointerLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
    >
      {toast.icon && <IconGlyph name={toast.icon} size={24} />}
      <span className="mrak-toast-message">{toast.message}</span>
      {toast.action && (
        <Button
          variant="ghost"
          icon={toast.action.label === text('ui.undo') ? 'ui.undo' : undefined}
          onClick={() => {
            toast.action?.onAction();
            onDismiss();
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton icon="ui.close" label={text('ui.close')} iconSize={20} onClick={onDismiss} />
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { text } = useUiStrings();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);
  const show = useCallback((toast: ToastOptions) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-3), { ...toast, id }]);
    return id;
  }, []);
  const showUndo = useCallback(
    (message: ReactNode, onUndo: () => void) =>
      show({ message, icon: 'ui.undo', action: { label: text('ui.undo'), onAction: onUndo } }),
    [show, text],
  );
  const api = useMemo(() => ({ show, showUndo, dismiss }), [show, showUndo, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="mrak-toasts mrak-root" role="region" aria-label={text('ui.notifications')}>
          <div aria-live="polite" aria-relevant="additions">
            {toasts.map((t) => (
              <ToastView
                key={t.id}
                toast={t}
                onDismiss={() => {
                  dismiss(t.id);
                }}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
