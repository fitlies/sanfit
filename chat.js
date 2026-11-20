// Chats tab: the chat list, one open chat, replies, reactions, sending text and photos.
import { dayLabel, timeLabel } from "./lib.js";
import { S, sb, $, el, TICK, changed, save, alertBox, fileUrl, fillAvatar, shrink, chatName, nameOf, snippet, unreadIn, personByEmail, otherEmail, loadReactions } from "./state.js";

const TICKS = '<svg viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 6l3 3 6-7M7 8l1 1 6-7"/></svg>';
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
let replyTo = null, stick = true;

const other = (c) => personByEmail(otherEmail(c)); // undefined until they join
const joined = (c) => !!other(c);
const shortWhen = (d) => (dayLabel(d) === "Today" ? timeLabel(d) : dayLabel(d));

// ---------- chat list ----------
export function renderChatList() {
  const last = (c) => S.messages.findLast((m) => m.chat_id === c.id);
  const sorted = [...S.chats].sort((a, b) => (last(b)?.created_at ?? "").localeCompare(last(a)?.created_at ?? ""));
  $("#chat-list").replaceChildren(...(sorted.length ? sorted.map((c) => {
    const m = last(c), unread = unreadIn(c.id);
    const row = el("button", "chatrow");
    row.onclick = () => openChat(c.id);
    const body = el("div", "body");
    body.append(
      el("span", "name", chatName(c)),
      el("span", "when" + (unread ? " new" : ""), m ? shortWhen(m.created_at) : ""),
      el("span", "preview", m ? (m.sender === S.me ? "You: " : "") + snippet(m) : joined(c) ? "Say hi." : "Hasn't joined Sanfit yet"),
    );
    if (unread) body.append(el("span", "count", unread));
    const av = el("div", "avatar");
    fillAvatar(av, chatName(c), other(c)?.avatar_path);
    row.append(av, body);
    return row;
  }) : [el("p", "none", "No chats yet.")]));
}

export function openChat(id) {
  S.chatId = id;
  S.screen = "chat";
  stick = true;
  clearReply();
  history.pushState({ chat: id }, ""); // so Android's back button returns to the list
  changed();
  markRead();
}
$("#back").onclick = () => history.back();

// ---------- one chat ----------
const box = $("#msgs");
const scrollBottom = () => (box.scrollTop = box.scrollHeight);
box.addEventListener("scroll", () => (stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80));
const fit = () => { $("#app").style.height = (visualViewport?.height ?? innerHeight) + "px"; scrollTo(0, 0); if (stick) scrollBottom(); };
visualViewport?.addEventListener("resize", fit); // keep the composer above the keyboard

export function renderChat() {
  const c = S.chats.find((x) => x.id === S.chatId);
  if (!c) return;
  fillAvatar($("#partner-avatar"), chatName(c), other(c)?.avatar_path);
  $("#partner-name").textContent = chatName(c);
  $("#partner-sub").textContent = joined(c) ? "" : "They'll see your messages once they join.";

  const top = box.scrollTop; // redraws on every change; keep the spot if you're scrolled up
  const list = S.messages.filter((m) => m.chat_id === S.chatId);
  box.replaceChildren();
  if (!list.length) box.append(el("p", "empty", `Say hi to ${chatName(c)}.`));
  let lastDay = "", lastSender = null;
  for (const m of list) {
    const day = dayLabel(m.created_at);
    if (day !== lastDay) { box.append(el("div", "day", day)); lastDay = day; lastSender = null; }
    box.append(bubble(m, m.sender !== lastSender));
    lastSender = m.sender;
  }
  if (stick) scrollBottom(); else box.scrollTop = top;
}

function bubble(m, first) {
  const mine = m.sender === S.me;
  const b = el("div", `bubble ${mine ? "out" : "in"}${first ? " first" : ""}`);
  b.dataset.id = m.id;
  if (m.reply_to) {
    const q = S.messages.find((x) => x.id === m.reply_to);
    const quote = el("span", "quote");
    quote.append(el("b", null, q ? nameOf(q.sender) : ""), q ? snippet(q) : "Earlier message");
    quote.onclick = () => jumpTo(m.reply_to);
    b.append(quote);
  }
  if (m.image_path) {
    b.classList.add("photo");
    if (!m.body) b.classList.add("notext");
    const img = el("img");
    img.alt = "Photo";
    img.onload = () => stick && scrollBottom();
    img.onclick = () => { $("#viewer img").src = img.src; $("#viewer").hidden = false; };
    fileUrl("photos", m.image_path).then((u) => u && (img.src = u));
    b.append(img);
  }
  if (m.body) b.append(el("span", "text", m.body));
  const meta = el("span", "meta", timeLabel(m.created_at));
  if (mine) {
    const t = el("span", m.read_at ? "read" : "");
    t.innerHTML = m.read_at ? TICKS : TICK;
    t.setAttribute("aria-label", m.read_at ? "Read" : "Sent");
    meta.append(t);
  }
  b.append(meta);
  const rs = S.reactions.filter((r) => r.message_id === m.id);
  if (rs.length) {
    b.classList.add("reacted");
    b.append(el("span", "reacts", rs.map((r) => r.emoji).join("")));
  }
  return b;
}

function jumpTo(id) {
  const b = box.querySelector(`[data-id="${id}"]`);
  if (!b) return;
  b.scrollIntoView({ block: "center", behavior: "smooth" });
  b.classList.add("flash");
  setTimeout(() => b.classList.remove("flash"), 1000);
}

$("#viewer").onclick = () => ($("#viewer").hidden = true);

