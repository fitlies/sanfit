import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from "./config.js";
import { dayLabel, timeLabel, initial, b64urlToBytes, fitSize } from "./lib.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const TICK = '<svg viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 6l3 3 6-7"/></svg>';
const TICKS = '<svg viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 6l3 3 6-7M7 8l1 1 6-7"/></svg>';
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

let me = null, myEmail = "", people = {}, chats = [], messages = [], reactions = [], todos = [];
let tab = "chats", chatId = null, todoChat = null, replyTo = null, live = null, stick = true;
const urls = {};

// ---------- who's who ----------
const otherEmail = (c) => c.members.find((e) => e !== myEmail);
const personByEmail = (e) => Object.values(people).find((p) => p.email === e);
const chatName = (c) => personByEmail(otherEmail(c))?.name ?? otherEmail(c) ?? "Chat"; // email until they join and pick a name
const nameOf = (id) => (id === me ? "You" : people[id]?.name ?? "Someone");
const snippet = (m) => (m?.body ? m.body.slice(0, 80) : m?.image_path ? "📷 Photo" : "");
const unreadIn = (cid) => messages.filter((m) => m.chat_id === cid && m.sender !== me && !m.read_at).length;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

// ---------- screens ----------
const TABS = ["chats", "todos", "settings"];
function show(id) {
  for (const s of ["login", "name-step", "chats", "chat", "todos", "settings"]) $("#" + s).hidden = s !== id;
  $("#tabs").hidden = !TABS.includes(id);
}
function go(t) {
  tab = t;
  chatId = null;
  show(t);
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  if (t === "chats") renderChatList();
  if (t === "todos") renderTodos();
  if (t === "settings") renderSettings();
}
$("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.tab); };

function openChat(id) {
  chatId = id;
  stick = true;
  clearReply();
  history.pushState({ chat: id }, ""); // so Android's back button returns to the list
  show("chat");
  renderHeader();
  renderChat();
  markRead();
}
$("#back").onclick = () => history.back();
window.onpopstate = () => { if (chatId) go("chats"); };

// Keep layout above the keyboard.
const fit = () => { $("#app").style.height = (visualViewport?.height ?? innerHeight) + "px"; scrollTo(0, 0); if (stick) scrollBottom(); };
visualViewport?.addEventListener("resize", fit);

// ---------- auth ----------
let signingUp = false;
$("#mode").onclick = () => {
  signingUp = !signingUp;
  $("#login-err").textContent = "";
  $("#login-btn").textContent = signingUp ? "Create account" : "Sign in";
  $("#mode").textContent = signingUp ? "Already have a password? Sign in" : "First time here? Create your password";
  $("#login-hint").textContent = signingUp ? "Pick a password of at least 8 characters." : "Sign in with your email and password.";
  $("#password").autocomplete = signingUp ? "new-password" : "current-password";
};
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("#email").value.trim().toLowerCase(), password = $("#password").value;
  const err = $("#login-err");
  err.textContent = "";
  if (signingUp) {
    const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) return (err.textContent = /database error|not allowed/i.test(error.message)
      ? "This email isn't on Sanfit." : `Couldn't create your account: ${error.message}`);
    $("#mode").click();
    $("#login-hint").textContent = `Check ${email} and tap the confirm link. Then come back here and sign in.`;
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) err.textContent = /confirm/i.test(error.message)
      ? "Tap the confirm link in your email first, then sign in."
      : "Wrong email or password.";
  }
};

// The confirm link lands here; Supabase reports a used or stale link in the URL hash.
if (location.hash.includes("error_code")) {
  $("#login-err").textContent = "That link has expired or was already used. If you've confirmed before, just sign in.";
  history.replaceState(null, "", location.pathname);
}

sb.auth.onAuthStateChange((event, session) => {
  if (session?.user && session.user.id !== me) {
    me = session.user.id;
    myEmail = session.user.email.toLowerCase();
    setTimeout(start); // outside the auth callback
  }
  if (event === "SIGNED_OUT") { me = null; live?.unsubscribe(); show("login"); }
});
sb.auth.getSession().then(({ data }) => { if (!data.session) show("login"); });

