// Chat info: tap a chat's name to open it. Search the chat, and see every photo sent in it.
// Both ask the server, so they reach messages older than the ones kept on the phone.
import { likePattern, cleanQuery } from "./lib.js";
import { S, sb, $, el, changed, open, alertBox, chatName, nameOf, fillAvatar, photo, personByEmail, otherEmail, hitRow } from "./state.js";
import { openAt } from "./chat.js";

const PAGE = 30;
let info = null; // this visit to Chat info: { chatId, found: { q, rows } | null, photos, done, loading }

// Also opened from home search ("Sandy's photos"), where the keyboard shouldn't pop up.
export function openChatInfo(chatId, focus = true) {
  S.chatId = chatId;
  info = { chatId, found: null, photos: [], done: false, loading: false };
  morePhotos();
  open("chat-info");
  $("#search-q").value = "";
  if (focus) $("#search-q").focus();
}
$("#chat-who").onclick = () => openChatInfo(S.chatId);
$("#info-back").onclick = () => history.back();

$("#search-form").onsubmit = async (e) => {
  e.preventDefault();
  const q = cleanQuery($("#search-q").value);
  if (!q) return;
  const visit = info; // results belong to this chat and this search, even if they arrive late
  const { data, error } = await sb.from("messages").select("id, chat_id, sender, body, created_at").eq("chat_id", visit.chatId)
    .ilike("body", likePattern(q))
    .order("created_at", { ascending: false }).limit(50);
  if (error) return alertBox(error);
  if (visit !== info || cleanQuery($("#search-q").value) !== q) return; // a newer search or chat took over
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
  // Each result opens the chat at that message, older ones included (openAt fetches them).
  box.replaceChildren(...(found.rows.length ? found.rows.map((m) => hitRow(m, found.q, nameOf(m.sender), () => openAt(m)))
    : [el("p", "none", `Nothing found for "${found.q}".`)]));
}
