import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { ICON_INFO, ICON_NAMES, type IconName } from '../icons/names';
import { PALETTE, TEXT_SIZES, contrast } from '../tokens';

const meta: Meta = { title: 'Foundations' };
export default meta;

/* Story-only developer text (not shipped to players). */

export const Palette: StoryObj = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
        gap: 12,
      }}
    >
      {Object.entries(PALETTE).map(([name, hex]) => (
        <div key={name} className="mrak-panel" style={{ padding: 12 }}>
          <div style={{ background: hex, height: 56, border: '1px solid #6b5642' }} />
          <code>--mrak-{name}</code>
          <div>{hex}</div>
          <div className="mrak-portrait-caption">
            vs earth-900: {contrast(hex, PALETTE['earth-900']).toFixed(1)}:1
          </div>
        </div>
      ))}
    </div>
  ),
};

export const Typography: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="mrak-display" style={{ fontSize: 'var(--mrak-text-display)' }}>
        Mrak
      </div>
      {Object.entries(TEXT_SIZES).map(([name, rem]) => (
        <div key={name} style={{ fontSize: `var(--mrak-text-${name})` }}>
          {name} · {rem}rem · {rem * 16}px — The bell rang at 3:33, though no one stood in the
          tower.
        </div>
      ))}
    </div>
  ),
};

function Gallery() {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const map = new Map<string, IconName[]>();
    for (const name of ICON_NAMES) {
      if (query && !name.includes(query.toLowerCase())) continue;
      const cat = ICON_INFO[name].category;
      map.set(cat, [...(map.get(cat) ?? []), name]);
    }
    return [...map];
  }, [query]);
  return (
    <div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        Filter
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          style={{ font: 'inherit', minHeight: 44 }}
        />
        <span>{ICON_NAMES.length} icons · game-icons.net, CC BY 3.0</span>
      </label>
      {groups.map(([category, names]) => (
        <section key={category}>
          <h2 className="mrak-display">{category}</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))',
              gap: 8,
            }}
          >
            {names.map((name) => (
              <div key={name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Icon
                  name={name}
                  size={32}
                  label={name}
                  description={`${ICON_INFO[name].meaning} — ${ICON_INFO[name].source} by ${ICON_INFO[name].author}`}
                />
                <code style={{ fontSize: 'var(--mrak-text-xs)' }}>{name.split('.')[1]}</code>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export const Icons: StoryObj = { render: () => <Gallery /> };
