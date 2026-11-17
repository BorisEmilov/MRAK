/** Portrait images (data URLs) drawn from a villager's look; cached per villager and variant. */
import type { VillagerLook } from '@mrak/content-schema';
import { portraitPixels, type ArtVariant } from '../../game/villagers/villager-art';

const cache = new Map<string, string | null>();

/** A PNG data URL of the portrait, or null where canvas is unavailable (tests). */
export function portraitUrl(id: string, look: VillagerLook, variant: ArtVariant): string | null {
  const key = `${id}:${variant}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let url: string | null = null;
  try {
    const p = portraitPixels(look, variant);
    const canvas = document.createElement('canvas');
    canvas.width = p.width;
    canvas.height = p.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(new ImageData(p.data, p.width, p.height), 0, 0);
      url = canvas.toDataURL('image/png');
    }
  } catch {
    url = null;
  }
  cache.set(key, url);
  return url;
}

const SKIN = ['#e8c4a0', '#d9a87e', '#c48d64', '#a8744f'];
const HAIR = ['#2b1d14', '#4a3222', '#6b4a2e', '#8c8c8c', '#1a1a1a'];
const CLOTHES = ['#5b2c2c', '#2f3d2a', '#3a3550', '#6b5a3a', '#4a4a4a'];
const ACCENT = ['#b03030', '#c8a040', '#e0e0d0', '#305080'];

/** A look for a resident the years brought (no content entry): drawn from their seed. */
export function personLook(seed: number, sex: 'female' | 'male'): VillagerLook {
  const at = <T>(list: readonly T[], n: number): T => list[n % list.length] as T;
  return {
    skin: at(SKIN, seed),
    hair: at(HAIR, Math.floor(seed / 7)),
    clothes: at(CLOTHES, Math.floor(seed / 31)),
    accent: at(ACCENT, Math.floor(seed / 131)),
    headwear: sex === 'female' ? 'kerchief' : at(['none', 'cap', 'kalpak'] as const, seed),
    beard: sex === 'male' && seed % 2 === 0,
    build: at(['slim', 'broad', 'stooped'] as const, Math.floor(seed / 3)),
  };
}
