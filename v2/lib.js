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

// Whole calendar days from today to a date, on the phone's clock: 0 today, 1 tomorrow, -1 yesterday.
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const daysUntil = (date, now = new Date()) => Math.round((midnight(new Date(date)) - midnight(now)) / 864e5);
export const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;

// "12 days to Shanghai", or "Shanghai is today!" on the day.
export function countdownText(title, date, now = new Date()) {
  const n = daysUntil(date, now);
  return n === 0 ? `${title} is today!` : `${days(n)} to ${title}`;
}

// The line under an open to-do with a due time.
export function dueText(date, now = new Date()) {
  const n = daysUntil(date, now), time = timeLabel(date);
  if (n < 0) return `${days(-n)} late`;
  if (n === 0) return new Date(date) < now ? `Overdue since ${time}` : `Due today, ${time}`;
  if (n === 1) return `Due tomorrow, ${time}`;
  const d = new Date(date);
  return `${days(n)} left, ${weekday(d)} ${d.getDate()} ${d.toLocaleDateString("en-SG", { month: "short" })}`;
}

// A diary date ("2026-11-22") as a Date at local midnight.
export const fromLocalDate = (iso) => new Date(`${iso}T00:00`);
export const monthLabel = (date) => new Date(date).toLocaleDateString("en-SG", { month: "long", year: "numeric" });
export const weekday = (date, style = "short") => new Date(date).toLocaleDateString("en-SG", { weekday: style });
// "9:41 am" today, otherwise the day (chat list).
export const shortWhen = (date) => (dayLabel(date) === "Today" ? timeLabel(date) : dayLabel(date));
// "today, 9:41 am" / "Mon 17 Nov, 9:41 am" (done to-dos).
export const whenLabel = (date) => `${dayLabel(date).replace(/^(Today|Yesterday)$/, (w) => w.toLowerCase())}, ${timeLabel(date)}`;

// The to-do a chat counts down to: the soonest open one marked "Count down in chat", not yet past.
export const nextCountdown = (todos, chatId, now = new Date()) =>
  todos.filter((t) => t.chat_id === chatId && t.countdown && !t.done_at && t.due_at && daysUntil(t.due_at, now) >= 0)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))[0];

// Open to-dos given to `me`, soonest due first and undated last (the To-dos badge and the home card).
const dueOrder = (t) => (t.due_at ? Date.parse(t.due_at) : Infinity);
export const todosFor = (todos, me) =>
  todos.filter((t) => !t.done_at && t.assignee === me).sort((a, b) => (dueOrder(a) === dueOrder(b) ? 0 : dueOrder(a) - dueOrder(b)));

// ---------- search (home search bar and Chat info) ----------
// Capitals and spaces around the words typed don't matter.
const has = (text, q) => (text ?? "").toLowerCase().includes(q.trim().toLowerCase());

// People whose name contains q: items are { id, name }. Nothing for an empty search.
export const matchNames = (items, q) => (q.trim() ? items.filter((i) => has(i.name, q)) : []);

// To-dos whose title contains q: all open ones, then the `doneShown` most recently done.
export function matchTodos(todos, q, doneShown = 5) {
  if (!q.trim()) return { open: [], done: [] };
  const hits = todos.filter((t) => has(t.title, q));
  return {
    open: hits.filter((t) => !t.done_at),
    done: hits.filter((t) => t.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, doneShown),
  };
}

// The words to search for: * is dropped, because the server reads it as "anything".
export const cleanQuery = (q) => q.replace(/\*/g, "").trim();
// What to send the server for "body contains q". % and _ are escaped so they match as typed.
export const likePattern = (q) => `%${cleanQuery(q).replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;

// A long message cut to show the match: up to `before` characters ahead of it, "…" where text was cut.
export function snippetAround(text, q, before = 40, length = 160) {
  const at = text.toLowerCase().indexOf(q.trim().toLowerCase());
  const start = at > before ? at - before : 0;
  const cut = text.slice(start, start + length);
  return (start ? "…" : "") + cut + (start + length < text.length ? "…" : "");
}

// The text cut into [part, isMatch] pieces, so the matches can be highlighted.
export function splitMatches(text, q) {
  const needle = q.trim().toLowerCase(), lower = text.toLowerCase(), out = [];
  if (!needle) return [[text, false]];
  let i = 0, j;
  while ((j = lower.indexOf(needle, i)) >= 0) {
    if (j > i) out.push([text.slice(i, j), false]);
    out.push([text.slice(j, j + needle.length), true]);
    i = j + needle.length;
  }
  if (i < text.length) out.push([text.slice(i), false]);
  return out;
}
