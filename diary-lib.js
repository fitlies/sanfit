// Diary rules with no screen code, so they're tested: moods, search, "On this day", Recently deleted.
export const MOODS = [["😄", "Great"], ["🙂", "Good"], ["😐", "Okay"], ["😔", "Sad"], ["😠", "Angry"], ["😴", "Tired"]];

// Entries whose title or text contains the words typed, ignoring capitals.
export function searchEntries(entries, query) {
  const q = query.trim().toLowerCase();
  return q ? entries.filter((e) => `${e.title ?? ""}\n${e.body ?? ""}`.toLowerCase().includes(q)) : entries;
}

// Entries written on this date in earlier years, newest first. today is "YYYY-MM-DD".
export function onThisDay(entries, today) {
  return entries.filter((e) => e.entry_date.slice(5) === today.slice(5) && e.entry_date < today)
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
}

// A month's moods ("YYYY-MM"): counts in the MOODS order, and the most common one (none on a tie).
export function moodSummary(entries, month) {
  const counts = new Map();
  for (const e of entries) if (e.mood && e.entry_date.startsWith(month)) counts.set(e.mood, (counts.get(e.mood) ?? 0) + 1);
  const list = MOODS.filter(([m]) => counts.has(m)).map(([m, label]) => ({ mood: m, label, count: counts.get(m) }));
  const most = Math.max(0, ...list.map((x) => x.count));
  const leaders = list.filter((x) => x.count === most);
  return { list, top: leaders.length === 1 ? leaders[0] : null };
}

// Recently deleted: whole days left before an entry deleted at deletedAt is gone for good (0 = due now).
export const BIN_DAYS = 30;
export const binDaysLeft = (deletedAt, now = new Date()) => Math.max(0, BIN_DAYS - Math.floor((now - new Date(deletedAt)) / 864e5));
