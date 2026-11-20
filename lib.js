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
