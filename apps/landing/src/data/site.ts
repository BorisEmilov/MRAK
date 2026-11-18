/** Build-time site facts. URLs can be overridden per environment (PUBLIC_* in .env). */
export const SITE_URL = 'https://mrak.game';
export const PLAY_URL: string =
  (import.meta.env['PUBLIC_PLAY_URL'] as string | undefined) ?? 'https://play.mrak.game';
export const API_URL: string =
  (import.meta.env['PUBLIC_API_URL'] as string | undefined) ?? 'https://api.mrak.game';
/** Cloudflare's documented always-pass test key when none is configured (development). */
export const TURNSTILE_SITEKEY: string =
  (import.meta.env['PUBLIC_TURNSTILE_SITEKEY'] as string | undefined) ?? '1x00000000000000000000AA';

/** Paddle Billing client-side token (public by design); the store opens when it is set. */
export const PADDLE_CLIENT_TOKEN =
  (import.meta.env['PUBLIC_PADDLE_CLIENT_TOKEN'] as string | undefined) ?? '';
/** "sandbox" (provider test mode) or "production". */
export const PADDLE_ENV: string =
  (import.meta.env['PUBLIC_PADDLE_ENV'] as string | undefined) ?? 'sandbox';

/**
 * Trailer, screenshots and GIFs (files in public/media/). Empty until the capture pass: the home
 * page then shows its placeholder frames instead of inventing images.
 */
export const MEDIA: {
  trailer: { src: string; poster: string } | null;
  shots: { src: string; altKey: string; width: number; height: number }[];
} = { trailer: null, shots: [] };

/** Full-game price: null until announced (never guessed on the site). */
export const FULL_PRICE: string | null = null;
