/**
 * Mounts every `[data-island]` on the page (see components/Island.astro) when it comes near the
 * viewport: React and the island's chunk load only then (fast first paint on the home page).
 */
const pending = [...document.querySelectorAll<HTMLElement>('[data-island]')];

const ready: Promise<unknown> = import.meta.env.DEV
  ? import('./dev-preamble').then((m) => m.installReactPreamble())
  : Promise.resolve();

function mount(el: HTMLElement): void {
  void ready
    .then(() => import('./mount'))
    .then(({ mountIsland }) => {
      mountIsland(el);
    });
}

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          io.unobserve(e.target);
          mount(e.target as HTMLElement);
        }
    },
    { rootMargin: '400px' },
  );
  for (const el of pending) io.observe(el);
} else for (const el of pending) mount(el);
