import type { Decorator, Preview } from '@storybook/react-vite';
import { KitFrame } from './KitFrame';
import '../src/styles/index.css';

const withKit: Decorator = (Story, context) => (
  <KitFrame globals={context.globals}>
    <Story />
  </KitFrame>
);

const preview: Preview = {
  decorators: [withKit],
  parameters: {
    backgrounds: { disable: true },
    a11y: { test: 'error' },
    layout: 'fullscreen',
  },
  globalTypes: {
    colorblind: {
      description: 'Colour-blind mode',
      toolbar: {
        icon: 'eye',
        items: ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'monochrome'],
        dynamicTitle: true,
      },
    },
    textScale: {
      description: 'Text scale',
      toolbar: { icon: 'zoom', items: ['1', '1.25', '1.5', '1.75', '2'], dynamicTitle: true },
    },
    device: {
      description: 'Input device for key hints',
      toolbar: {
        icon: 'controls',
        items: ['keyboard', 'xbox', 'playstation', 'nintendo'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { colorblind: 'none', textScale: '1', device: 'keyboard' },
};

export default preview;
