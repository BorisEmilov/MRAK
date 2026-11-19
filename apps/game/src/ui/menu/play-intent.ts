/**
 * Deep link from the website's player hub (docs/ui/player-hub.md → Game deep link):
 * `?play=continue` or `?play=new`. Read once and removed from the address bar, so a reload does
 * not repeat it. Unknown values are ignored.
 */
export type PlayIntent = 'continue' | 'new';

export function takePlayIntent(
  loc: Pick<Location, 'href'> = window.location,
  hist: Pick<History, 'replaceState' | 'state'> = window.history,
): PlayIntent | null {
  const url = new URL(loc.href);
  const value = url.searchParams.get('play');
  if (value === null) return null;
  url.searchParams.delete('play');
  hist.replaceState(hist.state, '', `${url.pathname}${url.search}${url.hash}`);
  return value === 'continue' || value === 'new' ? value : null;
}

let cached: PlayIntent | null | undefined;
/** The page's intent (read once, kept until used or abandoned; render-safe under StrictMode). */
export function pendingPlayIntent(): PlayIntent | null {
  if (cached === undefined) cached = typeof window === 'undefined' ? null : takePlayIntent();
  return cached;
}
export function clearPlayIntent(): void {
  cached = null;
}