async function start() {
  if ((await loadPeople()) === false) return setTimeout(start, 4000); // offline at launch: retry, don't ask for a name again
  if (!people[me]) return show("name-step");
  await Promise.all([loadChats(), loadMessages(), loadReactions(), loadTodos()]);
  subscribe();
  go(tab);
}

$("#name-form").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("profiles").upsert({ id: me, name: $("#first-name").value.trim() });
  if (error) return alertBox(error);
  start();
};

// ---------- data ----------
async function loadPeople() {
  const { data, error } = await sb.from("profiles").select("*");
  if (error) { alertBox(error); return false; }
  people = Object.fromEntries(data.map((p) => [p.id, p]));
  if (chatId) renderHeader();
  if (tab === "chats" && !chatId) renderChatList();
}
async function loadChats() {
  const { data, error } = await sb.from("chat_members").select("chat_id, email");
  if (error) return alertBox(error);
  const byId = {};
  for (const r of data) (byId[r.chat_id] ??= { id: r.chat_id, members: [] }).members.push(r.email);
  chats = Object.values(byId);
  todoChat ??= chats[0]?.id ?? null;
}
async function loadMessages() {
  // shortcut: the latest 500 messages across all chats load; add "load earlier" when history gets long.
  const { data, error } = await sb.from("messages").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) return alertBox(error);
  messages = data.reverse();
  refreshChats();
}
async function loadReactions() {
  const { data, error } = await sb.from("reactions").select("*");
  if (error) return alertBox(error);
  reactions = data;
  if (chatId) renderChat();
}
async function loadTodos() {
  const { data, error } = await sb.from("todos").select("*").order("created_at");
  if (error) return alertBox(error);
  todos = data;
  renderTodos();
}
function subscribe() {
  live?.unsubscribe();
  live = sb.channel("sanfit")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => { addMsg(p.new); markRead(); })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (p) => {
      const m = messages.find((x) => x.id === p.new.id);
      if (m) { m.read_at = p.new.read_at; refreshChats(); }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, loadReactions)
    .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, loadTodos)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, loadPeople)
    .subscribe();
}
// Phones drop the socket in the background; catch up on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && me && people[me]) {
    loadMessages().then(markRead);
    loadReactions();
    loadTodos();
  }
});

function addMsg(m) {
  if (messages.some((x) => x.id === m.id)) return;
  messages.push(m);
  if (m.sender === me) stick = true;
  refreshChats();
}
async function markRead() {
  if (!chatId || document.visibilityState !== "visible") return;
  if (!unreadIn(chatId)) return;
  await sb.from("messages").update({ read_at: new Date().toISOString() })
    .eq("chat_id", chatId).neq("sender", me).is("read_at", null);
}

function alertBox(error) {
  console.error(error);
  const s = $("#toast");
  s.hidden = false;
  s.textContent = `Didn't go through: ${error.message}. Check your connection and try again.`;
  clearTimeout(s.t);
  s.t = setTimeout(() => (s.hidden = true), 6000);
}

// ---------- unread badges ----------
function refreshChats() {
  const total = chats.reduce((n, c) => n + unreadIn(c.id), 0);
  $("#chat-badge").hidden = !total;
  $("#chat-badge").textContent = total;
  // Home Screen icon badge, where the phone supports it.
  if (total) navigator.setAppBadge?.(total).catch(() => {});
  else navigator.clearAppBadge?.().catch(() => {});
  if (chatId) renderChat();
  else if (tab === "chats") renderChatList();
}

