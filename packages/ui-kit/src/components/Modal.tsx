/**
 * Modal dialog: focus moves in and is trapped, Escape closes (unless `dismissible` is false), focus
 * returns to the opener when it closes. ConfirmModal implements UX pattern 3.
 */
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useUiStrings } from '../strings';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { IconGlyph } from './Icon';
import { Panel } from './Panel';

const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  /** Focused when the modal opens (default: the first focusable element). */
  initialFocus?: RefObject<HTMLElement | null>;
  dismissible?: boolean;
  size?: 'md' | 'lg' | 'xl';
  variant?: 'earth' | 'parchment';
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  initialFocus,
  dismissible = true,
  size = 'md',
  variant = 'earth',
}: ModalProps) {
  const { text } = useUiStrings();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target =
      initialFocus?.current ??
      dialog.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialog.current;
    target?.focus();
    return () => {
      opener?.focus();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !el.hasAttribute('disabled') && !el.closest('[hidden]'),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="mrak-modal-backdrop mrak-root"
      onPointerDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="mrak-modal"
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <Panel
          variant={variant}
          title={<span id={titleId}>{title}</span>}
          actions={
            dismissible ? (
              <IconButton icon="ui.close" label={text('ui.close')} onClick={onClose} />
            ) : undefined
          }
        >
          {children}
          {footer !== undefined && <div className="mrak-modal-footer">{footer}</div>}
        </Panel>
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmModalProps {
  open: boolean;
  /** Names the action: "Accuse Radka?" */
  title: ReactNode;
  /** What will be lost or changed for good. */
  children: ReactNode;
  /** Repeats the verb: "Accuse Radka". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Irreversible actions use the danger style and the warning line (default true). */
  irreversible?: boolean;
}

/** Confirmation for irreversible actions: focus starts on Cancel, Escape cancels. */
export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  irreversible = true,
}: ConfirmModalProps) {
  const { text } = useUiStrings();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      initialFocus={cancel}
      footer={
        <>
          <Button ref={cancel} onClick={onCancel}>
            {text('ui.cancel')}
          </Button>
          <Button variant={irreversible ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {irreversible && (
        <p className="mrak-confirm-warning">
          <IconGlyph name="ui.irreversible" size={20} tone="danger" />
          {text('ui.irreversible')}
        </p>
      )}
    </Modal>
  );
}
