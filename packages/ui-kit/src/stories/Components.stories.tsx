/* One story group per component. Copy here is sample game text, as it would come from en.json. */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../components/Button';
import { ContextMenu } from '../components/ContextMenu';
import { Icon } from '../components/Icon';
import { IconButton } from '../components/IconButton';
import { ItemSlot } from '../components/ItemSlot';
import { KeyHint } from '../components/KeyHint';
import { ConfirmModal, Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { Portrait } from '../components/Portrait';
import { ProgressMeter } from '../components/ProgressMeter';
import { ResourceCounter } from '../components/ResourceCounter';
import { Tabs } from '../components/Tabs';
import { useToast } from '../components/toast-context';

const meta: Meta = { title: 'Components' };
export default meta;
type Story = StoryObj;

const oil = { icon: 'resource.light', label: 'Lamp oil', amount: 1 } as const;
const SANITY_BANDS = [
  { upTo: 0.2, label: 'Breaking' },
  { upTo: 0.45, label: 'Shaken' },
  { upTo: 0.75, label: 'Uneasy' },
  { upTo: 1, label: 'Steady' },
];

export const PanelStory: Story = {
  name: 'Panel',
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 520 }}>
      <Panel
        title="The chapel"
        icon="building.chapel"
        actions={<IconButton icon="ui.close" label="Close" />}
      >
        <p>Cold stone and the smell of old wax. Pop Stoyan keeps the lamp burning.</p>
      </Panel>
      <Panel title="A letter" variant="parchment" level={3}>
        <p>Written in a careful hand, the ink faded brown.</p>
      </Panel>
    </div>
  ),
};

export const ButtonStory: Story = {
  name: 'Button',
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      <Button variant="primary" icon="action.pray" cost={[oil]} consequence="Faith +5 until dawn">
        Pray
      </Button>
      <Button icon="action.gather" consequence="Two hours pass" showConsequence>
        Gather herbs
      </Button>
      <Button variant="danger" icon="action.accuse" irreversible consequence={null}>
        Accuse Radka
      </Button>
      <Button variant="ghost">Later</Button>
      <Button disabledReason="You cannot save by hand at night.">Save</Button>
      <Button loading icon="ui.save">
        Saving
      </Button>
      <Button size="lg" variant="primary">
        New game
      </Button>
    </div>
  ),
};

export const IconButtonStory: Story = {
  name: 'IconButton',
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <IconButton
        icon="ui.journal"
        label="Journal"
        description="Clues, people and pages you found."
      />
      <IconButton icon="ui.map" label="Map" />
      <IconButton icon="ui.caption" label="Sound captions" pressed />
      <IconButton icon="ui.options" label="Options" variant="secondary" />
      <IconButton icon="ui.save" label="Save" disabledReason="Night has fallen." />
    </div>
  ),
};

export const TooltipStory: Story = {
  name: 'Tooltip',
  render: () => (
    <p style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      Hover or focus:
      <Icon
        name="resource.corruption"
        label="Corruption"
        description="How far the Horned One has reached into you. It never goes down on its own."
      />
      <Icon
        name="omen.bad"
        label="Bad omen"
        description="A raven on the roof: something will go wrong tonight."
      />
    </p>
  ),
};

export const TabsStory: Story = {
  name: 'Tabs',
  render: () => (
    <Tabs
      label="Glossary"
      tabs={[
        {
          id: 'folklore',
          label: 'Folklore',
          icon: 'ui.glossary',
          content: (
            <p>
              <strong>samodiva</strong> — forest and mountain fairy.
            </p>
          ),
        },
        {
          id: 'history',
          label: 'History',
          icon: 'faction.ottoman-authority',
          content: (
            <p>
              <strong>aga</strong> — Ottoman local notable.
            </p>
          ),
        },
        {
          id: 'game',
          label: 'Game terms',
          icon: 'ui.info',
          content: (
            <p>
              <strong>Revelation</strong> — earned from milestones, spent on talents.
            </p>
          ),
        },
      ]}
    />
  ),
};

function ModalDemo() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Open journal
      </Button>
      <Button
        variant="danger"
        irreversible
        onClick={() => {
          setConfirm(true);
        }}
      >
        Accuse Radka
      </Button>
      <Modal
        open={open}
        title="Journal"
        onClose={() => {
          setOpen(false);
        }}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setOpen(false);
            }}
          >
            Done
          </Button>
        }
      >
        <p>Night 3. The bell rang at 3:33. Velika walked in her sleep toward the mill.</p>
      </Modal>
      <ConfirmModal
        open={confirm}
        title="Accuse Radka?"
        confirmLabel="Accuse Radka"
        onConfirm={() => {
          setConfirm(false);
        }}
        onCancel={() => {
          setConfirm(false);
        }}
      >
        <p>The village will believe you. Radka will be driven out, or worse.</p>
      </ConfirmModal>
    </div>
  );
}
export const ModalStory: Story = { name: 'Modal', render: () => <ModalDemo /> };

function ToastDemo() {
  const toast = useToast();
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <Button
        onClick={() =>
          toast.show({
            message: 'Todor finished the watchtower.',
            icon: 'building.watchtower',
            tone: 'good',
          })
        }
      >
        Notice
      </Button>
      <Button
        onClick={() =>
          toast.showUndo('Krastyo assigned to gather firewood.', () =>
            toast.show({ message: 'Assignment undone.' }),
          )
        }
      >
        Assign (with undo)
      </Button>
    </div>
  );
}
export const ToastStory: Story = { name: 'Toast', render: () => <ToastDemo /> };

