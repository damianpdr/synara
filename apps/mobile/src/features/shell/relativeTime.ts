// FILE: relativeTime.ts
// Purpose: Compact relative timestamps for list rows.
// Layer: Mobile shell feature
// Exports: formatRelativeTime, formatAbsoluteDateTime.
//
// Hand-rolled rather than `Intl.RelativeTimeFormat`: Hermes ships a reduced ICU
// surface and the abbreviated ("3h") style this list wants is not expressible
// through it anyway. `now` is a parameter so the output is deterministic in
// tests and so a single `Date.now()` per render pass formats every row.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function monthName(index: number): string {
  return MONTHS[index] ?? "";
}

/**
 * `2m`, `3h`, `5d`, `12 Mar`, `12 Mar 2024`. Empty string for a missing or
 * unparseable timestamp, so callers can render it unconditionally.
 *
 * Clock skew between the phone and the server routinely puts a fresh
 * `updatedAt` a second or two in the future; anything up to a minute ahead is
 * clamped to "now" instead of rendering nonsense.
 */
export function formatRelativeTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "";
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "";

  const elapsed = nowMs - timestamp;
  if (elapsed < MINUTE_MS) return "now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  if (elapsed < WEEK_MS) return `${Math.floor(elapsed / DAY_MS)}d`;

  const date = new Date(timestamp);
  const day = date.getDate();
  const month = monthName(date.getMonth());
  const year = date.getFullYear();
  return year === new Date(nowMs).getFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${String(year)}`;
}

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/** `12 Mar 2025, 14:03` — used on the settings connection card. */
export function formatAbsoluteDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "—";
  const date = new Date(timestamp);
  return (
    `${String(date.getDate())} ${monthName(date.getMonth())} ${String(date.getFullYear())}, ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}
