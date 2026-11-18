import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

// Strict CSP (public/_headers): no inline scripts or styles. Islands are mounted by bundled
// module scripts (no `client:*` hydration, which injects inline scripts) and stylesheets are
// always external. scripts/check-security.mjs fails the build if anything inline slips in.
export default defineConfig({
  site: 'https://mrak.game',
  output: 'static',
  integrations: [react()],
  build: { inlineStylesheets: 'never', format: 'directory' },
  vite: { build: { assetsInlineLimit: 0 } },
});