export const ProgressMeterStory: Story = {
  name: 'ProgressMeter',
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 360 }}>
      <ProgressMeter
        label="Sanity"
        description="Shown without numbers."
        value={30}
        max={76}
        icon="resource.sanity"
        tone="danger"
        qualitative={SANITY_BANDS}
      />
      <ProgressMeter label="Faith" value={40} max={100} icon="resource.faith" tone="faith" />
      <ProgressMeter
        label="Watchtower"
        value={3}
        max={5}
        icon="building.watchtower"
        valueText="3 of 5 days"
      />
    </div>
  ),
};

function CounterDemo() {
  const [light, setLight] = useState(12);
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <ResourceCounter
        icon="resource.light"
        label="Light"
        description="Lamp oil and candles."
        value={light}
        max={20}
        low={light < 5}
        lowLabel="running out"
      />
      <ResourceCounter icon="resource.food" label="Food" value={7} />
      <ResourceCounter icon="resource.faith" label="Faith" value={40} />
      <ResourceCounter icon="resource.corruption" label="Corruption" value={3} />
      <Button
        onClick={() => {
          setLight((v) => Math.max(0, v - 3));
        }}
      >
        Burn oil
      </Button>
      <Button
        onClick={() => {
          setLight((v) => Math.min(20, v + 2));
        }}
      >
        Buy oil
      </Button>
    </div>
  );
}
export const ResourceCounterStory: Story = {
  name: 'ResourceCounter',
  render: () => <CounterDemo />,
};

export const ItemSlotStory: Story = {
  name: 'ItemSlot',
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <ItemSlot
        item={{
          icon: 'skill.exorcism',
          label: 'Holy water',
          description: 'Blessed at Theophany.',
          quantity: 2,
        }}
        onSelect={() => undefined}
        cost={[oil]}
        consequence="Burns any demon it touches"
      />
      <ItemSlot
        item={{ icon: 'talent.red-thread', label: 'Red thread' }}
        selected
        onSelect={() => undefined}
      />
      <ItemSlot
        item={{ icon: 'talent.steady-lead', label: 'Lead' }}
        disabledReason="Needs a fire"
        onSelect={() => undefined}
      />
      <ItemSlot emptyLabel="Amulet slot" />
      <ItemSlot
        size="lg"
        item={{ icon: 'talent.black-candle', label: 'Black candle', quantity: 1 }}
      />
      <ItemSlot size="sm" item={{ icon: 'resource.food', label: 'Bread', quantity: 5 }} />
    </div>
  ),
};

export const PortraitStory: Story = {
  name: 'Portrait',
  render: () => (
    <div style={{ display: 'flex', gap: 24 }}>
      <Portrait
        name="Baba Neda"
        caption="Midwife"
        states={[
          {
            icon: 'villager-state.suspicious',
            label: 'Suspicious',
            description: 'She watches you when you pass.',
          },
        ]}
      />
      <Portrait
        name="Velika"
        caption="Miller's daughter"
        states={[
          { icon: 'villager-state.afraid', label: 'Afraid' },
          { icon: 'villager-state.sick', label: 'Sick' },
        ]}
      />
      <Portrait
        name="Petko"
        dead
        states={[
          {
            icon: 'villager-state.dead',
            label: 'Dead',
            description: 'Found at the crossroads on the fourth night.',
          },
        ]}
      />
      <Portrait name="Todor" size="sm" />
      <Portrait name="Pop Stoyan" size="lg" caption="Priest" />
    </div>
  ),
};

export const KeyHintStory: Story = {
  name: 'KeyHint',
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <p>Switch the device in the toolbar (keyboard / Xbox / PlayStation / Nintendo).</p>
      <KeyHint action="interact" label="Talk" />
      <KeyHint action="journal" label="Journal" />
      <KeyHint action="back" label="Back" />
      <KeyHint binding={{ keys: ['KeyW', 'ArrowUp'] }} label="Walk" />
      <KeyHint action="quickSave" label="Quick save" />
    </div>
  ),
};

export const ContextMenuStory: Story = {
  name: 'ContextMenu',
  render: () => (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <p>Right-click, long-press, Shift+F10, the Menu key or gamepad Y on Radka:</p>
      <ContextMenu
        label="Actions for Radka"
        items={[
          {
            id: 'talk',
            label: 'Talk',
            icon: 'action.talk',
            consequence: 'One hour passes',
            onSelect: () => undefined,
          },
          {
            id: 'pray',
            label: 'Pray with her',
            icon: 'action.pray',
            cost: [oil],
            consequence: 'Her fear lessens',
            onSelect: () => undefined,
          },
          {
            id: 'photo',
            label: 'Photograph',
            icon: 'action.photograph',
            disabledReason: 'Daguerreotypes arrive in 1858',
            onSelect: () => undefined,
          },
          {
            id: 'accuse',
            label: 'Accuse',
            icon: 'action.accuse',
            danger: true,
            consequence: null,
            onSelect: () => undefined,
          },
        ]}
      >
        <button type="button" className="mrak-button">
          Radka
        </button>
      </ContextMenu>
    </div>
  ),
};
