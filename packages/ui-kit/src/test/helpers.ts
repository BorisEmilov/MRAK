import { render, type RenderResult } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { expect } from 'vitest';
import { KitProviders } from './KitProviders';

export function renderKit(ui: ReactNode): RenderResult {
  return render(ui, { wrapper: KitProviders });
}

/** Fails on serious/critical axe violations (colour contrast is checked by tokens.test.ts). */
export async function expectAccessible(root: Element = document.body): Promise<void> {
  const result = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
  });
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual(
    [],
  );
}
