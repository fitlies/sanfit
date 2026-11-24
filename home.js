// Home: the greeting on top, and cards under the tiles for what needs you now. Tapping one opens it right here.
import { dueText } from "./lib.js";
import { GAMES } from "./games-lib.js";
import { S, $, el, chatName, snippet, unreadIn, myTodos, myTurns, fillAvatar, tapRow as row } from "./state.js";
import { openChat } from "./chat.js";
import { openGame } from "./games.js";

const SHOWN = 3; // rows per card before "See all"

// "Good evening" and "Hi Fitri", with your photo. The photo is only refilled when it changes, so it doesn't flicker.
export function renderTop() {
  const me = S.people[S.me], h = new Date().getHours();
  $("#hello-time").textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("#hello-name").textContent = me ? `Hi ${me.name}` : "Hi";
  const key = `${me?.name}|${me?.avatar_path}`;
  const box = $("#hello-avatar");
  if (me && box.dataset.key !== key) { box.dataset.key = key; fillAvatar(box, me.name, me.avatar_path); }
}

function card(title, rows, seeAll) {
  const c = el("div", "card");
  c.append(el("h2", null, title), ...rows.slice(0, SHOWN));
  if (rows.length > SHOWN) {
    const b = el("button", "btn plain more", `See all ${rows.length}`);
    b.onclick = seeAll;
    c.append(b);
  }
  return c;
}

// openTile opens a tile's screen the same way tapping the tile does (app.js).
export function renderHome(openTile) {
  const unread = S.chats.filter((c) => unreadIn(c.id)).map((c) => {
    const last = S.messages.findLast((m) => m.chat_id === c.id);
    return row(chatName(c), snippet(last), () => openChat(c.id), el("span", "count", unreadIn(c.id)));
  });

  const todos = myTodos().map((t) => {
    const chat = S.chats.find((c) => c.id === t.chat_id);
    const sub = [t.due_at && dueText(t.due_at), chat && `With ${chatName(chat)}`].filter(Boolean).join(". ");
    // A new to-do on that list starts as "Anyone", as when you switch lists in To-dos.
    return row(t.title, sub, () => { S.todoChat = t.chat_id; S.assignee = ""; openTile("todos"); });
  });

  const turns = myTurns().map((g) => {
    const chat = S.chats.find((c) => c.id === g.chat_id);
    return row(GAMES[g.kind].name, `Your turn${chat ? ` with ${chatName(chat)}` : ""}`, () => openGame(g.id));
  });

  const cards = [
    unread.length && card("New messages", unread, () => openTile("chats")),
    todos.length && card("To-dos for you", todos, () => openTile("todos")),
    turns.length && card("Your turn", turns, () => openTile("games")),
  ].filter(Boolean);
  $("#glance").replaceChildren(...(cards.length ? cards : [el("p", "none caught-up", "All caught up.")]));
}
