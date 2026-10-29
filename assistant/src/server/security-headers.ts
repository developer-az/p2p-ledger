import type { MiddlewareHandler } from 'hono';

/**
 * Security headers, one source of truth. vercel.json repeats them for the static site on Vercel
 * (test/security-headers.test.ts keeps the two in sync); the Hono middleware below adds them to
 * every API response and to the static files the Node server (Docker) serves.
 */
const COMMON: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** The web app: own scripts only; Google Fonts for type; no framing; API calls to the same origin. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** API responses are data, never documents to render. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const PAGE_HEADERS: Record<string, string> = { ...COMMON, 'Content-Security-Policy': PAGE_CSP };
export const API_HEADERS: Record<string, string> = { ...COMMON, 'Content-Security-Policy': API_CSP };

export function securityHeaders(headers: Record<string, string>): MiddlewareHandler {
  return async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(headers)) {
      if (!c.res.headers.has(name)) c.res.headers.set(name, value);
    }
  };
}
