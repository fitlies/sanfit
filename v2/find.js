// Search from home: people and their photos, to-dos (on the phone, instant), and messages in every chat (asks the server).
import { matchNames, matchTodos, likePattern, cleanQuery } from "./lib.js";
import { S, sb, $, el, changed, chatName, marked, tapRow, hitRow } from "./state.js";
import { openChat, openAt } from "./chat.js";
import { openChatInfo } from "./chat-info.js";

const WAIT = 300; // ms after the last key before asking the server
const MIN = 2;    // letters before messages are searched
let q = "", found = null, timer = null; // found: the latest message search, { q, rows } or { q, failed: true }

$("#find-q").oninput = (e) => {
  q = cleanQuery(e.target.value);
  clearTimeout(timer);
  if (q.length >= MIN) timer = setTimeout(searchMessages, WAIT);
  changed();
};
$("#find-form").onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); searchMessages(); $("#find-q").blur(); };

// The database rules only return messages from your own chats, so one query covers them all.
async function searchMessages() {
  const asked = q;
  if (asked.length < MIN) return;
  if (!navigator.onLine) { found = { q: asked, failed: true }; return changed(); } // say so straight away
  const { data, error } = await sb.from("messages").select("id, chat_id, sender, body, created_at")
    .ilike("body", likePattern(asked)).order("created_at", { ascending: false }).limit(30);
  if (q !== asked) return; // a newer search took over
  found = error ? { q: asked, failed: true } : { q: asked, rows: data };
  changed();
}

// Home empties the bar. Blur too: a bar left focused fires no focus event on the next tap, so search wouldn't open.
export function clearFind() {
  q = "";
  found = null;
  clearTimeout(timer);
  $("#find-q").value = "";
  $("#find-q").blur();
}

function card(title, rows) {
  const c = el("div", "card");
  c.append(el("h2", null, title), ...rows);
  return c;
}

function messages() {
  const say = (line) => [el("p", "none", line)];
  if (q.length < MIN) return say("Type one more letter to search messages.");
  if (found?.q !== q) return say("Searching…");
  if (found.failed) {
    if (!navigator.onLine) return say("You're offline. Messages can't be searched.");
    const again = el("button", "btn plain retry", "Try again");
    again.onclick = () => { found = null; changed(); searchMessages(); };
    return [...say("Couldn't search messages."), again];
  }
  if (!found.rows.length) return say(`No messages with "${q}".`);
  return found.rows.map((m) => {
    const chat = S.chats.find((c) => c.id === m.chat_id);
    return hitRow(m, q, chat ? chatName(chat) : "Chat", () => openAt(m), m.sender === S.me ? "You: " : "");
  });
}

// openTile opens a tile's screen the same way tapping the tile does (app.js).
export function renderFind(openTile) {
  const box = $("#find-results");
  if (!q) return box.replaceChildren(el("p", "none find-hint", "Type a name, a to-do or words from a message."));

  const people = matchNames(S.chats.map((c) => ({ id: c.id, name: chatName(c) })), q).flatMap((c) => [
    tapRow(["Chat with ", ...marked(c.name, q)], "", () => openChat(c.id)),
    tapRow([...marked(c.name, q), "'s photos"], "", () => openChatInfo(c.id, false)),
  ]);
  const { open, done } = matchTodos(S.todos, q);
  const todos = [...open, ...done].map((td) => {
    const chat = S.chats.find((c) => c.id === td.chat_id);
    const sub = [td.done_at ? "Done" : "To do", chat && `With ${chatName(chat)}`].filter(Boolean).join(". ");
    return tapRow(marked(td.title, q), sub, () => { S.todoChat = td.chat_id; S.assignee = ""; openTile("todos"); });
  });

  box.replaceChildren(
    ...(people.length ? [card("People", people)] : []),
    ...(todos.length ? [card("To-dos", todos)] : []),
    card("Messages", messages()),
  );
}
