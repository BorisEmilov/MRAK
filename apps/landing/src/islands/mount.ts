import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { IslandProps } from './shared';

const loaders: Record<string, () => Promise<{ default: ComponentType<IslandProps> }>> = {
  newsletter: () => import('./Newsletter'),
  'newsletter-confirm': () => import('./NewsletterConfirm'),
  auth: () => import('./Auth'),
  account: () => import('./Account'),
  store: () => import('./Store'),
};

export function mountIsland(el: HTMLElement): void {
  const load = loaders[el.dataset['island'] ?? ''];
  if (!load) return;
  const parse = (attr: string): unknown => JSON.parse(el.dataset[attr] ?? '{}');
  void load().then(({ default: Island }) => {
    createRoot(el).render(
      createElement(Island, {
        strings: parse('strings') as IslandProps['strings'],
        config: parse('config') as IslandProps['config'],
        props: parse('props') as IslandProps['props'],
      }),
    );
  });
}
