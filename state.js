// Shared data and helpers. Loaders update S, then call changed() so the current screen redraws.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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
  people: {}, chats: [], messages: [], reactions: [], todos: [],
  screen: "chats", // login | name-step | chats | chat | todos | settings
  chatId: null,    // the open chat, when screen is "chat"
  todoChat: null,  // whose to-do list is showing
  assignee: "",    // who a new to-do is for ("" = anyone)
};

let redraw = () => {};
export const onChange = (fn) => (redraw = fn);
export const changed = () => redraw();

// ---------- who's who ----------
export const otherEmail = (c) => c.members.find((e) => e !== S.myEmail);
export const personByEmail = (e) => Object.values(S.people).find((p) => p.email === e);
export const chatName = (c) => personByEmail(otherEmail(c))?.name ?? otherEmail(c) ?? "Chat"; // email until they join
export const nameOf = (id) => (id === S.me ? "You" : S.people[id]?.name ?? "Someone");
export const snippet = (m) => (m?.body ? m.body.slice(0, 80) : m?.image_path ? "📷 Photo" : "");
export const unreadIn = (cid) => S.messages.filter((m) => m.chat_id === cid && m.sender !== S.me && !m.read_at).length;

export function alertBox(error) {
  console.error(error);
  const s = $("#toast");
  s.hidden = false;
  s.textContent = `Didn't go through: ${error.message}. Check your connection and try again.`;
  clearTimeout(s.t);
  s.t = setTimeout(() => (s.hidden = true), 6000);
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
  if (error) { alertBox(error); return null; }
  return data;
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
export async function loadMessages() {
  // shortcut: the latest 500 messages across all chats load; add "load earlier" when history gets long.
  const data = await fetchRows(sb.from("messages").select("*").order("created_at", { ascending: false }).limit(500));
  if (!data) return;
  S.messages = data.reverse();
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
