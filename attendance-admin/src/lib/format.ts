/**
 * src/lib/format.ts
 *
 * Display helpers. Every date in the contract is a string; it gets parsed here
 * at the moment of rendering and nowhere else.
 */

import { format, parseISO, differenceInMinutes } from 'date-fns';

/** '2026-10-24T09:14:32+05:30' -> '09:14 AM' */
export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return format(parseISO(iso), 'hh:mm a');
}

/** '2026-10-24' -> '24 Oct 2026' */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return format(parseISO(iso), 'dd MMM yyyy');
}

/** '2026-10-24T09:14:32+05:30' -> '24 Oct 2026, 09:14 AM' */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return format(parseISO(iso), 'dd MMM yyyy, hh:mm a');
}

/** 262 -> '4h 22m' */
export function formatDuration(minutes: number): string {
  if (!minutes || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function minutesSince(iso: string): number {
  return differenceInMinutes(new Date(), parseISO(iso));
}

/** 'Karan Patel' -> 'KP'. Used for avatar fallbacks. */
export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Today as '2026-10-24', in the browser's timezone. */
export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}