// ---------- chat list ----------
function renderChatList() {
  const last = (c) => messages.findLast((m) => m.chat_id === c.id);
  const sorted = [...chats].sort((a, b) => (last(b)?.created_at ?? "").localeCompare(last(a)?.created_at ?? ""));
  $("#chat-list").replaceChildren(...(sorted.length ? sorted.map((c) => {
    const m = last(c), unread = unreadIn(c.id), joined = !!personByEmail(otherEmail(c));
    const row = el("button", "chatrow");
    row.onclick = () => openChat(c.id);
    const body = el("div", "body");
    const when = m ? (dayLabel(m.created_at) === "Today" ? timeLabel(m.created_at) : dayLabel(m.created_at)) : "";
    body.append(
      el("span", "name", chatName(c)),
      el("span", "when" + (unread ? " new" : ""), when),
      el("span", "preview", m ? (m.sender === me ? "You: " : "") + snippet(m) : joined ? "Say hi." : "Hasn't joined Sanfit yet"),
    );
    if (unread) body.append(el("span", "count", unread));
    row.append(el("div", "avatar", initial(chatName(c))), body);
    return row;
  }) : [el("p", "none", "No chats yet.")]));
}

// ---------- one chat ----------
function renderHeader() {
  const c = chats.find((x) => x.id === chatId);
  if (!c) return;
  const joined = !!personByEmail(otherEmail(c));
  $("#partner-initial").textContent = initial(chatName(c));
  $("#partner-name").textContent = chatName(c);
  $("#partner-sub").textContent = joined ? "" : "They'll see your messages once they join.";
}

const box = $("#msgs");
const scrollBottom = () => (box.scrollTop = box.scrollHeight);
box.addEventListener("scroll", () => (stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80));

function renderChat() {
  if (!chatId) return;
  const top = box.scrollTop; // re-renders on every change; keep the spot if you're scrolled up
  const list = messages.filter((m) => m.chat_id === chatId);
  box.replaceChildren();
  if (!list.length) box.append(el("p", "empty", `Say hi to ${chatName(chats.find((c) => c.id === chatId))}.`));
  let lastDay = "", lastSender = null;
  for (const m of list) {
    const day = dayLabel(m.created_at);
    if (day !== lastDay) { box.append(el("div", "day", day)); lastDay = day; lastSender = null; }
    const mine = m.sender === me;
    const b = el("div", `bubble ${mine ? "out" : "in"}${m.sender !== lastSender ? " first" : ""}`);
    b.dataset.id = m.id;
    lastSender = m.sender;
    if (m.reply_to) {
      const q = messages.find((x) => x.id === m.reply_to);
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
      photoUrl(m.image_path).then((u) => u && (img.src = u));
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
    const rs = reactions.filter((r) => r.message_id === m.id);
    if (rs.length) {
      b.classList.add("reacted");
      b.append(el("span", "reacts", rs.map((r) => r.emoji).join("")));
    }
    box.append(b);
  }
  if (stick) scrollBottom(); else box.scrollTop = top;
}

function jumpTo(id) {
  const b = box.querySelector(`[data-id="${id}"]`);
  if (!b) return;
  b.scrollIntoView({ block: "center", behavior: "smooth" });
  b.classList.add("flash");
  setTimeout(() => b.classList.remove("flash"), 1000);
}

async function photoUrl(path) {
  if (!urls[path]) {
    // shortcut: links last 24h; reopen the app if a photo stops loading after a day open.
    const { data } = await sb.storage.from("photos").createSignedUrl(path, 86400);
    urls[path] = data?.signedUrl;
  }
  return urls[path];
}
$("#viewer").onclick = () => ($("#viewer").hidden = true);

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
  sheetMsg = messages.find((m) => m.id === id);
  if (!sheetMsg) return;
  swallowClick = true;
  setTimeout(() => (swallowClick = false), 600);
  const mine = reactions.find((r) => r.message_id === id && r.user_id === me)?.emoji;
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
  const { error } = emoji
    ? await sb.from("reactions").upsert({ message_id: id, user_id: me, emoji })
    : await sb.from("reactions").delete().eq("message_id", id).eq("user_id", me);
  error ? alertBox(error) : loadReactions();
}