export function addMsg(m) {
  if (S.messages.some((x) => x.id === m.id)) return;
  S.messages.push(m);
  if (m.sender === S.me) stick = true;
  changed();
}

export async function markRead() {
  if (S.screen !== "chat" || document.visibilityState !== "visible" || !unreadIn(S.chatId)) return;
  await sb.from("messages").update({ read_at: new Date().toISOString() })
    .eq("chat_id", S.chatId).neq("sender", S.me).is("read_at", null);
}

// ---------- swipe to reply, long-press for reactions ----------
let press = null, swallowClick = false;
const resetPress = () => {
  if (!press) return;
  clearTimeout(press.timer);
  press.b.style.transition = "";
  press.b.style.transform = "";
  press = null;
};
box.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".bubble");
  if (!b || e.button > 0) return;
  press = { b, x: e.clientX, y: e.clientY, dx: 0, timer: setTimeout(() => { resetPress(); openSheet(+b.dataset.id); }, 450) };
});
box.addEventListener("pointermove", (e) => {
  if (!press) return;
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return resetPress(); // scrolling, not swiping
  if (Math.abs(dx) > 10) clearTimeout(press.timer);
  press.dx = Math.max(0, Math.min(dx, 80));
  press.b.style.transition = "none";
  press.b.style.transform = `translateX(${press.dx}px)`;
});
const endPress = () => {
  if (press?.dx > 60) { startReply(+press.b.dataset.id); swallowClick = true; }
  resetPress();
};
box.addEventListener("pointerup", endPress);
box.addEventListener("pointercancel", endPress);
box.addEventListener("contextmenu", (e) => { // right-click, and long-press on Android
  const b = e.target.closest(".bubble");
  if (!b) return;
  e.preventDefault();
  resetPress();
  openSheet(+b.dataset.id);
});
// A long-press or swipe ends with a click; don't let it open the photo too.
box.addEventListener("click", (e) => { if (swallowClick) { e.stopPropagation(); swallowClick = false; } }, true);

let sheetMsg = null;
function openSheet(id) {
  sheetMsg = S.messages.find((m) => m.id === id);
  if (!sheetMsg) return;
  swallowClick = true;
  setTimeout(() => (swallowClick = false), 600);
  const mine = S.reactions.find((r) => r.message_id === id && r.user_id === S.me)?.emoji;
  $("#emojis").replaceChildren(...EMOJIS.map((em) => {
    const btn = el("button", null, em);
    btn.setAttribute("aria-label", `React ${em}`);
    btn.setAttribute("aria-pressed", em === mine);
    btn.onclick = () => react(id, em === mine ? null : em);
    return btn;
  }));
  $("#act-copy").hidden = !sheetMsg.body;
  $("#sheet").hidden = false;
}
const closeSheet = () => ($("#sheet").hidden = true);
$("#sheet").onclick = (e) => { if (e.target.id === "sheet") closeSheet(); };
$("#act-cancel").onclick = closeSheet;
$("#act-reply").onclick = () => { closeSheet(); startReply(sheetMsg.id); };
$("#act-copy").onclick = () => { navigator.clipboard?.writeText(sheetMsg.body); closeSheet(); };

async function react(id, emoji) {
  closeSheet();
  const ok = await save(emoji
    ? sb.from("reactions").upsert({ message_id: id, user_id: S.me, emoji })
    : sb.from("reactions").delete().eq("message_id", id).eq("user_id", S.me));
  if (ok) loadReactions();
}

// ---------- replying and sending ----------
const text = $("#text");

function startReply(id) {
  const m = S.messages.find((x) => x.id === id);
  if (!m) return;
  replyTo = id;
  $("#reply-name").textContent = nameOf(m.sender);
  $("#reply-text").textContent = snippet(m);
  $("#replybar").hidden = false;
  text.focus();
}
function clearReply() {
  replyTo = null;
  $("#replybar").hidden = true;
}
$("#reply-cancel").onclick = clearReply;

text.oninput = () => {
  text.style.height = "auto";
  text.style.height = text.scrollHeight + "px";
  $("#send").disabled = !text.value.trim();
};
text.onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && matchMedia("(hover: hover)").matches) { e.preventDefault(); $("#composer").requestSubmit(); }
};
$("#send").onpointerdown = (e) => e.preventDefault(); // keep the keyboard up when tapping send, like WhatsApp
$("#composer").onsubmit = async (e) => {
  e.preventDefault();
  const body = text.value.trim();
  if (!body) return;
  const reply = replyTo;
  text.value = ""; text.oninput(); clearReply();
  const { data, error } = await sb.from("messages").insert({ chat_id: S.chatId, body, reply_to: reply }).select().single();
  if (error) { text.value = body; text.oninput(); if (reply) startReply(reply); return alertBox(error); }
  addMsg(data);
};

$("#attach").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  const s = $("#chat-status"), cid = S.chatId;
  let reply = replyTo;
  clearReply();
  for (const [i, f] of files.entries()) {
    s.hidden = false;
    s.textContent = files.length > 1 ? `Sending photo ${i + 1} of ${files.length}…` : "Sending photo…";
    const blob = await shrink(f, 1600); // keeps photos quick to load and the free storage lasting
    const path = `${cid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    if (!(await save(sb.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg" })))) continue;
    const { data, error } = await sb.from("messages").insert({ chat_id: cid, image_path: path, reply_to: reply }).select().single();
    if (error) { alertBox(error); continue; }
    reply = null; // only the first photo replies
    addMsg(data);
  }
  s.hidden = true;
};

