/**
 * Development only. Islands are mounted by our own module script (no `client:*` directives, for
 * the strict CSP), so Astro never injects @vitejs/plugin-react's Fast Refresh preamble and every
 * island fails with "can't detect preamble". This installs it before any island module loads.
 * Not part of production builds (`import.meta.env.DEV` is false there).
 */
interface RefreshRuntime {
  injectIntoGlobalHook(w: Window): void;
}

export async function installReactPreamble(): Promise<void> {
  const w = window as unknown as Record<string, unknown>;
  if (w['__vite_plugin_react_preamble_installed__']) return;
  const url = '/@react-refresh';
  const runtime = (await import(/* @vite-ignore */ url)) as { default: RefreshRuntime };
  runtime.default.injectIntoGlobalHook(window);
  w['$RefreshReg$'] = () => undefined;
  w['$RefreshSig$'] = () => (type: unknown) => type;
  w['__vite_plugin_react_preamble_installed__'] = true;
}