function startReply(id) {
  const m = messages.find((x) => x.id === id);
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

// ---------- sending ----------
const text = $("#text");
text.oninput = () => {
  text.style.height = "auto";
  text.style.height = text.scrollHeight + "px";
  $("#send").disabled = !text.value.trim();
};
text.onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && matchMedia("(hover: hover)").matches) { e.preventDefault(); $("#composer").requestSubmit(); }
};
// Keep the keyboard up when tapping send, like WhatsApp.
$("#send").onpointerdown = (e) => e.preventDefault();
$("#composer").onsubmit = async (e) => {
  e.preventDefault();
  const body = text.value.trim();
  if (!body) return;
  const reply = replyTo;
  text.value = ""; text.oninput(); clearReply();
  const { data, error } = await sb.from("messages").insert({ chat_id: chatId, body, reply_to: reply }).select().single();
  if (error) { text.value = body; text.oninput(); if (reply) startReply(reply); return alertBox(error); }
  addMsg(data);
};

$("#attach").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  const s = $("#chat-status"), cid = chatId;
  let reply = replyTo;
  clearReply();
  for (const [i, f] of files.entries()) {
    s.hidden = false;
    s.textContent = files.length > 1 ? `Sending photo ${i + 1} of ${files.length}…` : "Sending photo…";
    const blob = await shrink(f);
    const path = `${cid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const up = await sb.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (up.error) { alertBox(up.error); continue; }
    const { data, error } = await sb.from("messages").insert({ chat_id: cid, image_path: path, reply_to: reply }).select().single();
    if (error) { alertBox(error); continue; }
    reply = null; // only the first photo replies
    addMsg(data);
  }
  s.hidden = true;
};

// Resize to 1600px JPEG so photos load fast and the free storage lasts. Falls back to the original.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const [w, h] = fitSize(bmp.width, bmp.height, 1600);
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    return await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no()), "image/jpeg", 0.82));
  } catch {
    return file;
  }
}

// ---------- to-dos (one list per chat) ----------
function radios(container, name, opts, cur, onChange) {
  container.replaceChildren(...opts.map(([v, label]) => {
    const l = el("label");
    const i = Object.assign(el("input"), { type: "radio", name, value: v, checked: String(v) === String(cur) });
    if (onChange) i.onchange = () => onChange(v);
    l.append(i, el("span", null, label));
    return l;
  }));
}

function renderTodos() {
  const pick = $("#todo-chat");
  pick.hidden = chats.length < 2;
  radios(pick, "todo-chat", chats.map((c) => [c.id, chatName(c)]), todoChat, (v) => { todoChat = v; renderTodos(); });

  const c = chats.find((x) => x.id === todoChat);
  const other = c && personByEmail(otherEmail(c));
  const who = [["", "Anyone"], [me, "Me"], ...(other ? [[other.id, other.name]] : [])];
  const cur = document.querySelector("#assign input:checked")?.value;
  radios($("#assign"), "assignee", who, who.some(([v]) => v === cur) ? cur : "");

  const list = todos.filter((t) => t.chat_id === todoChat);
  const open = list.filter((t) => !t.done_at);
  const done = list.filter((t) => t.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at));
  $("#open-list").replaceChildren(...(open.length ? open.map(todoRow) : [el("p", "none", "Nothing to do. Add something above.")]));
  $("#done-list").hidden = !done.length;
  $("#done-list").replaceChildren(el("h2", null, "Done"), ...done.map(todoRow));

  const mine = todos.filter((t) => !t.done_at && t.assignee === me).length;
  $("#todo-badge").hidden = !mine;
  $("#todo-badge").textContent = mine;
}

const whenLabel = (d) => `${dayLabel(d).replace(/^(Today|Yesterday)$/, (w) => w.toLowerCase())}, ${timeLabel(d)}`;

$("#todo-form").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("#todo-title").value.trim();
  if (!title || !todoChat) return;
  const assignee = document.querySelector("#assign input:checked")?.value || null;
  const dueRaw = $("#todo-due").value; // local time from the phone's picker
  const due_at = dueRaw ? new Date(dueRaw).toISOString() : null;
  const { error } = await sb.from("todos").insert({ chat_id: todoChat, title, assignee, due_at });
  if (error) return alertBox(error);
  $("#todo-title").value = "";
  $("#todo-due").value = "";
  loadTodos();
};

function todoRow(t) {
  const r = el("div", "row" + (t.done_at ? " done" : ""));
  const c = el("button", "check");
  c.setAttribute("aria-label", t.done_at ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`);
  if (t.done_at) c.innerHTML = TICK;
  c.onclick = async () => {
    const done = !t.done_at;
    const { error } = await sb.from("todos").update({ done_at: done ? new Date().toISOString() : null, done_by: done ? me : null }).eq("id", t.id);
    error ? alertBox(error) : loadTodos();
  };
  const main = el("div", "tmain");
  main.append(el("span", "ttitle", t.title));
  if (t.done_at) {
    main.append(el("span", "tsub", `Done by ${nameOf(t.done_by)}, ${whenLabel(t.done_at)}`));
  } else if (t.due_at) {
    const late = new Date(t.due_at) < new Date();
    main.append(el("span", "tsub" + (late ? " late" : ""), `${late ? "Overdue" : "Due"} ${whenLabel(t.due_at)}`));
  }
  r.append(c, main);
  if (t.assignee && !t.done_at) r.append(el("span", "for" + (t.assignee === me ? " me" : ""), t.assignee === me ? "For you" : `For ${nameOf(t.assignee)}`));
  const d = el("button", "del", "×");
  d.setAttribute("aria-label", `Delete "${t.title}"`);
  d.onclick = async () => {
    const { error } = await sb.from("todos").delete().eq("id", t.id);
    error ? alertBox(error) : loadTodos();
  };
  r.append(d);
  return r;
}

