// Shared data and helpers. Loaders update S, then call changed() so the current screen redraws.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2"; // exact version: a new release can't change the app unseen
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { initial, fitSize } from "./lib.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const $ = (s) => document.querySelector(s);
export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export const TICK = '<svg viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 6l3 3 6-7"/></svg>';

export const S = {
  me: null, myEmail: "",
  people: {}, chats: [], messages: [], reactions: [], todos: [], games: [],
  screen: "chats", // a <section> id in index.html: login, name-step, the five tabs, or chat, chat-info, diary-entry, game
  chatId: null,    // the open chat, on the chat and chat-info screens
  gameId: null,    // the open game, when screen is "game" ("phone" for a game against the phone)
  todoChat: null,  // whose to-do list is showing
  assignee: "",    // who a new to-do is for ("" = anyone)
};

let redraw = () => {}, keepTimer = null;
export const onChange = (fn) => (redraw = fn);
export const changed = () => { redraw(); clearTimeout(keepTimer); keepTimer = setTimeout(keepCopy, 2000); };

// Opens a screen inside a tab (a chat, Chat info, a diary entry, a game). The back button returns via BACK in app.js.
export function open(screen) {
  S.screen = screen;
  history.pushState({ screen }, "");
  changed();
}

// Small settings kept on this phone (theme, diary PIN, ...). Private browsing can block storage, so never throw.
export const pref = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
export const setPref = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* this visit only */ } };

// ---------- a copy on this phone, so the app opens with no connection and fetches only what's new ----------
// Chats, messages, reactions, to-dos, games and names. The diary is not kept here: it needs a connection.
const KEPT = ["people", "chats", "messages", "reactions", "todos", "games", "todoChat"];
const copyKey = () => `saved:${S.me}`;
function keepCopy() {
  if (!S.me || !S.messages.length) return;
  try { localStorage.setItem(copyKey(), JSON.stringify(Object.fromEntries(KEPT.map((k) => [k, S[k]])))); } catch { /* storage full or blocked: next open just loads everything */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") keepCopy(); }); // closing the app doesn't wait
// Fills S from the copy on this phone. Returns true if there was one.
export function restoreCopy() {
  try {
    const copy = JSON.parse(localStorage.getItem(copyKey()));
    if (!copy) return false;
    Object.assign(S, copy);
    return true;
  } catch { return false; }
}
// On sign-out: remove every saved copy, cached photo and alert subscription from this phone.
export async function forgetThisPhone() {
  clearTimeout(keepTimer);
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("saved:")) localStorage.removeItem(k); } catch { /* nothing stored */ }
  await window.caches?.delete(PHOTO_CACHE).catch(() => {});
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  await (await reg?.pushManager?.getSubscription())?.unsubscribe().catch(() => {}); // so Settings offers "Turn on" again
}

// ---------- who's who ----------
export const otherEmail = (c) => c.members.find((e) => e !== S.myEmail);
export const personByEmail = (e) => Object.values(S.people).find((p) => p.email === e);
export const chatName = (c) => personByEmail(otherEmail(c))?.name ?? otherEmail(c) ?? "Chat"; // email until they join
export const nameOf = (id) => (id === S.me ? "You" : S.people[id]?.name ?? "Someone");
export const snippet = (m) => (m?.body ? m.body.slice(0, 80) : m?.image_path ? "📷 Photo" : "");
export const unreadIn = (cid) => S.messages.filter((m) => m.chat_id === cid && m.sender !== S.me && !m.read_at).length;

function toast(text) {
  const s = $("#toast");
  s.hidden = false;
  s.textContent = text;
  clearTimeout(s.t);
  s.t = setTimeout(() => (s.hidden = true), 6000);
}
export function alertBox(error) {
  console.error(error);
  toast(`Didn't go through: ${error.message}. Check your connection and try again.`);
}

// Private pictures (chat, profile and diary photos). Each one downloads once, then opens from this phone.
// Every upload gets a new file name, so a saved copy never goes out of date.
// shortcut: the photo store only grows (until sign-out); prune old photos if phones start running low on space.
const PHOTO_CACHE = "sanfit-photos";
const urls = {};
export function fileUrl(bucket, path) {
  const key = `${bucket}/${path}`;
  urls[key] ??= photoFromPhoneOrDownload(bucket, path).then((u) => {
    if (!u) delete urls[key]; // try again next time
    return u;
  });
  return urls[key];
}
async function photoFromPhoneOrDownload(bucket, path) {
  const name = new URL(`photo/${bucket}/${path}`, location.href); // a label in the store, never fetched
  const store = await window.caches?.open(PHOTO_CACHE).catch(() => null);
  let res = await store?.match(name);
  if (!res) {
    const { data } = await sb.storage.from(bucket).createSignedUrl(path, 300);
    res = data && (await fetch(data.signedUrl).catch(() => null));
    if (!res?.ok) return null;
    await store?.put(name, res.clone()).catch(() => {});
  }
  const blob = await res.blob();
  // Only real image types become a link on this site; an SVG or HTML "photo" could run code here if opened.
  return PHOTO_TYPES.has(blob.type) ? URL.createObjectURL(blob) : null;
}
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

