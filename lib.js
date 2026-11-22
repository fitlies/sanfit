// Pure helpers (tested in test.mjs).

const sameDay = (a, b) => a.toDateString() === b.toDateString();

export function dayLabel(date, now = new Date()) {
  const d = new Date(date);
  if (sameDay(d, now)) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-SG", opts);
}

export const timeLabel = (date) =>
  new Date(date).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });

export const initial = (name) => (name || "?").trim().charAt(0).toUpperCase();

// Key for a VAPID public key -> Uint8Array, as pushManager.subscribe wants.
export function b64urlToBytes(s) {
  const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Fit (w,h) inside max x max, never upscale.
export function fitSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

// "2026-11-22" for a date, in the phone's own time zone.
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Weeks of a month for a Sunday-first calendar: each week is 7 day numbers, with null for blanks.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}
