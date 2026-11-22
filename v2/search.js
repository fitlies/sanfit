// Chat info: tap a chat's name to open it. Search the chat, and see every photo sent in it.
// Both ask the server, so they reach messages older than the ones kept on the phone.
import { dayLabel, timeLabel } from "./lib.js";
import { S, sb, $, el, changed, open, alertBox, chatName, nameOf, fillAvatar, photo, personByEmail, otherEmail } from "./state.js";
import { showMessage } from "./chat.js";

const PAGE = 30;
let info = null; // this visit to Chat info: { chatId, found: { q, rows } | null, photos, done, loading }

$("#chat-who").onclick = () => {
  info = { chatId: S.chatId, found: null, photos: [], done: false, loading: false };
  morePhotos();
  open("chat-info");
  $("#search-q").value = "";
  $("#search-q").focus();
};
$("#info-back").onclick = () => history.back();

$("#search-form").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("#search-q").value.replace(/\*/g, "").trim(); // the server treats * as "anything"
  if (!q) return;
  const visit = info; // results belong to this chat and this search, even if they arrive late
  const { data, error } = await sb.from("messages").select("id, sender, body, created_at").eq("chat_id", visit.chatId)
    .ilike("body", `%${q.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`) // % and _ are wildcards; search for them as typed
    .order("created_at", { ascending: false }).limit(50);
  if (error) return alertBox(error);
  if (visit !== info || $("#search-q").value.replace(/\*/g, "").trim() !== q) return; // a newer search or chat took over
  visit.found = { q, rows: data };
  changed();
};

// The next page of photos, newest first: the ones sent before the oldest shown, so a photo arriving meanwhile
// can't shift the pages. Each picture downloads once, then opens from the phone.
async function morePhotos() {
  const visit = info;
  if (visit.loading || visit.done) return;
  visit.loading = true;
  const last = visit.photos.at(-1);
  let query = sb.from("messages").select("id, image_path, created_at").eq("chat_id", visit.chatId).not("image_path", "is", null);
  if (last) query = query.lt("created_at", last.created_at);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(PAGE);
  visit.loading = false;
  if (error) return alertBox(error);
  visit.photos.push(...data);
  visit.done = data.length < PAGE;
  changed();
}
$("#gallery-more").onclick = morePhotos;

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
  const c = S.chats.find((x) => x.id === info?.chatId);
  if (!c) return;
  fillAvatar($("#info-avatar"), chatName(c), personByEmail(otherEmail(c))?.avatar_path);
  $("#info-name").textContent = chatName(c);

  $("#gallery").replaceChildren(...(info.photos.length ? info.photos.map((m) => {
    const tile = el("button");
    tile.setAttribute("aria-label", "Open photo");
    const img = photo("photos", m.image_path);
    tile.onclick = (e) => { if (e.target !== img) img.click(); }; // the button, for keyboards
    tile.append(img);
    return tile;
  }) : info.done ? [el("p", "none", "No photos in this chat yet.")] : []));
  $("#gallery-more").hidden = info.done;

  const box = $("#search-results"), found = info.found;
  box.hidden = !found;
  if (!found) return;
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