// A private photo as an <img>; tap it to see it full screen.
export function photo(bucket, path, alt = "") {
  const img = el("img");
  img.alt = alt;
  fileUrl(bucket, path).then((u) => u && (img.src = u));
  img.onclick = () => { if (img.src) { $("#viewer img").src = img.src; $("#viewer").hidden = false; } };
  return img;
}
$("#viewer").onclick = () => ($("#viewer").hidden = true);

// Shrinks a picked photo and uploads it under folder/. Returns its path, or null (the error is shown).
export async function uploadPhoto(bucket, folder, file, max) {
  const blob = await shrink(file, max); // keeps photos quick to load and the free storage lasting
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  return (await save(sb.storage.from(bucket).upload(path, blob, { contentType: blob.type || "image/jpeg" }))) ? path : null;
}

// Fills an avatar circle with someone's profile photo, or their initial while it loads or if they have none.
export function fillAvatar(box, name, path) {
  box.textContent = initial(name);
  box.dataset.path = path ?? "";
  if (path) fileUrl("avatars", path).then((u) => {
    if (!u || box.dataset.path !== path) return; // the circle moved on to someone else meanwhile
    const img = el("img");
    img.alt = "";
    img.src = u;
    box.replaceChildren(img);
  });
}

// Shrinks a picked photo to a JPEG at most `max` px on its longest side. Falls back to the original.
async function shrink(file, max) {
  try {
    const bmp = await createImageBitmap(file);
    const [w, h] = fitSize(bmp.width, bmp.height, max);
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    return await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no()), "image/jpeg", 0.82));
  } catch {
    return file;
  }
}

// Runs a Supabase write; shows the error if it fails. Returns true when it worked.
export async function save(query) {
  const { error } = await query;
  if (error) alertBox(error);
  return !error;
}

// ---------- loading ----------
async function fetchRows(query) {
  const { data, error } = await query;
  if (!error) return data;
  if (navigator.onLine) alertBox(error);
  else toast("You're offline. Showing what's saved on this phone.");
  return null;
}
export async function loadPeople() {
  const data = await fetchRows(sb.from("profiles").select("*"));
  if (!data) return false;
  S.people = Object.fromEntries(data.map((p) => [p.id, p]));
  changed();
}
export async function loadChats() {
  const data = await fetchRows(sb.from("chat_members").select("chat_id, email"));
  if (!data) return;
  const byId = {};
  for (const r of data) (byId[r.chat_id] ??= { id: r.chat_id, members: [] }).members.push(r.email);
  S.chats = Object.values(byId);
  S.todoChat ??= S.chats[0]?.id ?? null;
  changed();
}
// shortcut: the latest 500 messages across all chats are kept; add "load earlier" when history gets long.
export async function loadMessages() {
  const last = S.messages.at(-1);
  if (!last) {
    const data = await fetchRows(sb.from("messages").select("*").order("created_at", { ascending: false }).limit(500));
    if (!data) return;
    S.messages = data.reverse();
    return changed();
  }
  // Only what's new: messages from a minute before the last one we have (in case two landed together),
  // and read ticks on your own messages that were still unread.
  const since = new Date(Date.parse(last.created_at) - 60000).toISOString();
  const unread = S.messages.filter((m) => m.sender === S.me && !m.read_at).slice(-200).map((m) => m.id);
  const [fresh, reads] = await Promise.all([
    fetchRows(sb.from("messages").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(500)), // the newest 500, if away long
    unread.length ? fetchRows(sb.from("messages").select("id, read_at").in("id", unread).not("read_at", "is", null)) : [],
  ]);
  if (!fresh || !reads) return;
  const byId = new Map(S.messages.map((m) => [m.id, m]));
  for (const m of fresh) byId.set(m.id, m);
  for (const r of reads) if (byId.has(r.id)) byId.get(r.id).read_at = r.read_at;
  S.messages = [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(-500);
  changed();
}
export async function loadReactions() {
  const data = await fetchRows(sb.from("reactions").select("*"));
  if (!data) return;
  S.reactions = data;
  changed();
}
export async function loadTodos() {
  const data = await fetchRows(sb.from("todos").select("*").order("created_at"));
  if (!data) return;
  S.todos = data;
  changed();
}
// The 20 most recent games at launch; on return, only games changed since (the database sets updated_at).
// shortcut: a game removed while you were away stays listed until the next launch.
export async function loadGames(onlyChanged = false) {
  const newest = onlyChanged && S.games.length ? new Date(Math.max(...S.games.map((g) => Date.parse(g.updated_at)))).toISOString() : null;
  const query = sb.from("games").select("*").order("updated_at", { ascending: false }).limit(20);
  const data = await fetchRows(newest ? query.gt("updated_at", newest) : query);
  if (!data) return;
  S.games = newest ? [...data, ...S.games.filter((g) => !data.some((d) => d.id === g.id))] : data;
  changed();
}