// ---------- settings ----------
$("#rename-form").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("profiles").update({ name: $("#my-name").value.trim() }).eq("id", me);
  error ? alertBox(error) : loadPeople();
};

$("#theme").onchange = (e) => {
  try { localStorage.setItem("theme", e.target.value); } catch { /* storage blocked: keep following the phone */ }
  applyTheme();
};

async function currentSub() {
  return "serviceWorker" in navigator ? (await navigator.serviceWorker.ready).pushManager?.getSubscription() : null;
}
async function renderSettings() {
  $("#my-name").value = people[me]?.name ?? "";
  document.querySelector(`#theme input[value="${applyTheme()}"]`).checked = true;
  const t = $("#push-text"), b = $("#push-btn");
  b.hidden = true;
  if (!("PushManager" in window)) {
    // iPhone only allows alerts for apps opened from the Home Screen.
    t.textContent = "To get alerts, open Sanfit from your Home Screen. iPhone: in Safari tap Share, then Add to Home Screen. Android: in Chrome tap ⋮, then Add to Home screen.";
  } else if (Notification.permission === "denied") {
    t.textContent = "Notifications are blocked. Turn them on in your phone's Settings, under Notifications for Sanfit (or Chrome).";
  } else if (Notification.permission === "granted" && (await currentSub())) {
    t.textContent = "On. You'll get alerts for new messages and to-dos.";
  } else {
    t.textContent = "Get alerts for new messages, to-dos given to you, and to-dos that come due.";
    b.hidden = false;
  }
}
$("#push-btn").onclick = async () => {
  if ((await Notification.requestPermission()) !== "granted") return renderSettings();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC_KEY) });
    const { error } = await sb.from("push_subs").upsert({ endpoint: sub.endpoint, sub: sub.toJSON(), user_id: me });
    if (error) throw error;
  } catch (err) {
    alertBox(err);
  }
  renderSettings();
};
$("#signout").onclick = async () => {
  const sub = await currentSub();
  if (sub) { await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
  await sb.auth.signOut();
};
