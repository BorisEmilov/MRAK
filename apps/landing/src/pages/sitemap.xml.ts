import { SITE_URL } from '../data/site';

const PAGES = [
  '/',
  '/buy/',
  '/signup/',
  '/login/',
  '/privacy/',
  '/terms/',
  '/refunds/',
  '/cookies/',
  '/press/',
  '/credits/',
];

export function GET(): Response {
  const urls = PAGES.map((p) => `<url><loc>${new URL(p, SITE_URL).href}</loc></url>`).join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
}
