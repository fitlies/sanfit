// Chat info: tap a chat's name to open it, then search that chat. The search runs on the server,
// so it finds messages older than the ones kept on the phone too.
import { dayLabel, timeLabel } from "./lib.js";
import { S, sb, $, el, changed, alertBox, chatName, nameOf, fillAvatar, personByEmail, otherEmail } from "./state.js";
import { showMessage } from "./chat.js";

let found = null; // the last search: { chatId, q, rows }

$("#chat-who").onclick = () => {
  S.screen = "chat-info";
  history.pushState({ info: S.chatId }, ""); // so the back button returns to the chat
  changed();
  $("#search-q").focus();
};
$("#info-back").onclick = () => history.back();

$("#search-form").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("#search-q").value.trim();
  if (!q) return;
  const { data, error } = await sb.from("messages").select("id, sender, body, created_at").eq("chat_id", S.chatId)
    .ilike("body", `%${q.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`) // % and _ are wildcards; search for them as typed
    .order("created_at", { ascending: false }).limit(50);
  if (error) return alertBox(error);
  found = { chatId: S.chatId, q, rows: data };
  changed();
};

// The text with each match wrapped in <mark>.
function marked(text, q) {
  const out = [], lower = text.toLowerCase(), needle = q.toLowerCase();
  let i = 0, j;
  while ((j = lower.indexOf(needle, i)) >= 0) {
    out.push(text.slice(i, j), el("mark", null, text.slice(j, j + q.length)));
    i = j + q.length;
  }
  out.push(text.slice(i));
  return out;
}

export function renderChatInfo() {
  const c = S.chats.find((x) => x.id === S.chatId);
  if (!c) return;
  fillAvatar($("#info-avatar"), chatName(c), personByEmail(otherEmail(c))?.avatar_path);
  $("#info-name").textContent = chatName(c);
  const box = $("#search-results");
  box.hidden = found?.chatId !== c.id;
  if (box.hidden) return;
  box.replaceChildren(...(found.rows.length ? found.rows.map((m) => {
    const onPhone = S.messages.some((x) => x.id === m.id);
    const row = el("button", "hit");
    row.disabled = !onPhone;
    const top = el("span", "hit-top");
    top.append(el("b", null, nameOf(m.sender)), el("span", null, `${dayLabel(m.created_at)}, ${timeLabel(m.created_at)}`));
    const text = el("span", "hit-text");
    text.append(...marked(m.body.slice(0, 300), found.q));
    row.append(top, text);
    if (onPhone) row.onclick = () => { showMessage(m.id); history.back(); }; // back in the chat, scrolled to it
    return row;
  }) : [el("p", "none", `Nothing found for "${found.q}".`)]));
}
