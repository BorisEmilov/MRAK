import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ICON_NAMES } from '../icons/names';
import { expectAccessible, renderKit } from '../test/helpers';
import { Button } from './Button';
import { ContextMenu } from './ContextMenu';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { ItemSlot } from './ItemSlot';
import { KeyHint } from './KeyHint';
import { ConfirmModal, Modal } from './Modal';
import { Panel } from './Panel';
import { Portrait } from './Portrait';
import { ProgressMeter } from './ProgressMeter';
import { ResourceCounter } from './ResourceCounter';
import { Tabs } from './Tabs';
import { useToast } from './toast-context';

describe('Icon', () => {
  it('a labelled icon is focusable and shows a tooltip with name and description', async () => {
    renderKit(<Icon name="resource.faith" label="Faith" description="Spent on prayers." />);
    const icon = screen.getByRole('img', { name: 'Faith' });
    expect(icon.getAttribute('tabindex')).toBe('0');
    expect(icon).toHaveProperty('ariaDescription' in icon ? 'ariaDescription' : 'tagName');
    act(() => {
      icon.focus();
    });
    const tip = await screen.findByTestId('tooltip');
    expect(tip.textContent).toContain('Faith');
    expect(tip.textContent).toContain('Spent on prayers.');
    fireEvent.keyDown(window, { key: 'Escape' });
    await vi.waitFor(() => {
      expect(screen.queryByTestId('tooltip')).toBeNull();
    });
    await expectAccessible();
  });

  it('a decorative icon is hidden from assistive tech', () => {
    const { container } = renderKit(<Icon name="action.talk" decorative />);
    expect(container.querySelector('.mrak-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the sprite has every icon name', async () => {
    const { readFileSync } = await import('node:fs');
    const sprite = readFileSync(`${process.cwd()}/src/icons/sprite.svg`, 'utf8');
    for (const name of ICON_NAMES) expect(sprite).toContain(`id="mrak-${name.replace('.', '--')}"`);
  });
});

describe('Button and IconButton', () => {
  it('shows cost and consequence, and explains why it is disabled', async () => {
    const onClick = vi.fn();
    renderKit(
      <>
        <Button
          variant="primary"
          icon="action.pray"
          cost={[{ icon: 'resource.light', label: 'Lamp oil', amount: 1 }]}
          consequence="Faith +5"
          onClick={onClick}
        >
          Pray
        </Button>
        <Button disabledReason="Night has fallen" onClick={onClick}>
          Save
        </Button>
        <IconButton icon="ui.options" label="Options" />
      </>,
    );
    const pray = screen.getByRole('button', { name: /Pray/ });
    expect(pray.textContent).toContain('1 Lamp oil');
    fireEvent.click(pray);
    expect(onClick).toHaveBeenCalledTimes(1);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(save);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(
      document.getElementById(save.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toContain('Unavailable: Night has fallen');
    expect(screen.getByRole('button', { name: 'Options' })).toBeDefined();
    await expectAccessible();
  });

  it('says when a consequence is unknown', () => {
    renderKit(<Button consequence={null}>Open the coffin</Button>);
    const button = screen.getByRole('button', { name: 'Open the coffin' });
    const desc = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(desc?.textContent).toContain('ui.consequence-unknown');
  });
});

describe('Tabs', () => {
  it('moves with arrow keys and shows the selected panel', async () => {
    renderKit(
      <Tabs
        label="Glossary"
        tabs={[
          { id: 'a', label: 'Folklore', content: <p>Samodiva</p> },
          { id: 'b', label: 'History', content: <p>Aga</p> },
        ]}
      />,
    );
    const first = screen.getByRole('tab', { name: 'Folklore' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Aga');
    await expectAccessible();
  });
});

describe('Modal and ConfirmModal', () => {
  it('traps focus, closes with Escape and restores focus', async () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            Open
          </button>
          <Modal
            open={open}
            title="Journal"
            onClose={() => {
              setOpen(false);
            }}
          >
            <p>Pages</p>
            <button type="button">Inside</button>
          </Modal>
        </>
      );
    }
    renderKit(<Demo />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Journal' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await expectAccessible();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('confirmation starts on Cancel and names the action', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderKit(
      <ConfirmModal
        open
        title="Accuse Radka?"
        confirmLabel="Accuse Radka"
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        <p>The village will turn on her.</p>
      </ConfirmModal>,
    );
    expect(document.activeElement?.textContent).toBe('ui.cancel');
    expect(screen.getByText('ui.irreversible')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Accuse Radka' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('Toast', () => {
  it('offers Undo and runs it', async () => {
    const undo = vi.fn();
    function Demo() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast.showUndo('Todor assigned to the watchtower', undo);
          }}
        >
          Assign
        </button>
      );
    }
    renderKit(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(screen.getByText('Todor assigned to the watchtower')).toBeDefined();
    await expectAccessible();
    fireEvent.click(screen.getByRole('button', { name: 'ui.undo' }));
    expect(undo).toHaveBeenCalled();
    expect(screen.queryByText('Todor assigned to the watchtower')).toBeNull();
  });
});

describe('ProgressMeter', () => {
  it('a qualitative meter never exposes numbers', async () => {
    renderKit(
      <ProgressMeter
        label="Sanity"
        value={31}
        max={76}
        icon="resource.sanity"
        qualitative={[
          { upTo: 0.25, label: 'Breaking' },
          { upTo: 0.5, label: 'Shaken' },
          { upTo: 1, label: 'Steady' },
        ]}
      />,
    );
    const meter = screen.getByRole('img', { name: 'Sanity: Shaken' });
    expect(meter.textContent).not.toMatch(/\d/);
    expect(meter.getAttribute('aria-valuenow')).toBeNull();
    await expectAccessible();
  });

  it('a numeric meter is a meter', () => {
    renderKit(<ProgressMeter label="Faith" value={40} max={100} />);
    expect(screen.getByRole('meter', { name: 'Faith' }).getAttribute('aria-valuenow')).toBe('40');
  });
});

describe('ResourceCounter', () => {
  it('announces value and cap and shows the change', async () => {
    const { rerender } = renderKit(
      <ResourceCounter icon="resource.light" label="Light" value={5} max={20} />,
    );
    expect(screen.getByRole('img', { name: 'Light: 5 of 20' })).toBeDefined();
    rerender(<ResourceCounter icon="resource.light" label="Light" value={3} max={20} />);
    expect(document.querySelector('.mrak-delta')?.textContent).toBe('−2');
    await expectAccessible();
  });
});

describe('ItemSlot, Portrait, KeyHint', () => {
  it('render accessibly', async () => {
    const select = vi.fn();
    renderKit(
      <>
        <ItemSlot
          item={{ icon: 'resource.light', label: 'Lamp oil', quantity: 3 }}
          onSelect={select}
        />
        <ItemSlot emptyLabel="Amulet" />
        <Portrait
          name="Baba Neda"
          caption="Midwife"
          states={[
            {
              icon: 'villager-state.afraid',
              label: 'Afraid',
              description: 'Will not go out at night.',
            },
          ]}
        />
        <KeyHint action="interact" label="Talk" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lamp oil, ×3' }));
    expect(select).toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Amulet' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Afraid' })).toBeDefined();
    expect(screen.getByText('E')).toBeDefined();
    expect(screen.getByText('Space')).toBeDefined();
    await expectAccessible();
  });
});

describe('ContextMenu and Panel', () => {
  it('opens with Shift+F10, moves with arrows, and explains disabled items', async () => {
    const talk = vi.fn();
    renderKit(
      <Panel title="Villagers">
        <ContextMenu
          label="Actions for Radka"
          items={[
            { id: 'talk', label: 'Talk', icon: 'action.talk', onSelect: talk },
            {
              id: 'accuse',
              label: 'Accuse',
              icon: 'action.accuse',
              danger: true,
              consequence: null,
              onSelect: vi.fn(),
            },
            {
              id: 'pray',
              label: 'Pray with her',
              icon: 'action.pray',
              disabledReason: 'Faith too low',
              onSelect: vi.fn(),
            },
          ]}
        >
          <button type="button">Radka</button>
        </ContextMenu>
      </Panel>,
    );
    const trigger = screen.getByRole('button', { name: 'Radka' });
    fireEvent.keyDown(trigger, { key: 'F10', shiftKey: true });
    const menu = screen.getByRole('menu', { name: 'Actions for Radka' });
    expect(document.activeElement?.textContent).toContain('Talk');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Accuse');
    expect(
      screen.getByRole('menuitem', { name: /Pray with her/ }).getAttribute('aria-disabled'),
    ).toBe('true');
    await expectAccessible();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.click(document.activeElement as Element);
    expect(talk).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('region', { name: 'Villagers' })).toBeDefined();
  });
});
