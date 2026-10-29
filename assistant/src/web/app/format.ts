import { formatMoney } from '../../server/money.js';

/** "$1,234.50", "-$5.00" or "+$5.00" to integer cents. Returns null for anything else. */
export function parseMoney(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*([+-])?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/.exec(text);
  if (!m) return null;
  const cents = Math.round(Number(m[2]!.replace(/,/g, '')) * 100);
  return m[1] === '-' ? -cents : cents;
}

export function money(minor: number, currency = 'USD'): string {
  return formatMoney(minor, currency);
}

/** "anthony-4b4792" to "Anthony". The random suffix only exists to keep demo accounts unique. */
export function displayName(owner: string): string {
  if (owner.startsWith('Bank funding') || owner === 'system:funding') return 'Your bank';
  const base = owner.split('-').filter(Boolean)[0] ?? owner;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function initials(owner: string): string {
  return displayName(owner).slice(0, 1).toUpperCase();
}

/** A stable hue per person so the same friend always gets the same avatar colour. */
export function avatarHue(owner: string): number {
  let h = 0;
  for (const ch of displayName(owner).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', {
    weekday: diff < 7 && diff > 0 ? 'long' : undefined,
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function dateTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Groups rows into labelled days, keeping the incoming order (newest first). */
export function groupByDay<T extends { occurredAt: string }>(rows: T[], now = new Date()): { label: string; rows: T[] }[] {
  const groups: { label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const label = dayLabel(row.occurredAt, now);
    const last = groups.at(-1);
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/** "$12.50" with a leading + or − for feed rows. */
export function signedMoney(minor: number, currency = 'USD'): string {
  const sign = minor > 0 ? '+' : minor < 0 ? '−' : '';
  return `${sign}${money(Math.abs(minor), currency)}`;
}

export function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function monthDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function relativeDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Percent change as plain words, or null when there is nothing to compare with. */
export function changeWords(thisMinor: number, lastMinor: number): string | null {
  if (lastMinor <= 0) return thisMinor > 0 ? 'Nothing logged the week before' : null;
  const pct = Math.round(((thisMinor - lastMinor) / lastMinor) * 100);
  if (pct === 0) return 'Same as last week';
  return `${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} than last week`;
}
