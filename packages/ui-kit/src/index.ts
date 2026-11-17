/** @mrak/ui-kit — shared React UI (docs/ui/design-system.md). Import './styles/index.css' once. */
export { Button, type ButtonProps, type ButtonVariant } from './components/Button';
export { ContextMenu, type ContextMenuItem, type ContextMenuProps } from './components/ContextMenu';
export { CostList, type CostEntry } from './components/Cost';
export { Icon, IconGlyph, type IconProps, type IconSize, type IconTone } from './components/Icon';
export { symbolHref } from './icons/sprite';
export { IconButton, type IconButtonProps } from './components/IconButton';
export { ItemSlot, type ItemSlotProps } from './components/ItemSlot';
export { KeyHint, type KeyHintProps } from './components/KeyHint';
export { keyLabel } from './input/keys';
export { ConfirmModal, Modal, type ConfirmModalProps, type ModalProps } from './components/Modal';
export { Panel, type PanelProps } from './components/Panel';
export { Portrait, type PortraitProps, type PortraitState } from './components/Portrait';
export { ProgressMeter, type ProgressMeterProps } from './components/ProgressMeter';
export { bandOf, type MeterBand } from './components/meter';
export { ResourceCounter, type ResourceCounterProps } from './components/ResourceCounter';
export { Tabs, type TabItem, type TabsProps } from './components/Tabs';
export { ToastProvider } from './components/Toast';
export { useToast, type ToastOptions } from './components/toast-context';
export { Tooltip, type TooltipProps } from './components/Tooltip';
export { ICON_AUTHORS, ICON_INFO, ICON_NAMES, type IconName } from './icons/names';
export {
  PAD_INDEX,
  padGlyph,
  padTypeOf,
  type Binding,
  type InputMode,
  type PadButton,
  type PadType,
} from './input/devices';
export { InputProvider } from './input/InputProvider';
export { useInput, type InputState } from './input/context';
export { focusScope, moveFocus, pickInDirection, type Direction } from './input/spatial';
export {
  createUiStrings,
  UI_STRING_KEYS,
  useUiStrings,
  type UiStringKey,
  type UiStrings,
} from './strings';
export { UiKitProvider } from './UiKitProvider';
export {
  COLORBLIND_MODES,
  contrast,
  MIN_TEXT_PX,
  PALETTE,
  TEXT_SCALES,
  TEXT_SIZES,
  type ColorblindMode,
  type TextScale,
} from './tokens';
